import { useEffect } from 'react';
import { MIN_YEAR, MAX_YEAR, TODAY } from '../data/mockLanguages';

interface Props {
  year: number;
  setYear: React.Dispatch<React.SetStateAction<number>>;
  playing: boolean;
  setPlaying: React.Dispatch<React.SetStateAction<boolean>>;
}

const SPAN = MAX_YEAR - MIN_YEAR;
const pct = (y: number) => ((y - MIN_YEAR) / SPAN) * 100;
const DECADES = [1990, 2000, 2010, 2020, 2030, 2040];

export default function Timeline({ year, setYear, playing, setPlaying }: Props) {
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setYear((y) => (y >= MAX_YEAR ? MIN_YEAR : y + 1));
    }, 140);
    return () => clearInterval(id);
  }, [playing, setYear]);

  const todayPct = pct(TODAY);
  const isFuture = year > TODAY;

  // Cool track for recorded history, amber for the forecast zone (after today).
  const track = `linear-gradient(90deg,
    #36425a 0%, #46566f ${todayPct}%,
    rgba(234,162,60,0.5) ${todayPct}%, rgba(234,162,60,0.24) 100%)`;

  return (
    <div className="timeline panel">
      <button className="play" onClick={() => setPlaying((p) => !p)} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? (
          <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor">
            <rect x="0" y="0" width="3.6" height="13" rx="1" />
            <rect x="8.4" y="0" width="3.6" height="13" rx="1" />
          </svg>
        ) : (
          <svg width="12" height="13" viewBox="0 0 12 13" fill="currentColor">
            <path d="M0 .7v11.6a.7.7 0 0 0 1.1.6l10-5.8a.7.7 0 0 0 0-1.2l-10-5.8A.7.7 0 0 0 0 .7Z" />
          </svg>
        )}
      </button>

      <div className="year-block">
        <div className={`year${isFuture ? ' future' : ''}`}>{year}</div>
        <div className="phase">{isFuture ? 'Forecast' : 'Recorded'}</div>
      </div>

      <div className="scrub">
        <input
          className="range"
          type="range"
          min={MIN_YEAR}
          max={MAX_YEAR}
          value={year}
          style={{ background: track }}
          onChange={(e) => {
            setPlaying(false);
            setYear(Number(e.target.value));
          }}
        />
        <div className="today-divider" style={{ left: `${todayPct}%` }}>
          <span>Today</span>
        </div>
        <div className="ticks">
          {DECADES.map((d) => (
            <span key={d} className="tick" style={{ left: `${pct(d)}%` }}>
              {d}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
