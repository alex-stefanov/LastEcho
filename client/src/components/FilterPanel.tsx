import type { Vitality } from '../data/mockLanguages';

type Filters = Record<Vitality, boolean>;

interface Props {
  filters: Filters;
  counts: Record<Vitality, number>;
  onToggle: (k: Vitality) => void;
}

const ROWS: { key: Vitality; label: string; color: string }[] = [
  { key: 'alive', label: 'Alive', color: 'var(--alive)' },
  { key: 'atRisk', label: 'At risk', color: 'var(--atrisk)' },
  { key: 'lost', label: 'Lost', color: 'var(--lost)' },
];

export default function FilterPanel({ filters, counts, onToggle }: Props) {
  const total = counts.alive + counts.atRisk + counts.lost;
  return (
    <aside className="filter panel">
      <div className="head">
        <span className="eyebrow">Vitality</span>
        <span className="eyebrow num">{total.toLocaleString()}</span>
      </div>
      {ROWS.map((r) => (
        <button
          key={r.key}
          className={`toggle${filters[r.key] ? '' : ' off'}`}
          onClick={() => onToggle(r.key)}
          aria-pressed={filters[r.key]}
        >
          <span className="swatch" style={{ background: r.color }} />
          {r.label}
          <span className="count">{counts[r.key].toLocaleString()}</span>
        </button>
      ))}
    </aside>
  );
}
