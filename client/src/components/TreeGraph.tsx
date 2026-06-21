import { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  getCachedYear,
  loadYear,
  TL_MAX_YEAR,
  GROUP_COLOR,
  GROUP_LABEL,
  type VitalityGroup,
  type YearLang,
  type YearData,
} from '../data/timeline';
import { buildMajorGroups, type MajorGroup } from '../data/treeData';
import { FAMILY_BY_NAME } from '../data/families';

interface Props {
  year: number;
  yearData: YearData | null;
  selectedIso: string | null;
  onSelect: (iso: string) => void;
}

// The skeleton (which groups exist and where each leaf sits) is built once
// from the most complete snapshot, so scrubbing years only recolours leaves and
// never reshuffles the tree.
const SKELETON_YEAR = TL_MAX_YEAR;

const MIN_Z = 1;
const MAX_Z = 6;

// --- viewBox & root of the tree -------------------------------------------
const VW = 1480;
const VH = 880;
const BASE = { x: VW / 2, y: 846 };

// Canopy dome: a wide, shallow ellipse high above the trunk crown. Cluster
// centres are packed inside it (biggest near the middle) so the crown reads as
// one rounded, balanced mass instead of a sideways fan.
const DOME = { cx: BASE.x, cy: 400, rx: 372, ry: 158 };

type Pt = { x: number; y: number };

interface Branch {
  d: string;
  light: boolean;
}
interface Leaf {
  iso: string;
  name: string;
  fam: string;
  x: number;
  y: number;
  r: number;
  // Per-leaf animation timings (grow-in/fall delay, drift, spin) are baked into
  // one stable style object at build time, so re-renders never allocate a fresh
  // style and <LeafDot> can memoise on it by reference.
  style: React.CSSProperties;
}
interface GroupHit {
  name: string;
  cx: number;
  cy: number;
  r: number;
}
interface GroupLabel {
  name: string;
  x: number;
  y: number;
}
interface Puff {
  x: number;
  y: number;
  r: number;
  isos: string[];
}
interface GroupInfo {
  langs: YearLang[];
  pooled: boolean;
  subFamilies: string[];
}
interface Forest {
  branches: Branch[];
  puffs: Puff[];
  leaves: Leaf[];
  groupHits: GroupHit[];
  groupLabels: GroupLabel[];
  groups: Map<string, GroupInfo>;
  total: number;
}

