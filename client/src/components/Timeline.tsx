import { useCallback, useEffect, useRef, useState } from 'react';
import { TODAY } from '../data/mockLanguages';

interface Props {
  year: number;
  setYear: React.Dispatch<React.SetStateAction<number>>;
  playing: boolean;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}

// Recorded snapshots — the only selectable years in the past.
const RECORDED = [
  { year: 2018, label: 'Past' },
  { year: 2020, label: 'Recent' },
  { year: TODAY, label: 'Today' }, // 2024
] as const;
const RECORDED_YEARS: number[] = RECORDED.map((m) => m.year);

// Forecast horizon — the right-hand lane the ML simulation fills in.
const HORIZON = 2045;
const DMIN = RECORDED_YEARS[0];

// Piecewise scale: the recorded past gets a fixed slice of the track so its
// three stops stay legible; the forecast lane takes the rest.
const RECORDED_FRAC = 42; // % of the track devoted to 2018→Today
const TODAY_PCT = RECORDED_FRAC;
const pct = (y: number) =>
  y <= TODAY
    ? ((y - DMIN) / (TODAY - DMIN)) * RECORDED_FRAC
    : RECORDED_FRAC + ((y - TODAY) / (HORIZON - TODAY)) * (100 - RECORDED_FRAC);
const yearFromPct = (p: number) =>
  p <= RECORDED_FRAC
    ? DMIN + (p / RECORDED_FRAC) * (TODAY - DMIN)
    : TODAY + ((p - RECORDED_FRAC) / (100 - RECORDED_FRAC)) * (HORIZON - TODAY);

// Where the run goes next from a given year: through the recorded stops in the
// past, then one ML-predicted year at a time once we're at/after Today.
function nextYear(y: number): number {
  if (y < TODAY) {
    const above = RECORDED_YEARS.find((r) => r > y);
    return above ?? TODAY;
  }
  return Math.min(HORIZON, y + 1);
}

