import { useEffect, useMemo, useState } from 'react';
import GlobeView, { type LayerKind, type Layers } from './components/GlobeView';
import FilterPanel from './components/FilterPanel';
import Timeline from './components/Timeline';
import Wordmark from './components/Wordmark';
import SelectedCard from './components/SelectedCard';
import RotateControl from './components/RotateControl';
import { LANGUAGES, statusAt, TODAY, type Vitality } from './data/mockLanguages';
import { TOWNS, townStatusAt } from './data/mockTowns';

type Filters = Record<Vitality, boolean>;
type Selection = { kind: LayerKind; id: number };

export default function App() {
  const [year, setYear] = useState(TODAY);
  const [playing, setPlaying] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [filters, setFilters] = useState<Filters>({ alive: true, atRisk: true, lost: true });
  const [layers, setLayers] = useState<Layers>({ lang: true, town: true });
  const [selected, setSelected] = useState<Selection | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Counts for this year — drives the summary row and the filter legend.
  // Only enabled layers contribute, so toggling a layer updates the numbers.
  const counts = useMemo(() => {
    const c: Record<Vitality, number> = { alive: 0, atRisk: 0, lost: 0 };
    if (layers.lang) for (const l of LANGUAGES) c[statusAt(l, year)]++;
    if (layers.town) for (const t of TOWNS) c[townStatusAt(t, year)]++;
    return c;
  }, [year, layers]);

  // The selected record is dropped if its layer gets hidden.
  const selectedValid = selected && layers[selected.kind] ? selected : null;

  return (
    <div className="app">
      <div className="globe-layer">
        <GlobeView
          width={size.w}
          height={size.h}
          year={year}
          filters={filters}
          layers={layers}
          autoRotate={autoRotate}
          onUserInteract={() => setAutoRotate(false)}
          onSelect={(kind, id) => setSelected({ kind, id })}
        />
      </div>
      <div className="vignette" />

      <Wordmark />

      <div className="summary panel">
        {(['alive', 'atRisk', 'lost'] as Vitality[]).map((k) => (
          <div key={k} className={`metric ${k}`}>
            <span className="dot" />
            <span className="value">{counts[k].toLocaleString()}</span>
            <span className="label">{k === 'atRisk' ? 'At risk' : k}</span>
          </div>
        ))}
      </div>

      <FilterPanel
        filters={filters}
        counts={counts}
        layers={layers}
        onToggle={(k) => setFilters((f) => ({ ...f, [k]: !f[k] }))}
        onToggleLayer={(k) => setLayers((l) => ({ ...l, [k]: !l[k] }))}
      />

      <Timeline year={year} setYear={setYear} playing={playing} setPlaying={setPlaying} />

      <RotateControl on={autoRotate} onToggle={() => setAutoRotate((v) => !v)} />

      {selectedValid && (
        <SelectedCard selection={selectedValid} year={year} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
