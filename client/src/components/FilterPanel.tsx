import { GROUP_COLOR, GROUP_LABEL, GROUP_ORDER, type VitalityGroup } from '../data/timeline';

type Filters = Record<VitalityGroup, boolean>;

interface Props {
  filters: Filters;
  counts: Record<VitalityGroup, number>;
  onToggle: (k: VitalityGroup) => void;
}

export default function FilterPanel({ filters, counts, onToggle }: Props) {
  const total = GROUP_ORDER.reduce((sum, k) => sum + counts[k], 0);
  return (
    <aside className="filter panel">
      <div className="head">
        <span className="eyebrow">Vitality</span>
        <span className="eyebrow num">{total.toLocaleString()}</span>
      </div>
      {GROUP_ORDER.map((k) => (
        <button
          key={k}
          className={`toggle${filters[k] ? '' : ' off'}`}
          onClick={() => onToggle(k)}
          aria-pressed={filters[k]}
        >
          <span className="swatch" style={{ background: GROUP_COLOR[k] }} />
          {GROUP_LABEL[k]}
          <span className="count">{counts[k].toLocaleString()}</span>
        </button>
      ))}
    </aside>
  );
}
