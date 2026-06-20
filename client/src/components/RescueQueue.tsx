import { useMemo, useState } from 'react';
import type { YearLang } from '../data/timeline';
import {
  rankLanguages,
  buildFamilySizes,
  buildLogMax,
  type TriageWeights,
  type RankedLang,
} from '../data/triage';

interface Props {
  languages: YearLang[];
  weights: TriageWeights;
  onWeightsChange: (w: TriageWeights) => void;
  selectedIso: string | null;
  onSelect: (iso: string) => void;
}

const RISK_LABEL: Record<string, string> = {
  critical: 'Critical',
  at_risk: 'At risk',
  vulnerable: 'Vulnerable',
  unknown: 'Unknown',
  stable: 'Stable',
  recovering: 'Recovering',
  alive: 'Alive',
};

const SLIDERS: { key: keyof TriageWeights; label: string; hint: string }[] = [
  { key: 'urgency',    label: 'Urgency',    hint: 'How critical the extinction risk is right now' },
  { key: 'population', label: 'Scarcity',   hint: 'How few speakers remain' },
  { key: 'uniqueness', label: 'Uniqueness', hint: 'Isolates and last-of-their-family languages' },
];

function speakerLabel(n: number | null): string {
  if (n === null || n <= 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function familyLabel(l: RankedLang): string {
  if (l.familySize <= 1) return 'Isolate';
  return `${l.family_root} · ${l.familySize} langs`;
}

export default function RescueQueue({ languages, weights, onWeightsChange, selectedIso, onSelect }: Props) {
  const [open, setOpen] = useState(false);

  const familySizes = useMemo(() => buildFamilySizes(languages), [languages]);
  const logMax = useMemo(() => buildLogMax(languages), [languages]);

  const ranked: RankedLang[] = useMemo(
    () => rankLanguages(languages, weights, familySizes, logMax),
    [languages, weights, familySizes, logMax],
  );

  return (
    <>
      {/* edge handle — the only thing visible when the drawer is closed */}
      <button
        type="button"
        className={`rq-handle${open ? ' hidden' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Open rescue queue"
      >
        <span className="rq-handle-pulse" />
        <span className="rq-handle-text">Rescue Queue</span>
        <span className="rq-handle-count">{ranked.length}</span>
      </button>

      {/* scrim */}
      <div className={`rq-scrim${open ? ' show' : ''}`} onClick={() => setOpen(false)} />

      <aside className={`rq-drawer${open ? ' open' : ''}`} aria-hidden={!open}>
        <header className="rq-top">
          <div className="rq-top-copy">
            <span className="rq-eyebrow">Live triage</span>
            <h2 className="rq-title">Rescue Queue</h2>
            <p className="rq-lede">The languages to record first — re-weighted by what you value.</p>
          </div>
          <button type="button" className="rq-close" onClick={() => setOpen(false)} aria-label="Close">
            ×
          </button>
        </header>

        <section className="rq-weights">
          {SLIDERS.map(({ key, label, hint }) => (
            <label key={key} className={`rq-weight rq-w-${key}`} title={hint}>
              <span className="rq-weight-head">
                <span className="rq-weight-dot" />
                <span className="rq-weight-label">{label}</span>
                <span className="rq-weight-val">{weights[key]}</span>
              </span>
              <input
                type="range"
                min={0}
                max={10}
                step={1}
                value={weights[key]}
                onChange={(e) => onWeightsChange({ ...weights, [key]: Number(e.target.value) })}
                aria-label={label}
              />
            </label>
          ))}
        </section>

        <ol className="rq-list" role="list">
          {ranked.map((l) => {
            const active = selectedIso === l.iso_code;
            return (
              <li key={l.iso_code}>
                <button
                  type="button"
                  className={`rq-card${active ? ' active' : ''}`}
                  onClick={() => onSelect(l.iso_code)}
                >
                  <span className="rq-rank">{String(l.liveRank).padStart(2, '0')}</span>

                  <span className="rq-body">
                    <span className="rq-row-top">
                      <span className="rq-name">{l.name}</span>
                      <span className={`rq-risk risk-${l.risk}`}>{RISK_LABEL[l.risk] ?? l.risk}</span>
                    </span>

                    <span className="rq-meta">
                      <span className="rq-family">{familyLabel(l)}</span>
                      <span className="rq-speakers">{speakerLabel(l.speakers)} speakers</span>
                    </span>

                    {/* explainable score: three weighted contributions stacked */}
                    <span className="rq-meter" title={`Triage score ${(l.score * 100).toFixed(0)}%`}>
                      <span className="rq-seg rq-seg-urgency" style={{ width: `${l.parts.urgency * 100}%` }} />
                      <span className="rq-seg rq-seg-population" style={{ width: `${l.parts.population * 100}%` }} />
                      <span className="rq-seg rq-seg-uniqueness" style={{ width: `${l.parts.uniqueness * 100}%` }} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </aside>
    </>
  );
}
