import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import * as THREE from 'three';
import {
  GROUP_COLOR,
  GROUP_ORDER,
  LEVEL_URGENCY,
  type VitalityGroup,
  type YearLang,
  type YearRisk,
} from '../data/timeline';

interface Props {
  yearLangs: YearLang[];
  width: number;
  height: number;
  filters: Record<VitalityGroup, boolean>;
  autoRotate: boolean;
  theme: 'dark' | 'light';
  onUserInteract: () => void;
  onSelect: (iso: string) => void;
  onClusterSelect: (isos: string[]) => void;
}

export interface ClusterMember {
  iso: string;
  name: string;
  color: string;
  group: VitalityGroup;
  level: YearRisk;
}

const GLOBE_THEME = {
  dark: {
    globeImageUrl: 'https://unpkg.com/three-globe/example/img/earth-dark.jpg',
    atmosphereColor: '#3b6f9e',
    capColor: 'rgba(104, 124, 156, 0.55)',
    sideColor: 'rgba(104, 124, 156, 0.06)',
    strokeColor: 'rgba(168, 190, 220, 0.4)',
  },
  light: {
    globeImageUrl: 'https://unpkg.com/three-globe/example/img/earth-day.jpg',
    atmosphereColor: '#9ec3e8',
    capColor: 'rgba(70, 96, 140, 0.28)',
    sideColor: 'rgba(70, 96, 140, 0.05)',
    strokeColor: 'rgba(54, 78, 120, 0.45)',
  },
} as const;

const COUNTRIES_URL = 'https://cdn.jsdelivr.net/gh/vasturiano/globe.gl/example/datasets/ne_110m_admin_0_countries.geojson';

const DEG = Math.PI / 180;
const GLOBE_R = 100;    // three-globe internal radius
const MIN_CLUSTER = 2;          // any 2+ languages in a cell → badge, no overlapping dots
const MIN_PERM_CLUSTER = 5;
const CELL_PULL = 0.5;
const PROX_THRESHOLD = 0.45;
const PERM_EXCL_THRESHOLD = PROX_THRESHOLD * 1.5;

interface Pt { iso: string; name: string; lat: number; lng: number; group: VitalityGroup; level: YearRisk; color: string; urgency: number; }
interface Share { color: string; frac: number; }
interface GridCluster { lat: number; lng: number; count: number; color: string; size: number; shares: Share[]; members: ClusterMember[]; }
interface PermCluster { lat: number; lng: number; count: number; color: string; size: number; shares: Share[]; members: ClusterMember[]; }
interface DotObj { kind: 'dot'; lat: number; lng: number; iso: string; name: string; color: string; urgency: number; }
interface GridObj { kind: 'grid'; lat: number; lng: number; count: number; color: string; size: number; shares: Share[]; members: ClusterMember[]; }
interface PermObj { kind: 'perm'; lat: number; lng: number; count: number; color: string; size: number; shares: Share[]; members: ClusterMember[]; }
type GlobeObj = DotObj | GridObj | PermObj;

// Camera state: center of screen + camera distance. Everything derives from this.
interface Cam { lat: number; lng: number; dist: number; }

// True geometric visibility: is a surface point inside the camera's view frustum?
// cos(θ_max) = R / dist — points with a larger dot product are visible.
// We add a 5 % margin so things don't pop in right at the edge.
function isVisible(lat: number, lng: number, cam: Cam): boolean {
  const fLat = cam.lat * DEG; const fLng = cam.lng * DEG;
  const pLat = lat * DEG;    const pLng = lng * DEG;
  const dot = Math.sin(pLat) * Math.sin(fLat)
             + Math.cos(pLat) * Math.cos(fLat) * Math.cos(pLng - fLng);
  // threshold = cos(horizon angle), pulled in 5° worth to cull edge-of-view noise
  const threshold = Math.max(-0.05, GLOBE_R / cam.dist - 0.09);
  return dot >= threshold;
}

