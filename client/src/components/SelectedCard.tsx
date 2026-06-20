import { useEffect, useState } from 'react';
import { statusAt, colorFor, type LangRecord, type Vitality } from '../data/mockLanguages';
import { fetchInstitutions, type Institution, type OutreachStatusSummary } from '../data/api';

interface Props {
  lang: LangRecord;
  year: number;
  outreach?: OutreachStatusSummary;
  onClose: () => void;
}

const LANG_LABEL: Record<Vitality, string> = { alive: 'Alive', atRisk: 'At risk', lost: 'Lost' };

const TIER_LABEL: Record<Institution['scope'], string> = {
  regional: 'Regional',
  national: 'National',
  continental: 'Continental',
  global: 'Global',
};
const TIER_ORDER: Institution['scope'][] = ['regional', 'national', 'continental', 'global'];

function outreachLine(o: OutreachStatusSummary | undefined): string {
  if (!o) return 'No outreach yet';
  if (o.hasApproved) return 'Outreach approved';
  if (o.hasPending) return 'Outreach drafted — pending review';
  if (o.hasRejected) return 'Outreach reviewed — not sent';
  return 'No outreach yet';
}

export default function SelectedCard({ lang, year, outreach, onClose }: Props) {
  const status = statusAt(lang, year);
  const speakers = status === 'lost' ? 0 : lang.speakers;

  const [institutions, setInstitutions] = useState<Institution[]>([]);

  useEffect(() => {
    let alive = true;
    fetchInstitutions(lang.id)
      .then((list) => alive && setInstitutions(list))
      .catch(() => alive && setInstitutions([]));
    return () => {
      alive = false;
    };
  }, [lang.id]);

  const grouped = TIER_ORDER.map((tier) => ({
    tier,
    items: institutions.filter((i) => i.scope === tier),
  })).filter((g) => g.items.length > 0);

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

      <div className="response">
        <span className="response-status">
          <span className={`response-dot ${outreach?.hasApproved ? 'approved' : outreach?.hasPending ? 'pending' : ''}`} />
          {outreachLine(outreach)}
        </span>

        {grouped.length > 0 && (
          <div className="institutions">
            {grouped.map((g) => (
              <div key={g.tier} className="inst-tier">
                <span className="inst-tier-label">{TIER_LABEL[g.tier]}</span>
                <div className="inst-chips">
                  {g.items.map((inst) => (
                    <a
                      key={inst.id}
                      className="inst-chip"
                      href={inst.contactUrl}
                      target="_blank"
                      rel="noreferrer"
                      title={inst.blurb}
                    >
                      <span className="inst-name">{inst.name}</span>
                      {inst.confidence === 'auto-discovered' && (
                        <span className="inst-badge">Auto-discovered</span>
                      )}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
