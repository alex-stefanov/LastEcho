import { GROUP_COLOR, LEVEL_LABEL, levelTrend, TL_TODAY, type YearLang, type YearRisk } from '../data/timeline';

interface Props {
  lang: YearLang;
  year: number;
  // This language's level in the TODAY (2026) snapshot, for the drift indicator.
  baseRisk: YearRisk | null;
  onClose: () => void;
  onBackToList?: () => void;
}

const ARROW = { worse: '↓', better: '↑', shift: '~', none: '' } as const;
const TREND_LABEL = { worse: 'declined', better: 'recovered', shift: 'shifted', none: '' } as const;

// Compact detail card for a language clicked on the globe. The globe is driven
// by the real per-year snapshots (keyed by ISO code), which carry only vitality
// facts — outreach / triage live on the separate languages.json layer.
export default function YearLangCard({ lang, year, baseRisk, onClose, onBackToList }: Props) {
  const speakers = lang.risk === 'lost' ? 0 : lang.speakers;

  // How this language has drifted from today (2026). Persistent while you're on
  // a given year, so scrubbing the timeline reads as movement rather than a
  // static dot (the coarse group colour alone barely moves).
  const trend = baseRisk && year !== TL_TODAY ? levelTrend(baseRisk, lang.risk) : null;
  const showTrend = trend && trend.dir !== 'none';

  return (
    <section className="selected panel">
      {onBackToList && (
        <button className="selected__back" type="button" onClick={onBackToList}>
          ←
        </button>
      )}

      <div className="head">
        <span className="name">{lang.name}</span>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <div className="status-row">
        <span className="status-pill">
          <span className="dot" style={{ background: GROUP_COLOR[lang.vitality_group] }} />
          {LEVEL_LABEL[lang.risk]} · {year}
        </span>
        {showTrend && (
          <span className={`status-trend is-${trend.dir}`}>
            {ARROW[trend.dir]} {TREND_LABEL[trend.dir]} since 2026
            {trend.steps > 1 ? ` (${trend.steps})` : ''}
          </span>
        )}
      </div>

      <dl>
        <dt>ISO 639-3</dt>
        <dd>{lang.iso_code}</dd>
        <dt>Family</dt>
        <dd>{lang.family_root}</dd>
        <dt>Speakers</dt>
        <dd>{speakers == null || speakers === 0 ? '—' : speakers.toLocaleString()}</dd>
      </dl>
    </section>
  );
}