export default function Timeline({ year, setYear, playing, setPlaying }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  // Once the run crosses into the future, the forecast lane is "live" and the
  // ML projection can be scrubbed.
  const [simRan, setSimRan] = useState(false);

  const isFuture = year > TODAY;

  useEffect(() => {
    if (year > TODAY && !simRan) setSimRan(true);
  }, [year, simRan]);

  // The run loop. Reschedules itself after every step, pausing briefly on the
  // recorded stops and then stepping year-by-year through the ML forecast.
  // Crucially it keys off the *current* year, so Run always continues from
  // wherever the thumb already is — never from the beginning.
  useEffect(() => {
    if (!playing) return;
    if (year >= HORIZON) {
      setPlaying(false);
      return;
    }
    const delay = year < TODAY ? 650 : 150;
    const id = setTimeout(() => {
      // TODO(ml): for years past Today, fetch the model's projection for
      // nextYear(year) here and feed its per-language vitality to the globe.
      setYear((y) => nextYear(y));
    }, delay);
    return () => clearTimeout(id);
  }, [playing, year, setYear, setPlaying]);

  // Resolve a raw year to a *selectable* one: snap to a stop in the past, free
  // scrubbing through the forecast — but only once it has been simulated.
  const resolve = useCallback((target: number) => {
    if (target <= TODAY) {
      let best = RECORDED_YEARS[0];
      for (const y of RECORDED_YEARS) if (Math.abs(y - target) < Math.abs(best - target)) best = y;
      return best;
    }
    if (!simRan) return TODAY;
    return Math.min(HORIZON, Math.max(TODAY, Math.round(target)));
  }, [simRan]);

  const yearFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return year;
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return resolve(yearFromPct(ratio * 100));
  }, [resolve, year]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setPlaying(false);
    setDragging(true);
    setYear(yearFromClientX(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    setYear(yearFromClientX(e.clientX));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging) return;
    setDragging(false);
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    setPlaying(false);
    let next: number | null = null;
    const i = RECORDED_YEARS.indexOf(year);
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      if (year < TODAY && i >= 0 && i < RECORDED_YEARS.length - 1) next = RECORDED_YEARS[i + 1];
      else next = simRan ? Math.min(HORIZON, Math.max(TODAY, year) + 1) : TODAY;
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      if (year > TODAY) next = year - 1;
      else if (i > 0) next = RECORDED_YEARS[i - 1];
    } else if (e.key === 'Home') next = DMIN;
    else if (e.key === 'End') next = simRan ? HORIZON : TODAY;
    if (next === null) return;
    e.preventDefault();
    setYear(next);
  };

  const onRun = () => {
    if (playing) {
      setPlaying(false); // pause where we are
    } else {
      if (year >= HORIZON) setYear(TODAY); // nothing ahead — restart the forecast
      setPlaying(true); // otherwise continue from the current year
    }
  };

  const fillPct = pct(year);
  const coolW = Math.min(fillPct, TODAY_PCT);
  const recorded = RECORDED.find((m) => m.year === year);
  const phase = isFuture ? (playing ? 'Predicting' : 'Projected') : recorded?.label ?? '';
  const runLabel = playing
    ? 'Pause'
    : year >= HORIZON
      ? 'Replay'
      : isFuture
        ? 'Resume'
        : 'Run';

  return (
    <div className={`timeline${dragging ? ' is-dragging' : ''}${playing && isFuture ? ' is-simulating' : ''}`}>
      <div className="year-block">
        <div className={`year${isFuture ? ' future' : ''}`}>{year}</div>
        <div className="phase">{phase}</div>
      </div>

      <div className="scrub">
        <div
          ref={trackRef}
          className="track"
          role="slider"
          tabIndex={0}
          aria-label="Year"
          aria-valuemin={DMIN}
          aria-valuemax={simRan ? HORIZON : TODAY}
          aria-valuenow={year}
          aria-valuetext={`${year} — ${phase}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <div className="track-rail" />

          {/* reserved forecast lane — filled by the ML simulation */}
          <div className={`forecast${simRan ? ' live' : ' locked'}`} style={{ left: `${TODAY_PCT}%` }}>
            <span className="forecast-label">ML Forecast</span>
          </div>

          <div className="track-fill" style={{ width: `${coolW}%` }} />
          {isFuture && (
            <div
              className="track-fill future"
              style={{ left: `${TODAY_PCT}%`, width: `${fillPct - TODAY_PCT}%` }}
            />
          )}

          <div className="today-mark" style={{ left: `${TODAY_PCT}%` }} />

          {RECORDED.map((m) => {
            const isActive = year === m.year;
            const isNow = m.year === TODAY;
            return (
              <button
                key={m.year}
                type="button"
                className={`milestone${isActive ? ' active' : ''}${isNow ? ' now' : ''}`}
                style={{ left: `${pct(m.year)}%` }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => {
                  setPlaying(false);
                  setYear(m.year);
                }}
                aria-label={`${m.label} — ${m.year}`}
              >
                <span className="milestone-dot" />
                <span className="milestone-tip">
                  <em>{m.label}</em>
                  {m.year}
                </span>
              </button>
            );
          })}

          <div className={`thumb${isFuture ? ' future' : ''}${dragging ? ' grabbing' : ''}`} style={{ left: `${fillPct}%` }}>
            <span className="thumb-core" />
          </div>
        </div>
      </div>

      <button
        className={`sim-btn${simRan ? ' ran' : ''}${playing ? ' running' : ''}`}
        onClick={onRun}
        aria-label={runLabel}
      >
        {playing ? (
          <svg width="11" height="12" viewBox="0 0 12 13" fill="currentColor">
            <rect x="0" y="0" width="3.6" height="13" rx="1.4" />
            <rect x="8.4" y="0" width="3.6" height="13" rx="1.4" />
          </svg>
        ) : (
          <svg className="spark" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0l2.3 9.7L24 12l-9.7 2.3L12 24l-2.3-9.7L0 12l9.7-2.3z" />
          </svg>
        )}
        <span>{runLabel}</span>
      </button>
    </div>
  );
}
