import { useEffect, useMemo, useRef, useState } from 'react';
import { LANGUAGES, statusAt, type LangRecord, type Vitality } from '../data/mockLanguages';
import { FAMILY_BY_NAME, MACRO_CATEGORIES, ISOLATE_FAMILY } from '../data/families';

interface Props {
  year: number;
  onSelect: (id: number) => void;
}

type Counts = Record<Vitality, number>;

interface FamilyNode {
  name: string;
  isolate: boolean;
  langs: LangRecord[];
  counts: Counts;
}

interface CategoryNode {
  name: string;
  families: FamilyNode[];
  total: number;
}

const zeroCounts = (): Counts => ({ alive: 0, atRisk: 0, lost: 0 });

function buildTree(year: number): CategoryNode[] {
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
  const cats: CategoryNode[] = [];
  for (const cat of MACRO_CATEGORIES) {
    const fams: FamilyNode[] = [];
    for (const fn of cat.families) {
      const ls = byFam.get(fn);
      if (!ls?.length) continue;
      const c = zeroCounts();
      for (const l of ls) c[statusAt(l, year)]++;
      fams.push({ name: fn, isolate: false, langs: ls, counts: c });
    }
    fams.sort((a, b) => b.langs.length - a.langs.length);
    if (fams.length) cats.push({ name: cat.name, families: fams, total: fams.reduce((n, f) => n + f.langs.length, 0) });
  }
  if (iso.length) {
    const c = zeroCounts();
    for (const l of iso) c[statusAt(l, year)]++;
    cats.push({ name: 'Isolates', families: [{ name: 'Isolates', isolate: true, langs: iso, counts: c }], total: iso.length });
  }
  return cats;
}

function dominant(c: Counts): Vitality {
  if (c.lost >= c.alive && c.lost >= c.atRisk) return 'lost';
  return c.atRisk >= c.alive ? 'atRisk' : 'alive';
}

const VC: Record<Vitality, string> = { alive: 'alive', atRisk: 'atrisk', lost: 'lost' };
const VA: Record<Vitality, string> = { alive: 'var(--alive)', atRisk: 'var(--atrisk)', lost: 'var(--lost)' };

function Dots({ langs, year }: { langs: LangRecord[]; year: number }) {
  const ord: Record<Vitality, number> = { alive: 0, atRisk: 1, lost: 2 };
  const s = [...langs].sort((a, b) => ord[statusAt(a, year)] - ord[statusAt(b, year)]);
  return (
    <div className="fc-dots">
      {s.map((l) => <span key={l.id} className={`fd ${VC[statusAt(l, year)]}`} />)}
    </div>
  );
}

function branchesOf(node: FamilyNode) {
  if (node.isolate) return null;
  const info = FAMILY_BY_NAME.get(node.name)!;
  const g = info.groups.map((n) => ({ name: n, langs: [] as LangRecord[] }));
  for (const l of node.langs) g[l.id % g.length].langs.push(l);
  return g.filter((x) => x.langs.length > 0);
}

export default function TreeGraph({ year, onSelect }: Props) {
  const cats = useMemo(() => buildTree(year), [year]);
  const [sel, setSel] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const total = cats.reduce((n, c) => n + c.total, 0);
  const selNode = sel ? cats.flatMap((c) => c.families).find((f) => f.name === sel) ?? null : null;

  useEffect(() => {
    if (selNode) detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selNode]);

  let famIdx = 0;

  return (
    <div className="tree-page">
      <div className="dendro-intro">
        <p className="dendro-above">Tracing lineage across</p>
        <h2 className="dendro-title">{total} fading voices</h2>
        <div className="dendro-rule" />
        <p className="dendro-sub">
          Each dot is a language — <span className="k alive">alive</span>,{' '}
          <span className="k atrisk">endangered</span>,{' '}
          <span className="k lost">silent</span> — in {year}.
          Touch a family to trace its branches.
        </p>
      </div>

      <div className="vtree">
        {/* root of the tree */}
        <div className="vt-root">
          <span className="vt-orb" />
          <span className="vt-root-name">All languages</span>
          <span className="vt-root-sub">{total} tracked · 6 macro-areas</span>
        </div>

        {/* trunk: macro-categories descending */}
        <div className="vt-trunk">
          {cats.map((cat) => (
            <div className="vt-cat" key={cat.name}>
              <div className="vt-cathead">
                <span className="vt-cat-name">{cat.name}</span>
                <span className="vt-cat-n">{cat.total}</span>
              </div>

              {/* branch: families descending under the category */}
              <div className="vt-fams">
                {cat.families.map((fam) => {
                  const acc = VA[dominant(fam.counts)];
                  const d = famIdx++ * 0.04 + 0.25;
                  return (
                    <button
                      key={fam.name}
                      className={`vt-fam${sel === fam.name ? ' on' : ''}`}
                      style={{ ['--accent' as any]: acc, animationDelay: `${d}s` }}
                      onClick={() => setSel((s) => (s === fam.name ? null : fam.name))}
                      aria-pressed={sel === fam.name}
                    >
                      <span className="vt-knot" />
                      <span className="vt-fam-body">
                        <span className="fc-head">
                          <span className="fc-name">{fam.name}</span>
                          <span className="fc-n">{fam.langs.length}</span>
                        </span>
                        <Dots langs={fam.langs} year={year} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {selNode && (
        <section
          className="fam-detail"
          ref={detailRef}
          style={{ ['--accent' as any]: VA[dominant(selNode.counts)] }}
        >
          <FamilyDetail node={selNode} year={year} onSelect={onSelect} />
        </section>
      )}
    </div>
  );
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
        <span className="fd-n">{node.langs.length} {node.isolate ? 'isolates' : 'languages'}</span>
      </div>
      <p className="fd-blurb">{blurb}</p>
      {branches ? (
        <div className="fd-grid">
          {branches.map((b) => (
            <div key={b.name} className="fd-branch">
              <h4>{b.name} <span>{b.langs.length}</span></h4>
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
