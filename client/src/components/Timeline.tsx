import { useCallback, useEffect, useRef, useState } from 'react';
import { TODAY } from '../data/mockLanguages';

interface Props {
  year: number;
  setYear: React.Dispatch<React.SetStateAction<number>>;
  playing: boolean;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}

// Full scrubbable range — every year in [DMIN, DMAX] is freely selectable.
const DMIN = 2000;
const DMAX = 2050;
// ML forecast begins after today: every year up to it is observed (green),
// after it the projection takes over (orange).
const SPLIT = TODAY;
const DECADES = [2000, 2010, 2020, 2030, 2040, 2050];

const clampYear = (y: number) => Math.min(DMAX, Math.max(DMIN, Math.round(y)));
const pct = (y: number) => ((y - DMIN) / (DMAX - DMIN)) * 100;
const SPLIT_PCT = pct(SPLIT);
const TODAY_PCT = pct(TODAY);

export default function Timeline({ year, setYear, playing, setPlaying }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const isFuture = year > SPLIT;

  // The run loop: step one year forward, quicker through the observed past and
  // a touch slower while predicting so the forecast reads. Keys off the current
  // year so Run always continues from wherever the thumb already sits.
  useEffect(() => {
    if (!playing) return;
    if (year >= DMAX) {
      setPlaying(false);
      return;
    }
    const delay = year < SPLIT ? 200 : 320;
    const id = setTimeout(() => setYear((y) => Math.min(DMAX, y + 1)), delay);
    return () => clearTimeout(id);
  }, [playing, year, setYear, setPlaying]);

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
