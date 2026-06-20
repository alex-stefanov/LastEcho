import type { Vitality } from '../data/mockLanguages';
import type { LayerKind, Layers } from './GlobeView';

type Filters = Record<Vitality, boolean>;

interface Props {
  filters: Filters;
  counts: Record<Vitality, number>;
  layers: Layers;
  onToggle: (k: Vitality) => void;
  onToggleLayer: (k: LayerKind) => void;
}

const ROWS: { key: Vitality; label: string; color: string }[] = [
  { key: 'alive', label: 'Alive', color: 'var(--alive)' },
  { key: 'atRisk', label: 'At risk', color: 'var(--atrisk)' },
  { key: 'lost', label: 'Lost', color: 'var(--lost)' },
];

const LAYER_ROWS: { key: LayerKind; label: string; shape: string }[] = [
  { key: 'lang', label: 'Languages', shape: 'dot' },
  { key: 'town', label: 'Towns', shape: 'diamond' },
];

export default function FilterPanel({ filters, counts, layers, onToggle, onToggleLayer }: Props) {
  const total = counts.alive + counts.atRisk + counts.lost;
  return (
    <aside className="filter panel">
      <div className="head">
        <span className="eyebrow">Layers</span>
      </div>
      {LAYER_ROWS.map((r) => (
        <button
          key={r.key}
          className={`toggle${layers[r.key] ? '' : ' off'}`}
          onClick={() => onToggleLayer(r.key)}
          aria-pressed={layers[r.key]}
        >
          <span className={`swatch layer-${r.shape}`} />
          {r.label}
          <span className="count">{layers[r.key] ? 'on' : 'off'}</span>
        </button>
      ))}

      <div className="head spacer">
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