// Fan co-located languages into a ring whose radius grows with the pile size.
function dedupeJitter(pts: Pt[]): Pt[] {
  const buckets = new Map<string, Pt[]>();
  for (const p of pts) {
    const key = `${p.lat.toFixed(2)}:${p.lng.toFixed(2)}`;
    const b = buckets.get(key); if (b) b.push(p); else buckets.set(key, [p]);
  }
  const out: Pt[] = [];
  for (const grp of buckets.values()) {
    if (grp.length === 1) { out.push(grp[0]); continue; }
    const n = grp.length;
    const ringR = 0.045 * Math.sqrt(n);
    grp.forEach((p, i) => {
      const ang = (i / n) * Math.PI * 2;
      out.push({ ...p, lat: p.lat + Math.sin(ang) * ringR, lng: p.lng + Math.cos(ang) * ringR });
    });
  }
  return out;
}

// Proximity clustering — O(n) spatial grid instead of O(n²) brute-force.
// Points are bucketed into lat/lng cells; only the 3×3 neighborhood is checked,
// cutting ~3 300² ≈ 5.4 M comparisons down to a few thousand.
function proximityClusterize(pts: Pt[]): { permClusters: PermCluster[]; freePts: Pt[] } {
  const n = pts.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(i: number): number { return parent[i] === i ? i : (parent[i] = find(parent[i])); }

  const CELL = PROX_THRESHOLD;
  const t2 = PROX_THRESHOLD * PROX_THRESHOLD;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = `${Math.floor(pts[i].lat / CELL)},${Math.floor(pts[i].lng / CELL)}`;
    const b = grid.get(key); if (b) b.push(i); else grid.set(key, [i]);
  }
  for (let i = 0; i < n; i++) {
    const ci = Math.floor(pts[i].lat / CELL);
    const cj = Math.floor(pts[i].lng / CELL);
    for (let di = -1; di <= 1; di++) {
      for (let dj = -1; dj <= 1; dj++) {
        const nb = grid.get(`${ci + di},${cj + dj}`);
        if (!nb) continue;
        for (const j of nb) {
          if (j <= i) continue;
          const dl = pts[i].lat - pts[j].lat; const dg = pts[i].lng - pts[j].lng;
          if (dl * dl + dg * dg <= t2) parent[find(i)] = find(j);
        }
      }
    }
  }
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i); const g = groups.get(r); if (g) g.push(i); else groups.set(r, [i]);
  }
  const permClusters: PermCluster[] = [];
  const freePts: Pt[] = [];
  for (const idxs of groups.values()) {
    if (idxs.length < MIN_PERM_CLUSTER) { idxs.forEach(i => freePts.push(pts[i])); continue; }
    let lat = 0; let lng = 0;
    const tally: Record<VitalityGroup, number> = { healthy: 0, watch: 0, serious: 0, gone: 0, unknown: 0 };
    for (const i of idxs) { lat += pts[i].lat; lng += pts[i].lng; tally[pts[i].group]++; }
    const cnt = idxs.length; lat /= cnt; lng /= cnt;
    const shares: Share[] = [];
    let major: VitalityGroup = 'healthy'; let max = -1;
    for (const g of GROUP_ORDER) {
      if (tally[g] > 0) shares.push({ color: GROUP_COLOR[g], frac: tally[g] / cnt });
      if (tally[g] > max) { max = tally[g]; major = g; }
    }
    const members: ClusterMember[] = idxs.map(i => ({
      iso: pts[i].iso, name: pts[i].name,
      color: pts[i].color, group: pts[i].group, level: pts[i].level,
    }));
    members.sort((a, b) => LEVEL_URGENCY[b.level] - LEVEL_URGENCY[a.level]);
    permClusters.push({ lat, lng, count: cnt, color: GROUP_COLOR[major], size: 5.5, shares, members });
  }
  return { permClusters, freePts };
}

