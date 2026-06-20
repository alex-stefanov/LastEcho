import { useCallback, useEffect, useRef, useState } from 'react';
import { TL_TODAY, TL_MIN_YEAR, TL_MAX_YEAR } from '../data/timeline';

interface Props {
  year: number;
  setYear: React.Dispatch<React.SetStateAction<number>>;
  playing: boolean;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  // Whether the currently-selected year's snapshot has loaded. Run won't step
  // onto the next year until the current one has been granted (loaded).
  ready: boolean;
}

const TODAY = TL_TODAY; // 2024 — last observed year

// Full scrubbable range — every year in [DMIN, DMAX] is freely selectable.
const DMIN = TL_MIN_YEAR; // 2000
const DMAX = TL_MAX_YEAR; // 2050
// ML forecast begins after today: every year up to it is observed (green),
// after it the projection takes over (orange).
const SPLIT = TODAY;
const DECADES = [2000, 2010, 2020, 2030, 2040, 2050];

// Linear scale across the whole range so each year gets an equal slice of the
// track and none are skipped.
const clampYear = (y: number) => Math.min(DMAX, Math.max(DMIN, Math.round(y)));
const nextYear = (y: number) => Math.min(DMAX, y + 1);
const pct = (y: number) => ((y - DMIN) / (DMAX - DMIN)) * 100;
const SPLIT_PCT = pct(SPLIT);
const TODAY_PCT = pct(TODAY);

export default function Timeline({ year, setYear, playing, setPlaying, ready }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const isFuture = year > SPLIT;

  // The run loop. Reschedules itself after every step, advancing one year at a
  // time across the full range. Crucially it keys off the *current* year, so
  // Run always continues from wherever the thumb already is — never from the
  // beginning. It also waits on `ready`: a step is only scheduled once the
  // current year's snapshot has loaded, so the globe is never asked to show a
  // year it doesn't yet have.
  useEffect(() => {
    if (!playing) return;
    if (year >= DMAX) {
      setPlaying(false);
      return;
    }
    if (!ready) return; // hold until the current year is loaded
    const delay = year < TODAY ? 1400 : 1100;
    const id = setTimeout(() => {
      setYear((y) => nextYear(y));
    }, delay);
    return () => clearTimeout(id);
  }, [playing, year, ready, setYear, setPlaying]);

  const yearFromClientX = useCallback((clientX: number) => {
    const el = trackRef.current;
    if (!el) return year;
    const rect = el.getBoundingClientRect();
    const ratio = (clientX - rect.left) / rect.width;
    return clampYear(DMIN + ratio * (DMAX - DMIN));
  }, [year]);

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
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = clampYear(year + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = clampYear(year - 1);
    else if (e.key === 'PageUp') next = clampYear(year + 10);
    else if (e.key === 'PageDown') next = clampYear(year - 10);
    else if (e.key === 'Home') next = DMIN;
    else if (e.key === 'End') next = DMAX;
    if (next === null) return;
    e.preventDefault();
    setPlaying(false);
    setYear(next);
  };

  const onRun = () => {
    if (playing) {
      setPlaying(false);
    } else {
      if (year >= DMAX) setYear(DMIN);
      setPlaying(true);
    }
  };

  const fillPct = pct(year);
  const greenW = Math.min(fillPct, SPLIT_PCT);
  const phase = playing && isFuture
    ? 'Predicting'
    : year === TODAY
      ? 'Today'
      : isFuture
        ? 'Projected'
        : 'Recorded';
  const runLabel = playing ? 'Pause' : year >= DMAX ? 'Replay' : 'Run';

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
          aria-valuemax={DMAX}
          aria-valuenow={year}
          aria-valuetext={`${year} — ${phase}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onKeyDown={onKeyDown}
        >
          <div className="track-rail" />

          {/* decade gridlines — quiet ruler marks for scale */}
          {DECADES.map((d) => (
            <span key={d} className="grid-tick" style={{ left: `${pct(d)}%` }} />
          ))}

          {/* tinted forecast lane, right of the ML split */}
          <div className="forecast-lane" style={{ left: `${SPLIT_PCT}%` }} />

          {/* observed fill (green) then forecast fill (orange) */}
          <div className="track-fill" style={{ width: `${greenW}%` }} />
          {isFuture && (
            <div
              className="track-fill future"
              style={{ left: `${SPLIT_PCT}%`, width: `${fillPct - SPLIT_PCT}%` }}
            />
          )}

          {/* today marker — also where the ML projection takes over */}
          <div className="today-mark" style={{ left: `${TODAY_PCT}%` }}>
            <span className="tm-label">Today</span>
            <span className="tm-tick" />
          </div>

          <div
            className={`thumb${isFuture ? ' future' : ''}${dragging ? ' grabbing' : ''}`}
            style={{ left: `${fillPct}%` }}
          >
            <span className="thumb-core" />
          </div>
        </div>

        <div className="scale">
          {DECADES.map((d) => (
            <span key={d} className="scale-year" style={{ left: `${pct(d)}%` }}>
              {d}
            </span>
          ))}
        </div>
      </div>

      <button
        className={`sim-btn${playing ? ' running' : ''}`}
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
