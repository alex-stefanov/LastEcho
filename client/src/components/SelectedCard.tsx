import { LANGUAGES, statusAt, colorFor, type Vitality } from '../data/mockLanguages';
import { TOWNS, townStatusAt, townLabel } from '../data/mockTowns';
import type { LayerKind } from './GlobeView';

interface Props {
  selection: { kind: LayerKind; id: number };
  year: number;
  onClose: () => void;
}

const LANG_LABEL: Record<Vitality, string> = { alive: 'Alive', atRisk: 'At risk', lost: 'Lost' };

export default function SelectedCard({ selection, year, onClose }: Props) {
  if (selection.kind === 'town') {
    const town = TOWNS.find((t) => t.id === selection.id);
    if (!town) return null;
    const status = townStatusAt(town, year);
    const pop = status === 'lost' ? 0 : town.population;
    return (
      <section className="selected panel">
        <div className="head">
          <span className="name">{town.name}</span>
          <button className="close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <span className="status-pill">
          <span className="dot" style={{ background: colorFor(status) }} />
          {townLabel(status)} · {year}
        </span>

        <dl>
          <dt>Country</dt>
          <dd>{town.country}</dd>
          <dt>Region</dt>
          <dd>{town.region}</dd>
          <dt>Population</dt>
          <dd>{pop === 0 ? '—' : pop.toLocaleString()}</dd>
          <dt>Peak</dt>
          <dd>{town.peakPopulation.toLocaleString()} · {town.peakYear}</dd>
        </dl>

        <div className="rank">
          A settlement emptying out as its people move away.
        </div>
      </section>
    );
  }

  const lang = LANGUAGES.find((l) => l.id === selection.id);
  if (!lang) return null;
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
        {LANG_LABEL[status]} · {year}
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