// Grid clustering for zoomed-out tiers — runs only on the already-culled visible free points.
// Members are stored so small clusters can show a language list instead of just zooming.
function gridClusterize(pts: Pt[], cell: number): { clusters: GridCluster[]; singles: Pt[] } {
  if (cell <= 0) return { clusters: [], singles: pts };
  const cells = new Map<string, Pt[]>();
  for (const p of pts) {
    const key = `${Math.floor((p.lat + 90) / cell)}:${Math.floor((p.lng + 180) / cell)}`;
    const b = cells.get(key); if (b) b.push(p); else cells.set(key, [p]);
  }
  const clusters: GridCluster[] = []; const singles: Pt[] = [];
  for (const [key, bucket] of cells) {
    if (bucket.length < MIN_CLUSTER) { singles.push(...bucket); continue; }
    let lat = 0; let lng = 0;
    const tally: Record<VitalityGroup, number> = { healthy: 0, watch: 0, serious: 0, gone: 0, unknown: 0 };
    for (const p of bucket) { lat += p.lat; lng += p.lng; tally[p.group]++; }
    const n = bucket.length;
    const [latI, lngI] = key.split(':').map(Number);
    const badgeLat = (latI * cell - 90 + cell / 2) * CELL_PULL + (lat / n) * (1 - CELL_PULL);
    const badgeLng = (lngI * cell - 180 + cell / 2) * CELL_PULL + (lng / n) * (1 - CELL_PULL);
    const shares: Share[] = []; let major: VitalityGroup = 'healthy'; let maxT = -1;
    for (const g of GROUP_ORDER) {
      if (tally[g] > 0) shares.push({ color: GROUP_COLOR[g], frac: tally[g] / n });
      if (tally[g] > maxT) { maxT = tally[g]; major = g; }
    }
    const members: ClusterMember[] = bucket.map(p => ({ iso: p.iso, name: p.name, color: p.color, group: p.group, level: p.level }));
    members.sort((a, b) => LEVEL_URGENCY[b.level] - LEVEL_URGENCY[a.level]);
    const size = Math.min(Math.min(13, cell), Math.max(6.5, 5.4 + Math.log2(n) * 1.15));
    clusters.push({ lat: badgeLat, lng: badgeLng, count: n, color: GROUP_COLOR[major], size, shares, members });
  }
  return { clusters, singles };
}

const fmtCount = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);

// ---------- Sprite factories (cached) ----------
const spriteCache = new Map<string, THREE.Sprite>();

function makeSprite(canvas: HTMLCanvasElement): THREE.Sprite {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: true }));
}

