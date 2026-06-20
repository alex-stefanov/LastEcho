import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
}

const GLOBE_THEME = {
  dark: { globeImageUrl: 'https://unpkg.com/three-globe/example/img/earth-dark.jpg', atmosphereColor: '#3b6f9e', capColor: 'rgba(104, 124, 156, 0.55)', sideColor: 'rgba(104, 124, 156, 0.06)', strokeColor: 'rgba(168, 190, 220, 0.4)' },
  light: { globeImageUrl: 'https://unpkg.com/three-globe/example/img/earth-day.jpg', atmosphereColor: '#9ec3e8', capColor: 'rgba(70, 96, 140, 0.28)', sideColor: 'rgba(70, 96, 140, 0.05)', strokeColor: 'rgba(54, 78, 120, 0.45)' },
} as const;

const COUNTRIES_URL = 'https://cdn.jsdelivr.net/gh/vasturiano/globe.gl/example/datasets/ne_110m_admin_0_countries.geojson';

interface Pt {
  iso: string;
  name: string;
  lat: number;
  lng: number;
  group: VitalityGroup;
  level: YearRisk;
  color: string;
  urgency: number;
}
interface Share { color: string; frac: number; }
interface Cluster { lat: number; lng: number; count: number; color: string; size: number; shares: Share[]; }

const MIN_CLUSTER = 5;

// How hard a badge is pulled from its true centroid toward the center of its
// grid cell. Pure centroids drift to cell borders, so two neighbouring dense
// cells routinely drop badges right on top of each other. Pulling each toward
// its own cell center spreads them onto a relaxed lattice — enough that they
// never swallow one another, while still leaning toward where the languages
// actually are.
const CELL_PULL = 0.5;

