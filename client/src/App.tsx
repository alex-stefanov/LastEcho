import { useEffect, useMemo, useRef, useState } from 'react';
import GlobeView from './components/GlobeView';
import FilterPanel from './components/FilterPanel';
import Timeline from './components/Timeline';
import Wordmark from './components/Wordmark';
import SelectedCard from './components/SelectedCard';
import YearLangCard from './components/YearLangCard';
import ClusterCard from './components/ClusterCard';
import RotateControl from './components/RotateControl';
import Nav, { type View } from './components/Nav';
import ThemeToggle, { type Theme } from './components/ThemeToggle';
import TreeGraph from './components/TreeGraph';
import { type LangRecord } from './data/mockLanguages';
import languagesData from './data/languages.json';
import {
  countByGroup,
  GROUP_COLOR,
  GROUP_LABEL,
  GROUP_ORDER,
  LEVEL_URGENCY,
  getCachedYear,
  loadYear,
  TL_TODAY,
  type VitalityGroup,
  type YearData,
} from './data/timeline';
import { fetchOutreachStatus, type OutreachStatusSummary } from './data/api';

type Filters = Record<VitalityGroup, boolean>;
const THEME_KEY = 'lastecho-theme';
const EMPTY_COUNTS: Record<VitalityGroup, number> = { healthy: 0, watch: 0, serious: 0, gone: 0, unknown: 0 };
const ALL_GROUPS_ON: Filters = { healthy: true, watch: true, serious: true, gone: true, unknown: true };
const languages = languagesData.languages as LangRecord[];

export default function App() {
  const [view, setView] = useState<View>('globe');
  const [year, setYear] = useState(TL_TODAY);
  const [playing, setPlaying] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [filters, setFilters] = useState<Filters>(ALL_GROUPS_ON);
  const [selectedIso, setSelectedIso] = useState<string | null>(null);
  // Store only ISOs so the panel re-derives vitality data whenever the year changes.
  const [selectedClusterIsos, setSelectedClusterIsos] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(THEME_KEY) as Theme) || 'dark',
  );
  const [outreachStatus, setOutreachStatus] = useState<Record<number, OutreachStatusSummary>>({});

  // The currently *shown* year snapshot. It only updates once the year's data
  // has loaded, so the globe never renders a year it hasn't been granted.
  const [yearData, setYearData] = useState<YearData | null>(() => getCachedYear(TL_TODAY) ?? null);
  const loadToken = useRef(0);
  const ready = yearData?.year === year;

  // Load (or reuse cached) the snapshot for the selected year. A stale-token
  // guard keeps fast scrubbing from showing an out-of-order resolved year.
  useEffect(() => {
    const cached = getCachedYear(year);
    if (cached) {
      setYearData(cached);
      return;
    }
    const token = ++loadToken.current;
    loadYear(year)
      .then((data) => {
        if (token === loadToken.current) setYearData(data);
      })
      .catch(() => {});
  }, [year]);

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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // Counts for the shown year — drives the summary row and the filter legend.
  const counts = useMemo(
    () => (yearData ? countByGroup(yearData) : EMPTY_COUNTS),
    [yearData],
  );

  const selectedYearLang = useMemo(
    () => (selectedIso && yearData ? yearData.languages.find((l) => l.iso_code === selectedIso) ?? null : null),
    [selectedIso, yearData],
  );

  // Re-derived every time yearData or selectedClusterIsos changes, so the
  // ClusterCard always shows the current year's vitality status.
  const selectedClusterMembers = useMemo(() => {
    if (!selectedClusterIsos || !yearData) return null;
    const members = selectedClusterIsos.flatMap((iso) => {
      const l = yearData.languages.find((y) => y.iso_code === iso);
      if (!l) return [];
      return [{ iso: l.iso_code, name: l.name, color: GROUP_COLOR[l.vitality_group], group: l.vitality_group, level: l.risk }];
    });
    members.sort((a, b) => LEVEL_URGENCY[b.level] - LEVEL_URGENCY[a.level]);
    return members.length > 0 ? members : null;
  }, [selectedClusterIsos, yearData]);

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
              yearLangs={yearData?.languages ?? []}
              width={size.w}
              height={size.h}
              filters={filters}
              autoRotate={autoRotate}
              theme={theme}
              onUserInteract={() => setAutoRotate(false)}
              onSelect={(iso) => { setSelectedIso(iso); setSelectedClusterIsos(null); }}
              onClusterSelect={(isos) => { setSelectedClusterIsos(isos); setSelectedIso(null); }}
            />
          </div>
          <div className="vignette" />

          <div className="summary panel">
            {GROUP_ORDER.map((k) => (
              <div key={k} className={`metric grp-${k}`}>
                <span className="dot" />
                <span className="value">{counts[k].toLocaleString()}</span>
                <span className="label">{GROUP_LABEL[k]}</span>
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

          {selectedYearLang && (
            <YearLangCard
              lang={selectedYearLang}
              year={year}
              onClose={() => setSelectedIso(null)}
            />
          )}

          {selectedClusterMembers && !selectedYearLang && (
            <ClusterCard
              members={selectedClusterMembers}
              onSelect={(iso) => { setSelectedIso(iso); setSelectedClusterIsos(null); }}
              onClose={() => setSelectedClusterIsos(null)}
            />
          )}
        </>
      )}

      {view === 'tree' && (
        <TreeGraph
          year={year}
          yearData={yearData}
          selectedIso={selectedIso}
          onSelect={(iso) => setSelectedIso(iso)}
        />
      )}

      {selectedYearLang && (
        <YearLangCard lang={selectedYearLang} year={year} onClose={() => setSelectedIso(null)} />
      )}

      <Wordmark />
      <Nav view={view} onChange={setView} />
      <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />

      <Timeline year={year} setYear={setYear} playing={playing} setPlaying={setPlaying} ready={ready} />
    </div>
  );
}