function badgeSprite(shares: Share[], dominant: string, label: string): THREE.Sprite {
  const sig = `g|${label}|${dominant}|${shares.map(s => `${s.color}${Math.round(s.frac * 16)}`).join('-')}`;
  const hit = spriteCache.get(sig); if (hit) return hit.clone();
  const dpr = Math.min(devicePixelRatio || 1, 2); const S = 128;
  const cv = document.createElement('canvas'); cv.width = cv.height = S * dpr;
  const cx = cv.getContext('2d')!; cx.scale(dpr, dpr);
  const c = S / 2; const TAU = Math.PI * 2; const sc = c / 110;
  const rR = c - 10 * sc; const rW = 14 * sc; const rD = rR - rW / 2 - 7 * sc;
  cx.beginPath(); cx.arc(c, c, rR + rW / 2 + 3 * sc, 0, TAU); cx.fillStyle = 'rgba(3,5,12,.45)'; cx.fill();
  const gap = shares.length > 1 ? 0.07 : 0; let a = -Math.PI / 2;
  cx.lineWidth = rW; cx.lineCap = 'butt';
  for (const s of shares) {
    const sw = s.frac * TAU;
    if (sw > gap + .001) { cx.beginPath(); cx.arc(c, c, rR, a + gap / 2, a + sw - gap / 2); cx.strokeStyle = s.color; cx.stroke(); }
    a += sw;
  }
  const dg = cx.createLinearGradient(0, c - rD, 0, c + rD);
  dg.addColorStop(0, 'rgba(22,28,43,.94)'); dg.addColorStop(1, 'rgba(8,11,19,.96)');
  cx.beginPath(); cx.arc(c, c, rD, 0, TAU); cx.fillStyle = dg; cx.fill();
  cx.beginPath(); cx.arc(c, c, rD - 1, 0, TAU); cx.lineWidth = 1.5; cx.strokeStyle = dominant; cx.globalAlpha = .55; cx.stroke(); cx.globalAlpha = 1;
  const sh = cx.createLinearGradient(0, c - rD, 0, c + rD * .2);
  sh.addColorStop(0, 'rgba(255,255,255,.14)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  cx.beginPath(); cx.arc(c, c, rD - 2, Math.PI, TAU); cx.fillStyle = sh; cx.fill();
  cx.fillStyle = '#fff';
  cx.font = `700 ${Math.round((label.length >= 4 ? 58 : label.length === 3 ? 68 : 78) * sc)}px "Space Grotesk",system-ui,sans-serif`;
  cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(label, c, c + 3 * sc);
  const sp = makeSprite(cv); spriteCache.set(sig, sp); return sp.clone();
}

function permBadgeSprite(shares: Share[], dominant: string, label: string): THREE.Sprite {
  const sig = `p|${label}|${dominant}|${shares.map(s => `${s.color}${Math.round(s.frac * 16)}`).join('-')}`;
  const hit = spriteCache.get(sig); if (hit) return hit.clone();
  const dpr = Math.min(devicePixelRatio || 1, 2); const S = 120;
  const cv = document.createElement('canvas'); cv.width = cv.height = S * dpr;
  const cx = cv.getContext('2d')!; cx.scale(dpr, dpr);
  const c = S / 2; const TAU = Math.PI * 2; const sc = c / 100;
  const rR = c - 18 * sc; const rW = 11 * sc; const rD = rR - rW / 2 - 6 * sc;
  cx.beginPath(); cx.arc(c, c, rR + rW / 2 + 3 * sc, 0, TAU); cx.fillStyle = 'rgba(3,5,12,.45)'; cx.fill();
  cx.save(); cx.setLineDash([5 * sc, 5 * sc]);
  cx.beginPath(); cx.arc(c, c, rR + rW / 2 + 9 * sc, 0, TAU);
  cx.strokeStyle = 'rgba(255,255,255,.35)'; cx.lineWidth = 1.8; cx.stroke(); cx.restore();
  const gap = shares.length > 1 ? 0.07 : 0; let a = -Math.PI / 2;
  cx.lineWidth = rW; cx.lineCap = 'butt';
  for (const s of shares) {
    const sw = s.frac * TAU;
    if (sw > gap + .001) { cx.beginPath(); cx.arc(c, c, rR, a + gap / 2, a + sw - gap / 2); cx.strokeStyle = s.color; cx.stroke(); }
    a += sw;
  }
  const dg = cx.createLinearGradient(0, c - rD, 0, c + rD);
  dg.addColorStop(0, 'rgba(22,28,43,.94)'); dg.addColorStop(1, 'rgba(8,11,19,.96)');
  cx.beginPath(); cx.arc(c, c, rD, 0, TAU); cx.fillStyle = dg; cx.fill();
  cx.beginPath(); cx.arc(c, c, rD - 1, 0, TAU); cx.lineWidth = 1.5; cx.strokeStyle = dominant; cx.globalAlpha = .55; cx.stroke(); cx.globalAlpha = 1;
  const sh = cx.createLinearGradient(0, c - rD, 0, c + rD * .2);
  sh.addColorStop(0, 'rgba(255,255,255,.14)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
  cx.beginPath(); cx.arc(c, c, rD - 2, Math.PI, TAU); cx.fillStyle = sh; cx.fill();
  cx.fillStyle = '#fff';
  cx.font = `700 ${Math.round((label.length >= 4 ? 50 : label.length === 3 ? 60 : 70) * sc)}px "Space Grotesk",system-ui,sans-serif`;
  cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(label, c, c + 2 * sc);
  const sp = makeSprite(cv); spriteCache.set(sig, sp); return sp.clone();
}

const dotCache = new Map<string, THREE.Sprite>();
function dotSprite(color: string, urgency: number): THREE.Sprite {
  const sig = `${color}|${Math.round(urgency * 10)}`;
  const hit = dotCache.get(sig); if (hit) return hit.clone();
  const dpr = Math.min(devicePixelRatio || 1, 2); const S = 64;
  const cv = document.createElement('canvas'); cv.width = cv.height = S * dpr;
  const cx = cv.getContext('2d')!; cx.scale(dpr, dpr);
  const c = S / 2; const TAU = Math.PI * 2;
  const r = c * 0.52; // proportional core dot radius
  if (urgency >= 1.9) {
    cx.beginPath(); cx.arc(c, c, c - 2, 0, TAU); cx.strokeStyle = color; cx.lineWidth = 2.5;
    cx.globalAlpha = urgency >= 2.5 ? .55 : .35; cx.stroke(); cx.globalAlpha = 1;
  }
  cx.beginPath(); cx.arc(c, c, r, 0, TAU); cx.fillStyle = color; cx.fill();
  cx.beginPath(); cx.arc(c, c, r, 0, TAU); cx.strokeStyle = 'rgba(255,255,255,.75)'; cx.lineWidth = 2; cx.stroke();
  cx.beginPath(); cx.arc(c, c, r + 1, 0, TAU); cx.strokeStyle = 'rgba(0,0,0,.3)'; cx.lineWidth = 1; cx.stroke();
  cx.beginPath(); cx.arc(c - r * .28, c - r * .28, r * .22, 0, TAU); cx.fillStyle = 'rgba(255,255,255,.4)'; cx.fill();
  const sp = makeSprite(cv); dotCache.set(sig, sp); return sp.clone();
}

const clLat = (d: any) => d.lat;
const clLng = (d: any) => d.lng;

function GlobeView({ yearLangs, width, height, filters, autoRotate, theme, onUserInteract, onSelect, onClusterSelect }: Props) {
  const gt = GLOBE_THEME[theme];
  const globeEl = useRef<any>(null);
  const [land, setLand] = useState<any[]>([]);

  // Single camera state drives all visibility — one source of truth.
  const [cam, setCam] = useState<Cam>({ lat: 12, lng: 24, dist: 350 });
  const camRef = useRef<Cam>({ lat: 12, lng: 24, dist: 350 });

  // Zoom tier. At closest zoom (dist ≤ 145) cell=0 disables grid clustering so
  // languages spread out into individual dots — the user can zoom in to see them.
  const cell = cam.dist > 420 ? 22 : cam.dist > 320 ? 14 : cam.dist > 250 ? 9 : cam.dist > 185 ? 5 : cam.dist > 145 ? 3 : 0;
  const permSize = cam.dist > 420 ? 8 : cam.dist > 320 ? 7 : cam.dist > 250 ? 6 : cam.dist > 185 ? 4.5 : 3.5;

  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onClusterRef = useRef(onClusterSelect); onClusterRef.current = onClusterSelect;
  const onInteractRef = useRef(onUserInteract); onInteractRef.current = onUserInteract;

  // ── STABLE LAYER (only recomputes when data/filters change) ──────────────
  // Pipeline order matters:
  //   1. Build raw points (no jitter) — real coordinates for proximity test.
  //   2. proximityClusterize on raw coords — captures co-located languages
  //      before jitter could push them beyond the 0.25 ° threshold.
  //   3. dedupeJitter only on the leftover free points — fans out coordinate
  //      duplicates that didn't make it into a perm cluster.
  // This guarantees perm-cluster members are never rendered as individual dots.

  const rawPts = useMemo<Pt[]>(() => {
    const out: Pt[] = [];
    for (const l of yearLangs) {
      if (l.latitude_map == null || l.longitude_map == null) continue;
      if (!filters[l.vitality_group]) continue;
      out.push({ iso: l.iso_code, name: l.name, lat: l.latitude_map, lng: l.longitude_map, group: l.vitality_group, level: l.risk, color: GROUP_COLOR[l.vitality_group], urgency: LEVEL_URGENCY[l.risk] });
    }
    return out;
  }, [yearLangs, filters]);

  const { permClusters, freePts: rawFreePts } = useMemo(() => proximityClusterize(rawPts), [rawPts]);

  // Jitter only the points that are free — perm-cluster members are hidden
  // behind the badge and must not also appear as individual dots.
  const freePts = useMemo(() => dedupeJitter(rawFreePts), [rawFreePts]);

  // ── CAMERA LAYER (cheap O(n) filter, runs on camera change) ───────────────
  // isVisible uses the geometric formula: only points whose surface normal
  // faces the camera within the actual view frustum are included. At close
  // zoom this can cut 95 % of points; at far zoom still cuts ~30 %.

  const visiblePerm = useMemo(
    () => permClusters.filter(c => isVisible(c.lat, c.lng, cam)),
    [permClusters, cam],
  );

  const visibleFree = useMemo(() => {
    const t2 = PERM_EXCL_THRESHOLD * PERM_EXCL_THRESHOLD;
    return freePts.filter(p => {
      if (!isVisible(p.lat, p.lng, cam)) return false;
      // Hide free dots that would render visually behind a perm cluster badge.
      for (const c of visiblePerm) {
        const dl = p.lat - c.lat; const dg = p.lng - c.lng;
        if (dl * dl + dg * dg < t2) return false;
      }
      return true;
    });
  }, [freePts, visiblePerm, cam]);

  const { clusters: gridClusters, singles } = useMemo(
    () => gridClusterize(visibleFree, cell),
    [visibleFree, cell],
  );

  const globeObjects = useMemo<GlobeObj[]>(() => [
    ...gridClusters.map((c): GridObj => ({ kind: 'grid', ...c })),
    ...visiblePerm.map((c): PermObj => ({ kind: 'perm', ...c, size: permSize })),
    ...singles.map((p): DotObj => ({ kind: 'dot', lat: p.lat, lng: p.lng, iso: p.iso, name: p.name, color: p.color, urgency: p.urgency })),
  ], [gridClusters, visiblePerm, singles, permSize]);

  const zoomInto = useCallback((lat: number, lng: number) => {
    const g = globeEl.current; if (!g) return;
    const alt = g.camera().position.length() / 100 - 1;
    g.pointOfView({ lat, lng, altitude: Math.max(0.25, alt * 0.55) }, 700);
    onInteractRef.current();
  }, []);
  const zoomRef = useRef(zoomInto); zoomRef.current = zoomInto;

  useEffect(() => {
    let alive = true;
    fetch(COUNTRIES_URL).then(r => r.json()).then(d => alive && setLand(d.features ?? [])).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const g = globeEl.current; if (!g) return;

    // Cap pixel ratio: HiDPI screens would otherwise render at 3–4× resolution
    // for no perceptible quality gain. 1.5 is the sweet spot — crisp on Retina,
    // half the fragment shader work of native 2×.
    g.renderer().setPixelRatio(Math.min(window.devicePixelRatio, 1.5));

    const ctrl = g.controls();
    ctrl.autoRotate = autoRotate; ctrl.autoRotateSpeed = 0.32;
    ctrl.enableDamping = true; ctrl.dampingFactor = 0.12;
    ctrl.minDistance = 110; ctrl.maxDistance = 520;
    ctrl.enablePan = false; ctrl.zoomToCursor = true;
    g.pointOfView({ lat: 12, lng: 24, altitude: 2.5 }, 0);

    // Commit a new cam state only when the view has moved enough to matter.
    // dist threshold: 8 units; angle threshold: 1.5 °.
    const onChange = () => {
      const dist = g.camera().position.length();
      const pov = g.pointOfView();
      const prev = camRef.current;
      if (
        Math.abs(dist - prev.dist) > 18 ||
        Math.abs(pov.lat - prev.lat) > 3 ||
        Math.abs(pov.lng - prev.lng) > 3
      ) {
        const next: Cam = { lat: pov.lat, lng: pov.lng, dist };
        camRef.current = next;
        setCam(next);
      }
    };
    ctrl.addEventListener('change', onChange);
    onChange();

    // Demand rendering: pause the Three.js loop when nothing is moving to free
    // the GPU entirely. Resume for 2 s on any interaction, then pause again.
    // Auto-rotation keeps the loop alive as long as it's on.
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const wake = () => {
      if (idleTimer) clearTimeout(idleTimer);
      g.resumeAnimation();
      if (!ctrl.autoRotate) {
        idleTimer = setTimeout(() => g.pauseAnimation(), 2000);
      }
    };
    if (!autoRotate) {
      // Start paused; wake on first interaction.
      idleTimer = setTimeout(() => g.pauseAnimation(), 500);
    }

    const canvas: HTMLElement = g.renderer().domElement;
    let downX = 0; let downY = 0; let dragging = false;
    const onDown = (e: PointerEvent) => { wake(); downX = e.clientX; downY = e.clientY; dragging = false; };
    const onMove = (e: PointerEvent) => {
      if (dragging || (e.buttons & 1) === 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) { dragging = true; onInteractRef.current(); }
    };
    const onWheel = () => { wake(); onInteractRef.current(); };
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      if (idleTimer) clearTimeout(idleTimer);
      ctrl.removeEventListener('change', onChange);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const g = globeEl.current; if (!g) return;
    g.controls().autoRotate = autoRotate;
    if (autoRotate) g.resumeAnimation(); else g.pauseAnimation();
  }, [autoRotate]);

  const buildObject = useCallback((d: GlobeObj) => {
    if (d.kind === 'grid') {
      const sp = badgeSprite(d.shares, d.color, fmtCount(d.count));
      sp.scale.set(d.size, d.size, 1); return sp;
    }
    if (d.kind === 'perm') {
      const sp = permBadgeSprite(d.shares, d.color, fmtCount(d.count));
      sp.scale.set(d.size, d.size, 1); return sp;
    }
    const sp = dotSprite(d.color, d.urgency);
    sp.scale.set(2.6, 2.6, 1); return sp;
  }, []);

  return (
    <Globe
      ref={globeEl}
      width={width} height={height}
      backgroundColor="rgba(0,0,0,0)"
      globeImageUrl={gt.globeImageUrl}
      bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png"
      showAtmosphere atmosphereColor={gt.atmosphereColor} atmosphereAltitude={0.16}
      polygonsData={land}
      polygonCapColor={() => gt.capColor} polygonSideColor={() => gt.sideColor}
      polygonStrokeColor={() => gt.strokeColor} polygonAltitude={0.006}
      polygonsTransitionDuration={400}
      objectsData={globeObjects}
      objectLat={clLat} objectLng={clLng}
      objectAltitude={(d: any) => d.kind === 'dot' ? 0.012 : 0.05}
      objectFacesSurfaces={false}
      objectThreeObject={buildObject as any}
      objectLabel={(d: any) => d.kind === 'dot' ? d.name : ''}
      onObjectClick={(d: any) => {
        if (d.kind === 'grid') {
          // Small cluster → show language list; large → zoom in to break it apart
          if (d.count <= 15) onClusterRef.current(d.members.map((m: ClusterMember) => m.iso));
          else zoomRef.current(d.lat, d.lng);
        } else if (d.kind === 'perm') {
          onClusterRef.current(d.members.map((m: ClusterMember) => m.iso));
        } else {
          onSelectRef.current(d.iso);
        }
      }}
    />
  );
}

export default memo(GlobeView);
