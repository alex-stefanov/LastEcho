import { useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGES, statusAt, type LangRecord, type Vitality } from '../data/mockLanguages';
import { FAMILY_BY_NAME, MACRO_CATEGORIES, ISOLATE_FAMILY } from '../data/families';

interface Props {
  year: number;
  selected: number | null;
  onSelect: (id: number) => void;
}

const MIN_Z = 1;
const MAX_Z = 6;

// --- viewBox & root of the tree -------------------------------------------
const VW = 1480;
const VH = 880;
const BASE = { x: VW / 2, y: 846 };

type Pt = { x: number; y: number };
type Counts = Record<Vitality, number>;

interface Branch {
  d: string;
  light: boolean;
}
interface Leaf {
  id: number;
  rec: LangRecord;
  x: number;
  y: number;
  r: number;
  gd: number; // grow-in delay (s)
  fd: number; // fall delay (s)
  tw: number; // shimmer period (s)
  drift: number; // horizontal drift while falling (px)
  spin: number; // rotation while falling (deg)
  fam: string;
}
interface FamHit {
  name: string;
  d: string; // centerline (hover/select target)
  x: number;
  y: number;
  side: number;
}
interface CatLabel {
  name: string;
  x: number;
  y: number;
  side: number;
}

interface Puff {
  x: number;
  y: number;
  r: number;
  langs: LangRecord[];
}
interface Forest {
  branches: Branch[];
  puffs: Puff[];
  leaves: Leaf[];
  famHits: FamHit[];
  catLabels: CatLabel[];
  famLangs: Map<string, { langs: LangRecord[]; isolate: boolean }>;
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

function buildForest(): Forest {
  const rand = rng(0x5eed42);
  const jit = (a: number) => (rand() * 2 - 1) * a;

  const branches: Branch[] = [];
  const puffs: Puff[] = [];
  const leaves: Leaf[] = [];
  const famHits: FamHit[] = [];
  const catLabels: CatLabel[] = [];
  const famLangs = new Map<string, { langs: LangRecord[]; isolate: boolean }>();
  let seq = 0;

  // group languages by family
  const byFam = new Map<string, LangRecord[]>();
  const iso: LangRecord[] = [];
  for (const l of LANGUAGES) {
    if (l.family === ISOLATE_FAMILY || !FAMILY_BY_NAME.has(l.family)) iso.push(l);
    else {
      const a = byFam.get(l.family) ?? [];
      a.push(l);
      byFam.set(l.family, a);
    }
  }

  interface FamSpec { name: string; isolate: boolean; langs: LangRecord[] }
  interface CatSpec { name: string; fams: FamSpec[]; size: number }
  const cats: CatSpec[] = [];
  for (const cat of MACRO_CATEGORIES) {
    const fams: FamSpec[] = [];
    for (const fn of cat.families) {
      const ls = byFam.get(fn);
      if (!ls?.length) continue;
      fams.push({ name: fn, isolate: false, langs: ls });
      famLangs.set(fn, { langs: ls, isolate: false });
    }
    fams.sort((a, b) => b.langs.length - a.langs.length);
    if (fams.length) cats.push({ name: cat.name, fams, size: fams.reduce((n, f) => n + f.langs.length, 0) });
  }
  if (iso.length) {
    cats.push({ name: 'Isolates', fams: [{ name: 'Isolates', isolate: true, langs: iso }], size: iso.length });
    famLangs.set('Isolates', { langs: iso, isolate: true });
  }
  const total = cats.reduce((n, c) => n + c.size, 0);

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

  interface B { p0: Pt; c: Pt; p1: Pt; sample: (t: number) => { x: number; y: number; ang: number } }

  function branch(p0: Pt, ang: number, len: number, w0: number, w1: number, outward: number, up: number, light: boolean): B {
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

  const centerline = (b: B) =>
    `M${b.p0.x.toFixed(1)} ${b.p0.y.toFixed(1)}Q${b.c.x.toFixed(1)} ${b.c.y.toFixed(1)} ${b.p1.x.toFixed(1)} ${b.p1.y.toFixed(1)}`;

  // scatter a family/group's languages as a leafy cloud around the outer twig —
  // a rounded blob biased upward and away from the trunk so the canopy sits on
  // top of the branches like real foliage instead of drooping below them.
  function spray(twig: B, langs: LangRecord[], fam: string) {
    const n = langs.length;
    const reach = 16 + Math.sqrt(n) * 7.4; // bushier for bigger families
    const tip = twig.sample(1);
    const awayX = Math.sign(tip.x - BASE.x) || 1; // outward from trunk
    // soft foliage mass behind the leaves so the crown reads as dense canopy
    const cs = twig.sample(0.78);
    puffs.push({ x: cs.x + awayX * 5, y: cs.y - reach * 0.34, r: reach * 1.4 + 10, langs });
    langs.forEach((l, i) => {
      const t = n === 1 ? 0.85 : 0.42 + 0.58 * (i / (n - 1));
      const s = twig.sample(Math.min(1, t));
      const a = rand() * Math.PI * 2;
      const rad = Math.sqrt(rand()) * reach; // uniform disc fill
      const ox = Math.cos(a) * rad + awayX * 5;
      const oy = Math.sin(a) * rad - reach * 0.4; // lift foliage above the twig
      leaves.push({
        id: l.id,
        rec: l,
        fam,
        x: s.x + ox,
        y: s.y + oy,
        r: 3.3 + rand() * 2,
        gd: 0.25 + seq * 0.004 + rand() * 0.3,
        fd: rand() * 0.5,
        tw: 3.4 + rand() * 3.6,
        drift: jit(46),
        spin: jit(150),
      });
      seq++;
    });
  }

  // --- trunk ---------------------------------------------------------------
  const trunk = branch(BASE, jit(0.04), 232, 44, 20, jit(10), 0, false);

  // --- categories (main limbs) --------------------------------------------
  // Limbs emanate from a tight crown high on the trunk and fan wide+upward so
  // the canopy fills the frame and stays balanced regardless of family sizes.
  const nC = cats.length;
  const span = 1.4;
  // Assign the biggest categories to the central (tall, upright) slots and the
  // smaller ones to the outer (flatter) slots, so the heaviest foliage sits at
  // the crown and the canopy reads as a balanced, rounded mass.
  const order = cats.map((_, i) => i).sort((a, b) => cats[b].size - cats[a].size);
  const centerOut: number[] = [];
  let l = Math.floor((nC - 1) / 2);
  let r = l + 1;
  let pickLeft = true;
  while (centerOut.length < nC) {
    if (pickLeft && l >= 0) centerOut.push(l--);
    else if (!pickLeft && r < nC) centerOut.push(r++);
    else if (l >= 0) centerOut.push(l--);
    else centerOut.push(r++);
    pickLeft = !pickLeft;
  }
  const slot: number[] = [];
  order.forEach((idx, k) => {
    slot[idx] = centerOut[k];
  });
  cats.forEach((cat, ci) => {
    const pos = slot[ci];
    const frac = nC === 1 ? 0.5 : pos / (nC - 1);
    const off = -span + 2 * span * frac;
    const start = trunk.sample(0.82 + 0.18 * (1 - Math.abs(off) / span));
    const ang = off * 0.8 + jit(0.04);
    const len = 188 + Math.sqrt(cat.size) * 13;
    const sign = off === 0 ? (jit(1) > 0 ? 1 : -1) : Math.sign(off);
    const limb = branch(start, ang, len, 14, 7, sign * (len * 0.24 + 12), len * 0.52, false);
    const lp = limb.sample(1);
    catLabels.push({ name: cat.name, x: lp.x, y: lp.y, side: Math.sign(off || 0.001) });

    // --- families (boughs) -------------------------------------------------
    const nF = cat.fams.length;
    cat.fams.forEach((fam, fi) => {
      const fStart = limb.sample(nF === 1 ? 0.94 : 0.38 + 0.62 * (fi / (nF - 1)));
      const fOff = nF === 1 ? jit(0.18) : -0.46 + 0.92 * (fi / (nF - 1)) + jit(0.06);
      const fAng = fStart.ang + fOff;
      const fLen = 88 + Math.sqrt(fam.langs.length) * 10.5;
      const fSign = Math.sign(fAng) || 1;
      const fb = branch({ x: fStart.x, y: fStart.y }, fAng, fLen, 6, 3, fSign * (fLen * 0.4), fLen * 0.26, true);
      const fp = fb.sample(1);
      famHits.push({ name: fam.name, d: centerline(fb), x: fp.x, y: fp.y, side: fSign });

      const info = fam.isolate ? null : FAMILY_BY_NAME.get(fam.name)!;
      const groups = info ? info.groups.map((g) => ({ name: g, langs: [] as LangRecord[] })) : null;
      if (groups) {
        for (const l of fam.langs) groups[l.id % groups.length].langs.push(l);
        const live = groups.filter((g) => g.langs.length);
        const nG = live.length;
        live.forEach((g, gi) => {
          const gStart = fb.sample(nG === 1 ? 0.95 : 0.5 + 0.5 * (gi / (nG - 1)));
          const gOff = nG === 1 ? jit(0.2) : -0.45 + 0.9 * (gi / (nG - 1)) + jit(0.08);
          const gAng = gStart.ang + gOff;
          const gLen = 48 + Math.sqrt(g.langs.length) * 8;
          const gSign = Math.sign(gAng) || 1;
          const tw = branch({ x: gStart.x, y: gStart.y }, gAng, gLen, 3, 1.4, gSign * (gLen * 0.45), gLen * 0.3, true);
          spray(tw, g.langs, fam.name);
        });
      } else {
        spray(fb, fam.langs, fam.name);
      }
    });
  });

  return { branches, puffs, leaves, famHits, catLabels, famLangs, total };
}

const VC: Record<Vitality, string> = { alive: 'alive', atRisk: 'atrisk', lost: 'lost' };
const VA: Record<Vitality, string> = { alive: 'var(--alive)', atRisk: 'var(--atrisk)', lost: 'var(--lost)' };

function dominant(c: Counts): Vitality {
  if (c.lost >= c.alive && c.lost >= c.atRisk) return 'lost';
  return c.atRisk >= c.alive ? 'atRisk' : 'alive';
}

export default function TreeGraph({ year, selected, onSelect }: Props) {
  const forest = useMemo(buildForest, []);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);

  // pinch-free zoom + pan over the canvas.
  const stageRef = useRef<HTMLDivElement>(null);
  const [tf, setTf] = useState({ z: 1, x: 0, y: 0 });
  const pan = useRef<{ x: number; y: number; px: number; py: number; moved: boolean } | null>(null);

  // wheel zoom centered on the cursor (native, non-passive so we can preventDefault)
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

  const counts = useMemo(() => {
    const c: Counts = { alive: 0, atRisk: 0, lost: 0 };
    for (const l of LANGUAGES) c[statusAt(l, year)]++;
    return c;
  }, [year]);

  // Languages whose last voice has fallen silent by this year — most recently
  // lost first, so scrubbing forward reads like a roll call of extinction.
  const fallen = useMemo(
    () =>
      LANGUAGES.filter((l) => statusAt(l, year) === 'lost').sort(
        (a, b) => (b.lostYear ?? 0) - (a.lostYear ?? 0),
      ),
    [year],
  );

  const selData = sel ? forest.famLangs.get(sel) ?? null : null;
  const selCounts = useMemo(() => {
    if (!selData) return null;
    const c: Counts = { alive: 0, atRisk: 0, lost: 0 };
    for (const l of selData.langs) c[statusAt(l, year)]++;
    return c;
  }, [selData, year]);

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
            <feGaussianBlur stdDeviation="11" />
          </filter>
        </defs>

        <rect x="0" y="0" width={VW} height={VH} fill="url(#halo)" />
        <ellipse cx={BASE.x} cy={BASE.y + 6} rx="180" ry="15" fill="url(#ground)" />

        <g className="lt-canopy">
        <g className="lt-branches">
          {forest.branches.map((b, i) => (
            <path key={i} d={b.d} fill={b.light ? 'url(#barkL)' : 'url(#bark)'} />
          ))}
        </g>

        <g className="lt-foliage" filter="url(#softblur)">
          {forest.puffs.map((p, i) => {
            let live = 0;
            for (const l of p.langs) if (statusAt(l, year) !== 'lost') live++;
            const op = p.langs.length ? 0.24 + 0.76 * (live / p.langs.length) : 0.24;
            return <circle key={i} cx={p.x} cy={p.y} r={p.r} fill="url(#foliage)" opacity={op} />;
          })}
        </g>

        <g className="lt-fams">
          {forest.famHits.map((f) => (
            <path
              key={f.name}
              className={`lt-fhit${sel === f.name ? ' on' : ''}${hover === f.name ? ' hv' : ''}`}
              d={f.d}
              onMouseEnter={() => setHover(f.name)}
              onMouseLeave={() => setHover((h) => (h === f.name ? null : h))}
              onClick={() => setSel((s) => (s === f.name ? null : f.name))}
            />
          ))}
        </g>

        <g className="lt-leaves">
          {forest.leaves.map((lf) => {
            const st = statusAt(lf.rec, year);
            const dim = sel && lf.fam !== sel ? ' dim' : '';
            return (
              <circle
                key={lf.id}
                className={`leaf ${VC[st]}${dim}`}
                cx={lf.x}
                cy={lf.y}
                r={lf.r}
                style={{
                  ['--gd' as string]: `${lf.gd.toFixed(2)}s`,
                  ['--fd' as string]: `${lf.fd.toFixed(2)}s`,
                  ['--tw' as string]: `${lf.tw.toFixed(2)}s`,
                  ['--drift' as string]: `${lf.drift.toFixed(0)}px`,
                  ['--spin' as string]: `${lf.spin.toFixed(0)}deg`,
                } as React.CSSProperties}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(lf.id);
                }}
              >
                <title>
                  {lf.rec.name} · {lf.fam}
                </title>
              </circle>
            );
          })}
        </g>

        <g className="lt-flabels">
          {forest.famHits
            .filter((f) => hover === f.name || sel === f.name)
            .map((f) => (
              <text
                key={f.name}
                x={f.x + f.side * 8}
                y={f.y - 6}
                textAnchor={f.side < 0 ? 'end' : 'start'}
                className="lt-flabel"
              >
                {f.name}
              </text>
            ))}
        </g>

        <g className="lt-clabels">
          {forest.catLabels.map((c) => (
            <text
              key={c.name}
              x={c.x + c.side * 10}
              y={c.y - 12}
              textAnchor={c.side < 0 ? 'end' : 'start'}
              className="lt-clabel"
            >
              {c.name}
            </text>
          ))}
        </g>
        </g>
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
          {forest.total} leaves,
          <br />
          one canopy
        </h2>
        <div className="lc-rule" />
        <p className="lc-sub">
          Every leaf is a language. <span className="k alive">Green</span> still breathes,{' '}
          <span className="k atrisk">amber</span> is fading; when its last voice falls silent the leaf
          blackens and drops. Drag the years to watch the canopy thin.
        </p>
        <div className="lc-legend">
          {(['alive', 'atRisk', 'lost'] as Vitality[]).map((k) => (
            <div key={k} className={`lc-chip ${k}`}>
              <span className="lc-dot" />
              <span className="num">{counts[k].toLocaleString()}</span>
              <span className="lc-lab">{k === 'atRisk' ? 'fading' : k === 'lost' ? 'fallen' : 'living'}</span>
            </div>
          ))}
        </div>
      </div>

      {selected === null && (
      <aside className="fallen panel">
        <div className="fallen-head">
          <span className="fallen-title">Fallen silent</span>
          <span className="fallen-count num">{fallen.length}</span>
        </div>
        {fallen.length === 0 ? (
          <p className="fallen-empty">None yet — drag the years forward to watch them go.</p>
        ) : (
          <ul className="fallen-list">
            {fallen.map((l) => (
              <li key={l.id}>
                <button className="fallen-item" onClick={() => onSelect(l.id)}>
                  <span className="fallen-name">{l.name}</span>
                  <span className="fallen-meta">
                    <span className="fallen-fam">{l.family}</span>
                    <span className="fallen-year num">{l.lostYear}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
      )}

      {sel && selData && selCounts && (
        <aside className="fam-drawer" style={{ ['--accent' as string]: VA[dominant(selCounts)] } as React.CSSProperties}>
          <button className="fd-close" onClick={() => setSel(null)} aria-label="Close">
            ×
          </button>
          <FamilyDetail
            node={{ name: sel, isolate: selData.isolate, langs: selData.langs, counts: selCounts }}
            year={year}
            onSelect={onSelect}
          />
        </aside>
      )}
    </div>
  );
}

interface FamilyNode {
  name: string;
  isolate: boolean;
  langs: LangRecord[];
  counts: Counts;
}

function branchesOf(node: FamilyNode) {
  if (node.isolate) return null;
  const info = FAMILY_BY_NAME.get(node.name)!;
  const g = info.groups.map((n) => ({ name: n, langs: [] as LangRecord[] }));
  for (const l of node.langs) g[l.id % g.length].langs.push(l);
  return g.filter((x) => x.langs.length > 0);
}

function FamilyDetail({ node, year, onSelect }: { node: FamilyNode; year: number; onSelect: (id: number) => void }) {
  const branches = branchesOf(node);
  const blurb = node.isolate
    ? 'Languages with no demonstrated relatives — each one its own family, and irreplaceable if lost.'
    : FAMILY_BY_NAME.get(node.name)!.blurb;

  const leaf = (l: LangRecord) => (
    <li key={l.id}>
      <button className="fd-leaf" onClick={() => onSelect(l.id)}>
        <span className={`fd-pip ${VC[statusAt(l, year)]}`} />
        <span className="fd-lname">{l.name}</span>
        <span className="fd-lreg">{l.region}</span>
      </button>
    </li>
  );

  return (
    <>
      <div className="fd-top">
        <h3>{node.name}</h3>
        <span className="fd-n">
          {node.langs.length} {node.isolate ? 'isolates' : 'languages'}
        </span>
      </div>
      <p className="fd-blurb">{blurb}</p>
      {branches ? (
        <div className="fd-grid">
          {branches.map((b) => (
            <div key={b.name} className="fd-branch">
              <h4>
                {b.name} <span>{b.langs.length}</span>
              </h4>
              <ul>{b.langs.map(leaf)}</ul>
            </div>
          ))}
        </div>
      ) : (
        <ul className="fd-flat">{node.langs.map(leaf)}</ul>
      )}
    </>
  );
}
