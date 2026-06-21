import { GROUP_COLOR, LEVEL_LABEL, type YearLang } from '../data/timeline';

interface Props {
  lang: YearLang;
  year: number;
  onClose: () => void;
  onBackToList?: () => void;
}

// Compact detail card for a language clicked on the globe. The globe is driven
// by the real per-year snapshots (keyed by ISO code), which carry only vitality
// facts — outreach / triage live on the separate languages.json layer.
export default function YearLangCard({ lang, year, onClose, onBackToList }: Props) {
  const speakers = lang.risk === 'lost' ? 0 : lang.speakers;

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

      <span className="status-pill">
        <span className="dot" style={{ background: GROUP_COLOR[lang.vitality_group] }} />
        {LEVEL_LABEL[lang.risk]} · {year}
      </span>

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
