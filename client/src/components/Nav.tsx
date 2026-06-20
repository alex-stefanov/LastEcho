export type View = 'globe' | 'tree';

interface Props {
  view: View;
  onChange: (v: View) => void;
}

const ITEMS: { key: View; label: string }[] = [
  { key: 'globe', label: 'Globe' },
  { key: 'tree', label: 'Family tree' },
];

export default function Nav({ view, onChange }: Props) {
  return (
    <nav className="nav panel">
      {ITEMS.map((it) => (
        <button
          key={it.key}
          className={`nav-tab${view === it.key ? ' active' : ''}`}
          onClick={() => onChange(it.key)}
          aria-pressed={view === it.key}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}