// deterministic RNG so the tree shape stays put while years scrub.
function rng(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// angle measured from straight up (0 = up, +clockwise)
const dir = (ang: number): Pt => ({ x: Math.sin(ang), y: -Math.cos(ang) });

// soft, capped scaling: a 426-language group is only ~2x the radius of a
// 30-language one, so big families read bigger but the crown stays balanced.
const radiusOf = (n: number) => Math.max(30, Math.min(66, 15 + Math.sqrt(n) * 3.1));

function buildForest(groups: MajorGroup[]): Forest {
  const rand = rng(0x5eed42);
  const jit = (a: number) => (rand() * 2 - 1) * a;

  const branches: Branch[] = [];
  const puffs: Puff[] = [];
  const leaves: Leaf[] = [];
  const groupHits: GroupHit[] = [];
  const groupLabels: GroupLabel[] = [];
  const info = new Map<string, GroupInfo>();
  let seq = 0;

  for (const g of groups) {
    info.set(g.name, { langs: g.langs, pooled: g.pooled, subFamilies: g.subFamilies });
  }
  const total = groups.reduce((n, g) => n + g.size, 0);

  // --- tapered ribbon (a filled, tapering branch following a quad curve) ---
  function ribbon(p0: Pt, c: Pt, p1: Pt, w0: number, w1: number, seg = 14): string {
    const L: string[] = [];
    const R: string[] = [];
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      const mt = 1 - t;
      const x = mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x;
      const y = mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y;
      let tx = 2 * mt * (c.x - p0.x) + 2 * t * (p1.x - c.x);
      let ty = 2 * mt * (c.y - p0.y) + 2 * t * (p1.y - c.y);
      const ln = Math.hypot(tx, ty) || 1;
      tx /= ln;
      ty /= ln;
      const w = (w0 + (w1 - w0) * t) / 2;
      L.push(`${(x - ty * w).toFixed(1)} ${(y + tx * w).toFixed(1)}`);
      R.push(`${(x + ty * w).toFixed(1)} ${(y - tx * w).toFixed(1)}`);
    }
    return `M${L.join('L')}L${R.reverse().join('L')}Z`;
  }

  interface B {
    p0: Pt;
    c: Pt;
    p1: Pt;
    sample: (t: number) => { x: number; y: number; ang: number };
  }

  function branch(
    p0: Pt,
    ang: number,
    len: number,
    w0: number,
    w1: number,
    outward: number,
    up: number,
    light: boolean,
  ): B {
    const d0 = dir(ang);
    const p1 = { x: p0.x + d0.x * len, y: p0.y + d0.y * len };
    const mid = { x: p0.x + d0.x * len * 0.5, y: p0.y + d0.y * len * 0.5 };
    const c = { x: mid.x + outward, y: mid.y - up };
    branches.push({ d: ribbon(p0, c, p1, w0, w1), light });
    const sample = (t: number) => {
      const mt = 1 - t;
      const x = mt * mt * p0.x + 2 * mt * t * c.x + t * t * p1.x;
      const y = mt * mt * p0.y + 2 * mt * t * c.y + t * t * p1.y;
      const tx = 2 * mt * (c.x - p0.x) + 2 * t * (p1.x - c.x);
      const ty = 2 * mt * (c.y - p0.y) + 2 * t * (p1.y - c.y);
      return { x, y, ang: Math.atan2(tx, -ty) };
    };
    return { p0, c, p1, sample };
  }

  // fill a group's languages as a dense, rounded clump around its centre — a
  // uniform disc fill with a slight upward bias so the cluster reads as a leafy
  // mass instead of scattered confetti.
  function clump(cx: number, cy: number, r: number, langs: YearLang[], fam: string) {
    for (const l of langs) {
      const a = rand() * Math.PI * 2;
      const rad = Math.sqrt(rand()) * r;
      const ox = Math.cos(a) * rad;
      const oy = Math.sin(a) * rad * 0.92 - r * 0.12;
      const gd = 0.1 + seq * 0.0006 + rand() * 0.15; // grow-in delay (s)
      const fd = rand() * 0.25; // fall delay (s)
      const drift = jit(40); // horizontal drift while falling (px)
      const spin = jit(150); // rotation while falling (deg)
      leaves.push({
        iso: l.iso_code,
        name: l.name,
        fam,
        x: cx + ox,
        y: cy + oy,
        r: 2.2 + rand() * 1.4,
        style: {
          ['--gd' as string]: `${gd.toFixed(2)}s`,
          ['--fd' as string]: `${fd.toFixed(2)}s`,
          ['--drift' as string]: `${drift.toFixed(0)}px`,
          ['--spin' as string]: `${spin.toFixed(0)}deg`,
        } as React.CSSProperties,
      });
      seq++;
    }
  }

  // --- trunk ---------------------------------------------------------------
  const trunk = branch(BASE, jit(0.03), 132, 48, 24, jit(8), 0, false);
  const crown = trunk.sample(1);

  // --- major groups packed into the dome -----------------------------------
  const n = groups.length;
  const GA = Math.PI * (3 - Math.sqrt(5)); // golden angle → even sunflower fill
  groups.forEach((g, i) => {
    // phyllotaxis: even area fill, biggest group (i=0) nearest the centre.
    const t = (i + 0.5) / n;
    const rf = Math.sqrt(t);
    const ang = i * GA;
    const cx = DOME.cx + Math.cos(ang) * DOME.rx * rf + jit(14);
    const cy = DOME.cy + Math.sin(ang) * DOME.ry * rf + jit(10);
    const r = radiusOf(g.size);

    // Limbs leave the trunk at staggered heights instead of one crown point:
    // the further a cluster sits from the trunk axis, the lower its limb starts,
    // so branches sweep out at wide angles and stay short — like a real tree
    // rather than a firework from a single hub. A sideways bow adds the curve.
    const hf = Math.min(1, Math.abs(cx - crown.x) / DOME.rx);
    const sp = trunk.sample(1 - 0.62 * hf);
    const dx = cx - sp.x;
    const dy = cy - sp.y;
    const blen = Math.hypot(dx, dy) || 1;
    const bang = Math.atan2(dx, -dy);
    const w0 = Math.max(5, 12 - i * 0.4);
    // Bow toward the trunk axis (concave-outward) so each limb leaves the trunk
    // climbing, then arcs up into the canopy — the vase sweep of a real tree.
    const bow = -Math.sign(dx || 1) * Math.min(86, blen * 0.3);
    branch(sp, bang, blen, w0, 3, bow, blen * 0.05, i >= Math.floor(n / 2));

    groupHits.push({ name: g.name, cx, cy, r });
    groupLabels.push({ name: g.name, x: cx, y: cy - r - 7 });

    // soft foliage mass behind the leaves — kept close to the clump so each
    // cluster stays its own distinguishable mass rather than bleeding together.
    puffs.push({ x: cx, y: cy - r * 0.16, r: r * 0.9 + 4, isos: g.langs.map((l) => l.iso_code) });

    clump(cx, cy, r, g.langs, g.name);
  });

  return { branches, puffs, leaves, groupHits, groupLabels, groups: info, total };
}