// Grid-cluster the points at a given cell size (degrees). Dense cells collapse
// to one badge near their centroid; sparse points pass through as individual
// dots. cell <= 0 disables clustering entirely (fully zoomed in).
function clusterize(pts: Pt[], cell: number): { clusters: Cluster[]; singles: Pt[] } {
  if (cell <= 0) return { clusters: [], singles: pts };
  const cells = new Map<string, Pt[]>();
  for (const p of pts) {
    const key = `${Math.floor((p.lat + 90) / cell)}:${Math.floor((p.lng + 180) / cell)}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(p); else cells.set(key, [p]);
  }
  const clusters: Cluster[] = [];
  const singles: Pt[] = [];
  for (const [key, bucket] of cells) {
    if (bucket.length < MIN_CLUSTER) { singles.push(...bucket); continue; }
    let lat = 0, lng = 0;
    const tally: Record<VitalityGroup, number> = { healthy: 0, watch: 0, serious: 0, gone: 0, unknown: 0 };
    for (const p of bucket) { lat += p.lat; lng += p.lng; tally[p.group]++; }
    const n = bucket.length;

    // Relax the badge position from centroid toward the cell center.
    const [latI, lngI] = key.split(':').map(Number);
    const cLat = latI * cell - 90 + cell / 2;
    const cLng = lngI * cell - 180 + cell / 2;
    const badgeLat = cLat * CELL_PULL + (lat / n) * (1 - CELL_PULL);
    const badgeLng = cLng * CELL_PULL + (lng / n) * (1 - CELL_PULL);

    // Composition ring: one arc per present group (in display order), plus the
    // dominant group for the center tint / glow.
    const shares: Share[] = [];
    let major: VitalityGroup = 'healthy'; let max = -1;
    for (const g of GROUP_ORDER) {
      if (tally[g] > 0) shares.push({ color: GROUP_COLOR[g], frac: tally[g] / n });
      if (tally[g] > max) { max = tally[g]; major = g; }
    }

    // Tight, gently-growing size, then capped to the cell so a badge can never
    // outgrow its own grid square and crash into its neighbours. A degree of
    // longitude/latitude is ~1.75 world units here, so `cell` (in degrees) is
    // comfortably under one cell's world spacing — finer zoom tiers therefore
    // yield smaller, uniform coins. Legibility comes from the number, not a
    // giant disc.
    const sizeCap = Math.min(13, cell);
    const size = Math.min(sizeCap, Math.max(6.5, 5.4 + Math.log2(n) * 1.15));

    clusters.push({ lat: badgeLat, lng: badgeLng, count: n, color: GROUP_COLOR[major], size, shares });
  }
  return { clusters, singles };
}

// Languages that share (near-)identical coordinates — small island nations
// with several distinct entries at one centroid (the "New Zealand problem") —
// otherwise render as one indistinguishable dot even fully zoomed in. Fan them
// out into a tiny ring, far smaller than any cluster cell, so it's invisible
// while clustered and only resolves once they're shown individually.
function dedupeJitter(pts: Pt[]): Pt[] {
  const buckets = new Map<string, Pt[]>();
  for (const p of pts) {
    const key = `${p.lat.toFixed(2)}:${p.lng.toFixed(2)}`;
    const b = buckets.get(key);
    if (b) b.push(p); else buckets.set(key, [p]);
  }
  const out: Pt[] = [];
  for (const group of buckets.values()) {
    if (group.length === 1) { out.push(group[0]); continue; }
    const n = group.length;
    const ringR = 0.045;
    group.forEach((p, i) => {
      const ang = (i / n) * Math.PI * 2;
      out.push({ ...p, lat: p.lat + Math.sin(ang) * ringR, lng: p.lng + Math.cos(ang) * ringR });
    });
  }
  return out;
}

const fmtCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

// Cluster badges are GPU canvas-texture sprites, not DOM — this is what makes
// them cheap. Each is a small "data coin": a frosted dark disc carrying the
// count, wrapped in a thin ring whose arcs show the vitality breakdown of the
// languages inside, so a cluster conveys *how many* and *how endangered* at a
// glance instead of collapsing to one flat hue. depthTest lets the globe hide
// far-side badges; depthWrite is off so the anti-aliased rims blend cleanly.
const spriteCache = new Map<string, THREE.Sprite>();
function badgeSprite(shares: Share[], dominant: string, label: string): THREE.Sprite {
  const sig = `${label}|${dominant}|${shares.map((s) => `${s.color}${Math.round(s.frac * 16)}`).join('-')}`;
  const cached = spriteCache.get(sig);
  if (cached) return cached.clone();

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const S = 220; // logical px; backing store is S*dpr for crisp numerals
  const canvas = document.createElement('canvas');
  canvas.width = S * dpr; canvas.height = S * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const c = S / 2;
  const TWO = Math.PI * 2;

  const rRing = c - 10;          // composition ring centerline
  const ringW = 14;              // ring thickness
  const rDisc = rRing - ringW / 2 - 7; // inner frosted disc

  // soft dark shadow so the coin separates from the busy earth texture
  ctx.beginPath(); ctx.arc(c, c, rRing + ringW / 2 + 3, 0, TWO);
  ctx.fillStyle = 'rgba(3, 5, 12, 0.45)'; ctx.fill();

  // composition ring — one arc per present vitality group
  const gap = shares.length > 1 ? 0.07 : 0;
  let a = -Math.PI / 2;
  ctx.lineWidth = ringW;
  ctx.lineCap = 'butt';
  for (const s of shares) {
    const sweep = s.frac * TWO;
    if (sweep > gap + 0.001) {
      ctx.beginPath();
      ctx.arc(c, c, rRing, a + gap / 2, a + sweep - gap / 2);
      ctx.strokeStyle = s.color;
      ctx.stroke();
    }
    a += sweep;
  }

  // frosted disc — vertical glass gradient
  const disc = ctx.createLinearGradient(0, c - rDisc, 0, c + rDisc);
  disc.addColorStop(0, 'rgba(22, 28, 43, 0.94)');
  disc.addColorStop(1, 'rgba(8, 11, 19, 0.96)');
  ctx.beginPath(); ctx.arc(c, c, rDisc, 0, TWO);
  ctx.fillStyle = disc; ctx.fill();
  // dominant-hue hairline tying disc to ring
  ctx.beginPath(); ctx.arc(c, c, rDisc - 1, 0, TWO);
  ctx.lineWidth = 1.5; ctx.strokeStyle = dominant; ctx.globalAlpha = 0.55; ctx.stroke();
  ctx.globalAlpha = 1;
  // top sheen
  const sheen = ctx.createLinearGradient(0, c - rDisc, 0, c + rDisc * 0.2);
  sheen.addColorStop(0, 'rgba(255, 255, 255, 0.14)');
  sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.beginPath(); ctx.arc(c, c, rDisc - 2, Math.PI, TWO);
  ctx.fillStyle = sheen; ctx.fill();

  // count
  ctx.fillStyle = '#fff';
  const fs = label.length >= 4 ? 58 : label.length === 3 ? 68 : 78;
  ctx.font = `700 ${fs}px "Space Grotesk", system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(label, c, c + 3);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: true });
  const sprite = new THREE.Sprite(material);
  spriteCache.set(sig, sprite);
  return sprite.clone();
}

