import { useEffect, useMemo, useState } from 'react';
import GlobeView from './components/GlobeView';
import FilterPanel from './components/FilterPanel';
import Timeline from './components/Timeline';
import Wordmark from './components/Wordmark';
import SelectedCard from './components/SelectedCard';
import RotateControl from './components/RotateControl';
import { LANGUAGES, statusAt, TODAY, type Vitality } from './data/mockLanguages';

type Filters = Record<Vitality, boolean>;

export default function App() {
  const [year, setYear] = useState(TODAY);
  const [playing, setPlaying] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [filters, setFilters] = useState<Filters>({ alive: true, atRisk: true, lost: true });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Counts for this year — drives the summary row and the filter legend.
  const counts = useMemo(() => {
    const c: Record<Vitality, number> = { alive: 0, atRisk: 0, lost: 0 };
    for (const l of LANGUAGES) c[statusAt(l, year)]++;
    return c;
  }, [year]);

  const selected = selectedId === null ? null : LANGUAGES.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="app">
      <div className="globe-layer">
        <GlobeView
          width={size.w}
          height={size.h}
          year={year}
          filters={filters}
          autoRotate={autoRotate}
          onUserInteract={() => setAutoRotate(false)}
          onSelect={setSelectedId}
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
        onToggle={(k) => setFilters((f) => ({ ...f, [k]: !f[k] }))}
      />

      <Timeline year={year} setYear={setYear} playing={playing} setPlaying={setPlaying} />

      <RotateControl on={autoRotate} onToggle={() => setAutoRotate((v) => !v)} />

      {selected && <SelectedCard lang={selected} year={year} onClose={() => setSelectedId(null)} />}
    </div>
  );
}