const GROUP_ORDER_TREE: VitalityGroup[] = ['healthy', 'watch', 'serious', 'gone', 'unknown'];

function groupOf(map: Map<string, YearLang>, iso: string): VitalityGroup {
  return map.get(iso)?.vitality_group ?? 'unknown';
}

// A single leaf. Memoised so a year scrub only re-renders the handful of leaves
// whose vitality group actually changed: `cls` is the sole varying prop (its
// string value is stable when the group is unchanged), and `style` is a stable
// reference baked at build time. Click handling is delegated to the parent <g>,
// so leaves carry no per-element closures.
const LeafDot = memo(function LeafDot({
  iso,
  name,
  fam,
  x,
  y,
  r,
  cls,
  style,
}: {
  iso: string;
  name: string;
  fam: string;
  x: number;
  y: number;
  r: number;
  cls: string;
  style: React.CSSProperties;
}) {
  return (
    <circle className={cls} cx={x} cy={y} r={r} style={style} data-iso={iso}>
      <title>
        {name} · {fam}
      </title>
    </circle>
  );
});

export default function TreeGraph({ year, yearData, selectedIso, onSelect }: Props) {
  // Stable skeleton: load the most complete snapshot once, build the forest.
  const [roster, setRoster] = useState<YearLang[] | null>(
    () => getCachedYear(SKELETON_YEAR)?.languages ?? null,
  );
  useEffect(() => {
    if (roster) return;
    loadYear(SKELETON_YEAR)
      .then((d) => setRoster(d.languages))
      .catch(() => {});
  }, [roster]);

  const forest = useMemo(() => (roster ? buildForest(buildMajorGroups(roster)) : null), [roster]);

  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  // Per-year vitality lookup — only this recomputes as years scrub.
  const byIso = useMemo(() => {
    const m = new Map<string, YearLang>();
    if (yearData) for (const l of yearData.languages) m.set(l.iso_code, l);
    return m;
  }, [yearData]);

  // pinch-free zoom + pan over the canvas.
  const stageRef = useRef<HTMLDivElement>(null);
  const [tf, setTf] = useState({ z: 1, x: 0, y: 0 });
  const pan = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      setTf((t) => {
        const nz = Math.min(MAX_Z, Math.max(MIN_Z, t.z * Math.exp(-e.deltaY * 0.0015)));
        if (nz === MIN_Z) return { z: 1, x: 0, y: 0 };
        const k = nz / t.z;
        return { z: nz, x: cx - k * (cx - t.x), y: cy - k * (cy - t.y) };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    pan.current = { x: tf.x, y: tf.y, px: e.clientX, py: e.clientY, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const p = pan.current;
    if (!p) return;
    const dx = e.clientX - p.px;
    const dy = e.clientY - p.py;
    if (!p.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!p.moved) {
      p.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setTf((t) => (t.z <= 1 ? t : { ...t, x: p.x + dx, y: p.y + dy }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const p = pan.current;
    pan.current = null;
    if (p?.moved) e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  // One delegated handler for all leaves instead of 3,371 per-circle closures —
  // keeps <LeafDot> props stable so memoisation holds across year scrubs.
  const onLeafClick = (e: React.MouseEvent) => {
    const iso = (e.target as Element).closest('[data-iso]')?.getAttribute('data-iso');
    if (iso) {
      e.stopPropagation();
      onSelect(iso);
    }
  };

  const zoomBy = (factor: number) => {
    const el = stageRef.current;
    const cx = el ? el.clientWidth / 2 : 0;
    const cy = el ? el.clientHeight / 2 : 0;
    setTf((t) => {
      const nz = Math.min(MAX_Z, Math.max(MIN_Z, t.z * factor));
      if (nz === MIN_Z) return { z: 1, x: 0, y: 0 };
      const k = nz / t.z;
      return { z: nz, x: cx - k * (cx - t.x), y: cy - k * (cy - t.y) };
    });
  };

  // Cap-panel counts: living = healthy, fading = watch + serious, fallen = gone + unknown.
  const counts = useMemo(() => {
    let living = 0;
    let fading = 0;
    let fallen = 0;
    if (yearData) {
      for (const l of yearData.languages) {
        if (l.vitality_group === 'healthy') living++;
        else if (l.vitality_group === 'watch' || l.vitality_group === 'serious') fading++;
        else if (l.vitality_group === 'gone' || l.vitality_group === 'unknown') fallen++;
      }
    }
    return { living, fading, fallen };
  }, [yearData]);

  // Languages whose last voice has fallen silent by this year (including unknown status).
  const fallenList = useMemo(
    () =>
      yearData
        ? yearData.languages
            .filter((l) => l.vitality_group === 'gone' || l.vitality_group === 'unknown')
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
    [yearData],
  );

  const selData = sel ? forest?.groups.get(sel) ?? null : null;
  const selCounts = useMemo(() => {
    if (!selData) return null;
    const c: Record<VitalityGroup, number> = { healthy: 0, watch: 0, serious: 0, gone: 0, unknown: 0 };
    for (const l of selData.langs) c[groupOf(byIso, l.iso_code)]++;
    return c;
  }, [selData, byIso]);

  return (
    <div className="tree-page">
      <div className="ltree-stage" ref={stageRef}>
        <div
          className={`ltree-zoom${tf.z > 1 ? ' pannable' : ''}`}
          style={{ transform: `translate(${tf.x}px, ${tf.y}px) scale(${tf.z})` }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <svg className="ltree" viewBox={`0 0 ${VW} ${VH}`} preserveAspectRatio="xMidYMax meet">
            <defs>
              <radialGradient id="halo" cx="50%" cy="34%" r="48%">
                <stop offset="0%" stopColor="rgba(74,224,168,0.22)" />
                <stop offset="55%" stopColor="rgba(74,224,168,0.07)" />
                <stop offset="100%" stopColor="rgba(74,224,168,0)" />
              </radialGradient>
              <radialGradient id="foliage" cx="50%" cy="44%" r="56%">
                <stop offset="0%" stopColor="rgba(72,216,150,0.5)" />
                <stop offset="62%" stopColor="rgba(52,166,118,0.22)" />
                <stop offset="100%" stopColor="rgba(52,166,118,0)" />
              </radialGradient>
              <radialGradient id="ground" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="rgba(0,0,0,0.5)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0)" />
              </radialGradient>
              <linearGradient id="bark" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#2c3442" />
                <stop offset="100%" stopColor="#586a82" />
              </linearGradient>
              <linearGradient id="barkL" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor="#3c4658" />
                <stop offset="100%" stopColor="#6e7f99" />
              </linearGradient>
              <filter id="softblur" x="-40%" y="-40%" width="180%" height="180%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>

            <rect x="0" y="0" width={VW} height={VH} fill="url(#halo)" />
            <ellipse cx={BASE.x} cy={BASE.y + 6} rx="180" ry="15" fill="url(#ground)" />

            {forest && (
              <g className="lt-canopy">
                <g className="lt-branches">
                  {forest.branches.map((b, i) => (
                    <path key={i} d={b.d} fill={b.light ? 'url(#barkL)' : 'url(#bark)'} />
                  ))}
                </g>

                <g className="lt-foliage" filter="url(#softblur)">
                  {forest.puffs.map((p, i) => {
                    let live = 0;
                    for (const iso of p.isos) if (groupOf(byIso, iso) !== 'gone') live++;
                    const op = p.isos.length ? 0.16 + 0.5 * (live / p.isos.length) : 0.16;
                    return <circle key={i} cx={p.x} cy={p.y} r={p.r} fill="url(#foliage)" opacity={op} />;
                  })}
                </g>

                <g className="lt-fams">
                  {forest.groupHits.map((f) => (
                    <circle
                      key={f.name}
                      className={`lt-ghit${sel === f.name ? ' on' : ''}${hover === f.name ? ' hv' : ''}`}
                      cx={f.cx}
                      cy={f.cy}
                      r={f.r + 6}
                      onMouseEnter={() => setHover(f.name)}
                      onMouseLeave={() => setHover((h) => (h === f.name ? null : h))}
                      onClick={() => setSel((s) => (s === f.name ? null : f.name))}
                    />
                  ))}
                </g>

                <g className="lt-leaves" onClick={onLeafClick}>
                  {forest.leaves.map((lf) => (
                    <LeafDot
                      key={lf.iso}
                      iso={lf.iso}
                      name={lf.name}
                      fam={lf.fam}
                      x={lf.x}
                      y={lf.y}
                      r={lf.r}
                      style={lf.style}
                      cls={`leaf grp-${groupOf(byIso, lf.iso)}${sel && lf.fam !== sel ? ' dim' : ''}`}
                    />
                  ))}
                </g>

                <g className="lt-glabels">
                  {forest.groupLabels.map((c) => (
                    <text
                      key={c.name}
                      x={c.x}
                      y={c.y}
                      textAnchor="middle"
                      className={`lt-glabel${sel === c.name ? ' on' : ''}${hover === c.name ? ' hv' : ''}`}
                      onMouseEnter={() => setHover(c.name)}
                      onMouseLeave={() => setHover((h) => (h === c.name ? null : h))}
                      onClick={() => setSel((s) => (s === c.name ? null : c.name))}
                    >
                      {c.name}
                    </text>
                  ))}
                </g>
              </g>
            )}
          </svg>
        </div>
        <div className="tree-zoom-ctrl">
          <button onClick={() => zoomBy(1.4)} aria-label="Zoom in">+</button>
          <button onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">−</button>
          <button className="tz-reset" onClick={() => setTf({ z: 1, x: 0, y: 0 })} aria-label="Reset zoom">
            ⤢
          </button>
        </div>
      </div>

      <div className="ltree-cap panel">
        <p className="lc-above">
          A living genealogy · <span className="num">{year}</span>
        </p>
        <h2 className="lc-title">
          {(forest?.total ?? 0).toLocaleString()} leaves,
          <br />
          one canopy
        </h2>
        <div className="lc-rule" />
        <p className="lc-sub">
          Every leaf is a language, clustered by major family. <span className="k alive">Green</span>{' '}
          still breathes, <span className="k atrisk">amber</span> is fading; when its last voice falls
          silent the leaf blackens and drops. Drag the years to watch the canopy thin.
        </p>
        <div className="lc-legend">
          <div className="lc-chip alive">
            <span className="lc-dot" />
            <span className="num">{counts.living.toLocaleString()}</span>
            <span className="lc-lab">living</span>
          </div>
          <div className="lc-chip atrisk">
            <span className="lc-dot" />
            <span className="num">{counts.fading.toLocaleString()}</span>
            <span className="lc-lab">fading</span>
          </div>
          <div className="lc-chip lost">
            <span className="lc-dot" />
            <span className="num">{counts.fallen.toLocaleString()}</span>
            <span className="lc-lab">fallen</span>
          </div>
        </div>
      </div>

      {selectedIso === null && (
        <aside className="fallen panel">
          <div className="fallen-head">
            <span className="fallen-title">Fallen silent</span>
            <span className="fallen-count num">{fallenList.length.toLocaleString()}</span>
          </div>
          {fallenList.length === 0 ? (
            <p className="fallen-empty">None yet — drag the years forward to watch them go.</p>
          ) : (
            <ul className="fallen-list">
              {fallenList.map((l) => (
                <li key={l.iso_code}>
                  <button className="fallen-item" onClick={() => onSelect(l.iso_code)}>
                    <span className="fallen-name">{l.name}</span>
                    <span className="fallen-meta">
                      <span className="fallen-fam">{l.family_root}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      )}

      {sel && selData && selCounts && (
        <aside
          className="fam-drawer"
          style={{ ['--accent' as string]: GROUP_COLOR[dominant(selCounts)] } as React.CSSProperties}
        >
          <button className="fd-close" onClick={() => setSel(null)} aria-label="Close">
            ×
          </button>
          <FamilyDetail
            name={sel}
            pooled={selData.pooled}
            subFamilies={selData.subFamilies}
            langs={selData.langs}
            byIso={byIso}
            onSelect={onSelect}
          />
        </aside>
      )}
    </div>
  );
}

function dominant(c: Record<VitalityGroup, number>): VitalityGroup {
  let best: VitalityGroup = 'healthy';
  let bestN = -1;
  for (const g of GROUP_ORDER_TREE) {
    if (c[g] > bestN) {
      bestN = c[g];
      best = g;
    }
  }
  return best;
}

function FamilyDetail({
  name,
  pooled,
  subFamilies,
  langs,
  byIso,
  onSelect,
}: {
  name: string;
  pooled: boolean;
  subFamilies: string[];
  langs: YearLang[];
  byIso: Map<string, YearLang>;
  onSelect: (iso: string) => void;
}) {
  const info = FAMILY_BY_NAME.get(name);
  const blurb = pooled
    ? `Smaller families of this region grouped together — ${subFamilies.length.toLocaleString()} families too small for their own cluster, but every language is still a leaf above.`
    : info?.blurb ?? 'A major language family in the genealogy — each leaf one of its tongues.';

  const sorted = useMemo(() => [...langs].sort((a, b) => a.name.localeCompare(b.name)), [langs]);

  return (
    <>
      <div className="fd-top">
        <h3>{name}</h3>
        <span className="fd-n">{langs.length.toLocaleString()} languages</span>
      </div>
      <p className="fd-blurb">{blurb}</p>
      <ul className="fd-flat">
        {sorted.map((l) => {
          const g = byIso.get(l.iso_code)?.vitality_group ?? 'unknown';
          return (
            <li key={l.iso_code}>
              <button className="fd-leaf" onClick={() => onSelect(l.iso_code)}>
                <span className="fd-pip" style={{ background: GROUP_COLOR[g] }} />
                <span className="fd-lname">{l.name}</span>
                <span className="fd-lreg">{GROUP_LABEL[g]}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
