import { useMemo } from 'react';
import { LEVEL_LABEL, levelTrend, TL_TODAY, type Trend, type YearRisk } from '../data/timeline';
import type { ClusterMember } from './GlobeView';

interface Props {
  members: ClusterMember[];
  // Each language's level in the TODAY (2026) snapshot, so every row can show
  // how far it has drifted from today as the timeline is scrubbed.
  baselineRisk: Record<string, YearRisk> | null;
  year: number;
  onSelect: (iso: string) => void;
  onClose: () => void;
}

const ARROW: Record<Trend['dir'], string> = { worse: '↓', better: '↑', shift: '~', none: '' };

export default function ClusterCard({ members, baselineRisk, year, onSelect, onClose }: Props) {
  // Trend of each row vs. its 2026 baseline. Persistent (not a flash): it stays
  // on screen for the whole year you're parked on, so scrubbing reads as steady,
  // accumulating change rather than a moment you can blink and miss.
  const trends = useMemo(() => {
    const map: Record<string, Trend> = {};
    if (!baselineRisk) return map;
    for (const m of members) {
      const base = baselineRisk[m.iso];
      map[m.iso] = base ? levelTrend(base, m.level) : { dir: 'none', steps: 0 };
    }
    return map;
  }, [members, baselineRisk]);

  const shifting = useMemo(
    () => Object.values(trends).filter((t) => t.dir !== 'none').length,
    [trends],
  );

  const offBaseline = year !== TL_TODAY;

  return (
    <section className="selected cluster-card panel">
      <div className="head">
        <span className="name">{members.length} languages</span>
        <button className="close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <p className="cluster-card__sub">
        Co-located languages (within ~28 km). Nearby dots are separate languages. Click a row to inspect.
      </p>
      {offBaseline && (
        <p className="cluster-card__delta">
          {shifting > 0
            ? `${shifting} of ${members.length} shifted since 2026`
            : `No change since 2026`}
        </p>
      )}
      <ul className="cluster-card__list">
        {members.map((m) => {
          const t = trends[m.iso];
          const showTrend = offBaseline && t && t.dir !== 'none';
          return (
            <li key={m.iso} className="cluster-card__row" onClick={() => onSelect(m.iso)}>
              <span className="cluster-card__dot" style={{ background: m.color }} />
              <span className="cluster-card__name">{m.name}</span>
              {showTrend && (
                <span className={`cluster-card__trend is-${t.dir}`} title={`Since 2026: ${t.dir}`}>
                  {ARROW[t.dir]}{t.steps > 1 ? t.steps : ''}
                </span>
              )}
              <span className="cluster-card__pill">{LEVEL_LABEL[m.level]}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
