import { statusAt, colorFor, type LangRecord } from '../data/mockLanguages';

interface Props {
  lang: LangRecord;
  year: number;
  onClose: () => void;
}

const LABEL: Record<string, string> = { alive: 'Alive', atRisk: 'At risk', lost: 'Lost' };

export default function SelectedCard({ lang, year, onClose }: Props) {
  const status = statusAt(lang, year);
  const speakers = status === 'lost' ? 0 : lang.speakers;

  return (
    <section className="selected panel">
      <div className="head">
        <span className="name">{lang.name}</span>
        <button className="close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>

      <span className="status-pill">
        <span className="dot" style={{ background: colorFor(status) }} />
        {LABEL[status]} · {year}
      </span>

      <dl>
        <dt>Family</dt>
        <dd>{lang.family}</dd>
        <dt>Region</dt>
        <dd>{lang.region}</dd>
        <dt>Speakers</dt>
        <dd>{speakers === 0 ? '—' : speakers.toLocaleString()}</dd>
        <dt>Record</dt>
        <dd>{lang.docLevel}</dd>
      </dl>

      <div className="rank">
        Triage rank <b>#{lang.rank}</b> of {/* of all */}languages to record first.
      </div>
    </section>
  );
}