const ptLat = (d: any) => d.lat;
const ptLng = (d: any) => d.lng;
const ptColor = (d: any) => d.color;
const ptLabel = (d: any) => d.name;
const clLat = (d: any) => d.lat;
const clLng = (d: any) => d.lng;

// Two-layer point design: a dim "halo" underneath and a bright "core" on top,
// at the same lat/lng but different radius/altitude. Color alone (one of 5
// group hues) is the primary signal; the halo's radius is a second, urgency-
// driven channel, so e.g. a critical language and a stable one in different
// groups don't just look like differently-colored dots of the same size —
// the more urgent one visibly glows wider, like a warning ring, without
// simply being "a bigger dot."
function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function GlobeView({ yearLangs, width, height, filters, autoRotate, theme, onUserInteract, onSelect }: Props) {
  const gt = GLOBE_THEME[theme];
  const globeEl = useRef<any>(null);
  const [land, setLand] = useState<any[]>([]);

  // Zoom-driven level of detail. Clustering cell size, point sphere
  // resolution, and base point radius all step by camera-distance tier (180 =
  // closest … 520 = farthest). Auto-rotation holds distance constant, so
  // these fire only on an actual zoom — never per frame.
  const [cell, setCell] = useState(11);
  const [pointRes, setPointRes] = useState(8);
  const [baseRadius, setBaseRadius] = useState(0.22);
  const cellTierRef = useRef(11);
  const resTierRef = useRef(8);
  const radiusTierRef = useRef(0.22);

  const onSelectRef = useRef(onSelect); onSelectRef.current = onSelect;
  const onInteractRef = useRef(onUserInteract); onInteractRef.current = onUserInteract;

  // Visible languages this year (active group filter), with coordinate-
  // duplicates fanned out so they stay distinguishable once shown
  // individually (see dedupeJitter).
  const points = useMemo<Pt[]>(() => {
    const out: Pt[] = [];
    for (const l of yearLangs) {
      if (l.latitude_map == null || l.longitude_map == null) continue;
      if (!filters[l.vitality_group]) continue;
      out.push({
        iso: l.iso_code,
        name: l.name,
        lat: l.latitude_map,
        lng: l.longitude_map,
        group: l.vitality_group,
        level: l.risk,
        color: GROUP_COLOR[l.vitality_group],
        urgency: LEVEL_URGENCY[l.risk],
      });
    }
    return dedupeJitter(out);
  }, [yearLangs, filters]);

  const { clusters, singles } = useMemo(() => clusterize(points, cell), [points, cell]);
  const singlesRef = useRef(singles);
  singlesRef.current = singles;

  const halos = useMemo(
    () => singles.map((p) => ({ ...p, haloColor: hexToRgba(p.color, 0.22) })),
    [singles],
  );

  const zoomInto = useCallback((lat: number, lng: number) => {
    const g = globeEl.current; if (!g) return;
    const alt = g.camera().position.length() / 100 - 1;
    g.pointOfView({ lat, lng, altitude: Math.max(0.35, alt * 0.55) }, 700);
    onInteractRef.current();
  }, []);
  const zoomRef = useRef(zoomInto);
  zoomRef.current = zoomInto;

  useEffect(() => {
    let alive = true;
    fetch(COUNTRIES_URL).then((r) => r.json()).then((d) => alive && setLand(d.features ?? [])).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const g = globeEl.current; if (!g) return;
    const c = g.controls();
    c.autoRotate = autoRotate; c.autoRotateSpeed = 0.32; c.enableDamping = true; c.dampingFactor = 0.12;
    c.minDistance = 180; c.maxDistance = 520; c.enablePan = false;
    g.pointOfView({ lat: 12, lng: 24, altitude: 2.5 }, 0);

    // Map camera distance → clustering cell, point resolution/size.
    const onChange = () => {
      const dist = g.camera().position.length();
      // Coarse cells so clustering yields few, well-spaced coins rather than a
      // dense overlapping carpet — then snaps off to individual dots once you're
      // close enough that a fine badge grid would just look like clutter.
      const nextCell = dist > 420 ? 17 : dist > 320 ? 11 : dist > 250 ? 7 : 0;
      if (nextCell !== cellTierRef.current) { cellTierRef.current = nextCell; setCell(nextCell); }
      const nextRes = dist > 360 ? 3 : dist > 250 ? 10 : 20;
      if (nextRes !== resTierRef.current) { resTierRef.current = nextRes; setPointRes(nextRes); }
      const nextRadius = dist > 360 ? 0.22 : dist > 250 ? 0.3 : dist > 225 ? 0.36 : 0.42;
      if (nextRadius !== radiusTierRef.current) { radiusTierRef.current = nextRadius; setBaseRadius(nextRadius); }
    };
    c.addEventListener('change', onChange);
    onChange();

    // Only a real drag (or zoom) stops the auto-rotation — a plain click,
    // e.g. selecting a point, leaves the planet spinning.
    const canvas: HTMLElement = g.renderer().domElement;
    let downX = 0, downY = 0, dragging = false;
    const onPointerDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; dragging = false; };
    const onPointerMove = (e: PointerEvent) => {
      if (dragging || (e.buttons & 1) === 0) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) { dragging = true; onInteractRef.current(); }
    };
    const onWheel = () => onInteractRef.current();
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      c.removeEventListener('change', onChange);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { const g = globeEl.current; if (g) g.controls().autoRotate = autoRotate; }, [autoRotate]);

  const buildClusterObject = useCallback((d: Cluster) => {
    const sprite = badgeSprite(d.shares, d.color, fmtCount(d.count));
    sprite.scale.set(d.size, d.size, 1);
    return sprite;
  }, []);

  const corePointRadius = useCallback((d: any) => baseRadius * (0.85 + (d as Pt).urgency * 0.06), [baseRadius]);
  const haloPointRadius = useCallback((d: any) => baseRadius * (d as Pt).urgency * 1.7, [baseRadius]);

  return (
    <Globe
      ref={globeEl}
      width={width} height={height}
      backgroundColor="rgba(0,0,0,0)"
      globeImageUrl={gt.globeImageUrl}
      bumpImageUrl="https://unpkg.com/three-globe/example/img/earth-topology.png"
      showAtmosphere atmosphereColor={gt.atmosphereColor} atmosphereAltitude={0.16}
      polygonsData={land} polygonCapColor={() => gt.capColor} polygonSideColor={() => gt.sideColor}
      polygonStrokeColor={() => gt.strokeColor} polygonAltitude={0.006} polygonsTransitionDuration={400}
      pointsData={[...halos, ...singles]}
      pointLat={ptLat} pointLng={ptLng}
      pointColor={(d: any) => (d.haloColor ?? ptColor(d))}
      pointLabel={ptLabel}
      pointAltitude={(d: any) => (d.haloColor ? 0.006 : 0.011)}
      pointRadius={(d: any) => (d.haloColor ? haloPointRadius(d) : corePointRadius(d))}
      pointResolution={pointRes}
      pointsMerge={true}
      pointsTransitionDuration={0}
      objectsData={clusters}
      objectLat={clLat}
      objectLng={clLng}
      objectAltitude={0.05}
      objectFacesSurface={false}
      objectThreeObject={buildClusterObject as any}
      onObjectClick={(d: any) => zoomRef.current(d.lat, d.lng)}
      onGlobeClick={(({ lat, lng }: { lat: number; lng: number }, event: MouseEvent) => {
        // Pick by real on-screen pixel distance to the click — project each
        // nearby candidate's 3D position through the camera the same way the
        // renderer does, instead of comparing geographic angle, which doesn't
        // correspond to how close two dots actually look on screen once the
        // globe is tilted or points sit at different latitudes.
        const g = globeEl.current;
        if (!g) return;
        const renderer = g.renderer();
        const rect = renderer.domElement.getBoundingClientRect();
        const camera = g.camera();
        const tmp = new THREE.Vector3();
        let best: Pt | null = null;
        let bestPx = 28;
        for (const p of singlesRef.current) {
          if (Math.abs(p.lat - lat) > 6 || Math.abs(p.lng - lng) > 6) continue;
          const c = g.getCoords(p.lat, p.lng, 0.01);
          tmp.set(c.x, c.y, c.z).project(camera);
          if (tmp.z > 1) continue; // on the far side of the globe
          const sx = rect.left + (tmp.x * 0.5 + 0.5) * rect.width;
          const sy = rect.top + (1 - (tmp.y * 0.5 + 0.5)) * rect.height;
          const d = Math.hypot(sx - event.clientX, sy - event.clientY);
          if (d < bestPx) { bestPx = d; best = p; }
        }
        if (best) onSelectRef.current(best.iso);
      }) as any}
    />
  );
}
