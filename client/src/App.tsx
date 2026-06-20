import { useEffect, useMemo, useState } from 'react';
import GlobeView from './components/GlobeView';
import FilterPanel from './components/FilterPanel';
import Timeline from './components/Timeline';
import Wordmark from './components/Wordmark';
import SelectedCard from './components/SelectedCard';
import RotateControl from './components/RotateControl';
import Nav, { type View } from './components/Nav';
import ThemeToggle, { type Theme } from './components/ThemeToggle';
import TreeGraph from './components/TreeGraph';
import { LANGUAGES, statusAt, TODAY, type Vitality } from './data/mockLanguages';

type Filters = Record<Vitality, boolean>;

const THEME_KEY = 'lastecho-theme';

export default function App() {
  const [view, setView] = useState<View>('globe');
  const [year, setYear] = useState(TODAY);
  const [playing, setPlaying] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [filters, setFilters] = useState<Filters>({ alive: true, atRisk: true, lost: true });
  const [selected, setSelected] = useState<number | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme) || 'dark',
  );

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Counts for this year — drives the summary row and the filter legend.
  const counts = useMemo(() => {
    const c: Record<Vitality, number> = { alive: 0, atRisk: 0, lost: 0 };
    for (const l of LANGUAGES) c[statusAt(l, year)]++;
    return c;
  }, [year]);

  return (
    <div className="app">
      {view === 'globe' && (
        <>
          <div className="globe-layer">
            <GlobeView
              width={size.w}
              height={size.h}
              year={year}
              filters={filters}
              autoRotate={autoRotate}
              theme={theme}
              onUserInteract={() => setAutoRotate(false)}
              onSelect={(id) => setSelected(id)}
            />
          </div>
          <div className="vignette" />

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

          <RotateControl on={autoRotate} onToggle={() => setAutoRotate((v) => !v)} />

          {selected !== null && (
            <SelectedCard id={selected} year={year} onClose={() => setSelected(null)} />
          )}
        </>
      )}

      {view === 'tree' && <TreeGraph year={year} onSelect={(id) => setSelected(id)} />}

      <Wordmark />
      <Nav view={view} onChange={setView} />
      <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />

      <Timeline year={year} setYear={setYear} playing={playing} setPlaying={setPlaying} />

      {view === 'tree' && selected !== null && (
        <SelectedCard id={selected} year={year} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}
