import { useEffect, useMemo, useState } from 'react';
import GlobeView from './components/GlobeView';
import FilterPanel from './components/FilterPanel';
import Timeline from './components/Timeline';
import Wordmark from './components/Wordmark';
import SelectedCard from './components/SelectedCard';
import RotateControl from './components/RotateControl';
import Nav, { type View } from './components/Nav';
import TreeGraph from './components/TreeGraph';
import { statusAt, TODAY, type LangRecord, type Vitality } from './data/mockLanguages';
import languagesData from './data/languages.json';
import { fetchOutreachStatus, type OutreachStatusSummary } from './data/api';

type Filters = Record<Vitality, boolean>;

// Precomputed dataset, bundled at build time — no need to fetch it on load.
const languages = languagesData.languages as LangRecord[];

export default function App() {
  const [view, setView] = useState<View>('globe');
  const [year, setYear] = useState(TODAY);
  const [playing, setPlaying] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [filters, setFilters] = useState<Filters>({ alive: true, atRisk: true, lost: true });
  const [selected, setSelected] = useState<number | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [outreachStatus, setOutreachStatus] = useState<Record<number, OutreachStatusSummary>>({});

  // Outreach status is a secondary, backend-driven layer — load it
  // independently and fail quietly if it's not there yet.
  useEffect(() => {
    fetchOutreachStatus()
      .then(setOutreachStatus)
      .catch(() => {});
  }, []);

  useEffect(() => {
    const onResize = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Counts for this year — drives the summary row and the filter legend.
  const counts = useMemo(() => {
    const c: Record<Vitality, number> = { alive: 0, atRisk: 0, lost: 0 };
    for (const l of languages) c[statusAt(l, year)]++;
    return c;
  }, [languages, year]);

  const selectedLang = selected === null ? null : languages.find((l) => l.id === selected) ?? null;

  const underOutreach = useMemo(
    () => Object.values(outreachStatus).filter((o) => o.hasPending || o.hasApproved).length,
    [outreachStatus],
  );

  return (
    <div className="app">
      {view === 'globe' && (
        <>
          <div className="globe-layer">
            <GlobeView
              languages={languages}
              width={size.w}
              height={size.h}
              year={year}
              filters={filters}
              autoRotate={autoRotate}
              outreachStatus={outreachStatus}
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
            {underOutreach > 0 && (
              <div className="metric outreach">
                <span className="dot" />
                <span className="value">{underOutreach.toLocaleString()}</span>
                <span className="label">Under outreach</span>
              </div>
            )}
          </div>

          <FilterPanel
            filters={filters}
            counts={counts}
            onToggle={(k) => setFilters((f) => ({ ...f, [k]: !f[k] }))}
          />

          <RotateControl on={autoRotate} onToggle={() => setAutoRotate((v) => !v)} />

          {selectedLang && (
            <SelectedCard
              lang={selectedLang}
              year={year}
              outreach={outreachStatus[selectedLang.id]}
              onClose={() => setSelected(null)}
            />
          )}
        </>
      )}

      {view === 'tree' && <TreeGraph year={year} onSelect={(id) => setSelected(id)} />}

      <Wordmark />
      <Nav view={view} onChange={setView} />

      <Timeline year={year} setYear={setYear} playing={playing} setPlaying={setPlaying} />

      {view === 'tree' && selectedLang && (
        <SelectedCard
          lang={selectedLang}
          year={year}
          outreach={outreachStatus[selectedLang.id]}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
