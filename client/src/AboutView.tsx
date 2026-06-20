// ---------------------------------------------------------------------------
// LastEcho — About page.
//
// A standalone, long-form editorial surface (path /about) that explains the
// project. It shares the globe app's design language — Fraunces display +
// Space Grotesk body, the vitality palette, glass panels, atmospheric glows —
// but, unlike the fixed full-screen app, it scrolls.
//
// The "Rescue Queue" preview is computed live from the same real, per-year
// Glottolog dataset the globe runs on (data/timeline_by_year/{TL_TODAY}.json),
// ranked with the app's own triage scoring. It is a real slice of the data,
// not a mock.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ThemeToggle, { type Theme } from './components/ThemeToggle';
import { getCachedYear, loadYear, TL_TODAY, GROUP_COLOR, type VitalityGroup, type YearData } from './data/timeline';
import { rankLanguages, buildFamilySizes, buildLogMax, DEFAULT_WEIGHTS, type RankedLang } from './data/triage';

const THEME_KEY = 'lastecho-theme';

const RISK_LABEL: Record<string, string> = {
  critical: 'Critical',
  at_risk: 'At risk',
  vulnerable: 'Vulnerable',
  unknown: 'Unknown',
  stable: 'Stable',
  recovering: 'Recovering',
  alive: 'Alive',
};

function urgencyColor(group: VitalityGroup): string {
  return GROUP_COLOR[group];
}

// Decorative field of faint, twinkling language-dots behind the hero. Generated
// deterministically so the layout is stable across renders (no layout jitter).
const HUES = ['#35d49a', '#e8c34a', '#ef5b3f', '#8d7fce', '#5d6878'];
const DOTS = Array.from({ length: 46 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return {
    left: 4 + r(1) * 92,
    top: 6 + r(2) * 86,
    size: 2 + r(3) * 4,
    hue: HUES[Math.floor(r(4) * HUES.length)],
    delay: r(5) * 6,
    dur: 3.5 + r(6) * 4,
  };
});

// Reveal-on-scroll wrapper — adds `.in` once the block enters the viewport.
function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal${shown ? ' in' : ''} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

const AUDIENCES: { icon: ReactNode; title: string; body: string }[] = [
  {
    title: 'Everyday users',
    body: 'Language loss made visible and tangible through an interactive globe you can feel, not just read.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
      </svg>
    ),
  },
  {
    title: 'Students & researchers',
    body: 'A structured way to explore endangered languages and compare risk levels side by side.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 4 2.5 8.5 12 13l9.5-4.5L12 4Z" />
        <path d="M6 10.5V16c0 1.4 2.7 2.8 6 2.8s6-1.4 6-2.8v-5.5" />
      </svg>
    ),
  },
  {
    title: 'Linguists & archives',
    body: 'A living worklist for documentation priorities — what to record before the last voice falls silent.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7v11.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V7" />
        <path d="M3 4h18v3H3zM10 11h4" />
      </svg>
    ),
  },
  {
    title: 'Funders & institutions',
    body: 'Clearer decisions about where limited time and resources should go first.',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 21h16M6 21V9l6-4 6 4v12M10 21v-6h4v6" />
      </svg>
    ),
  },
];

export default function AboutView() {
  const [theme, setTheme] = useState<Theme>(() =>
    localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark',
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // The real rescue queue: top-5 of the app's own triage ranking over the
  // current year's Glottolog snapshot — same data and scoring the globe uses.
  const [queue, setQueue] = useState<RankedLang[]>([]);
  useEffect(() => {
    const apply = (data: YearData) => {
      const familySizes = buildFamilySizes(data.languages);
      const logMax = buildLogMax(data.languages);
      setQueue(rankLanguages(data.languages, DEFAULT_WEIGHTS, familySizes, logMax, 5));
    };
    const cached = getCachedYear(TL_TODAY);
    if (cached) {
      apply(cached);
      return;
    }
    loadYear(TL_TODAY).then(apply).catch(() => {});
  }, []);

  return (
    <main className="about">
      <div className="about-atmos" aria-hidden>
        {DOTS.map((d, i) => (
          <span
            key={i}
            className="about-dot"
            style={{
              left: `${d.left}%`,
              top: `${d.top}%`,
              width: d.size,
              height: d.size,
              background: d.hue,
              boxShadow: `0 0 ${d.size * 2.5}px ${d.hue}`,
              animationDelay: `${d.delay}s`,
              animationDuration: `${d.dur}s`,
            }}
          />
        ))}
      </div>

      <div className="about-topbar">
        <a className="about-back" href="/">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5l-7 7 7 7" />
          </svg>
          <span>Globe</span>
        </a>
        <ThemeToggle theme={theme} onToggle={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} />
      </div>

      <article className="about-doc">
        {/* hero ------------------------------------------------------------- */}
        <header className="about-hero">
          <p className="eyebrow about-kicker">A warning system for human language</p>
          <h1 className="about-mark">
            Last<span>Echo</span>
          </h1>
          <p className="about-lede">
            A planet of fading light — every dot is a language, and every fading dot is a warning.
          </p>
          <p className="about-sub">
            LastEcho helps identify which endangered languages need documentation most urgently. Instead of
            only showing that a language is at risk, it focuses on one question:
          </p>
          <p className="about-question">
            Which languages are closest to disappearing, and which ones should be documented first?
          </p>
          <div className="about-legend">
            {[
              ['#35d49a', 'Healthy'],
              ['#e8c34a', 'Watch'],
              ['#ef5b3f', 'Serious'],
              ['#5d6878', 'Gone'],
              ['#8d7fce', 'Unknown'],
            ].map(([c, l]) => (
              <span key={l} className="about-legend-item">
                <span className="dot" style={{ background: c, boxShadow: `0 0 8px -1px ${c}` }} />
                {l}
              </span>
            ))}
          </div>
        </header>

        {/* about ------------------------------------------------------------ */}
        <Reveal className="about-section">
          <p className="eyebrow">About LastEcho</p>
          <h2>A digital triage system for endangered languages.</h2>
          <p>
            Around the world, many languages are losing speakers. Some are still spoken by whole communities,
            some only by older generations, and some are close to disappearing completely. When a language
            disappears without being documented, more than words are lost — songs, stories, traditions, local
            knowledge, history, and identity can disappear with it.
          </p>
          <p>
            LastEcho was created to make this crisis easier to understand and easier to act on. The app shows
            languages on an interactive globe and uses data to estimate how urgent each case is, so you can see
            where languages are healthy, where they are at risk, and where they may disappear soon.
          </p>
        </Reveal>

        {/* mission ---------------------------------------------------------- */}
        <Reveal className="about-section">
          <p className="eyebrow">Our mission</p>
          <h2>Help people understand language loss before it becomes permanent.</h2>
          <p>
            LastEcho does not claim to save languages by itself. Survival depends on communities, education,
            culture, policy, and real-world support. What LastEcho does is organize the problem — giving
            researchers, organizations, funders, and curious users a clearer view of:
          </p>
          <ul className="about-list">
            <li>which languages are endangered,</li>
            <li>where they are located,</li>
            <li>how soon they may disappear,</li>
            <li>how well they are documented,</li>
            <li>and which languages should be prioritized first.</li>
          </ul>
        </Reveal>

        {/* ranking ---------------------------------------------------------- */}
        <Reveal className="about-section">
          <p className="eyebrow">Why ranking matters</p>
          <h2>Not every endangered language has the same urgency.</h2>
          <p>
            Some endangered languages already have dictionaries, grammar descriptions, audio recordings, or
            written documentation. Others may disappear soon with almost no record at all. LastEcho ranks
            languages by the time they may have left — those predicted to fall silent sooner rise higher in the
            queue — while also weighing how well a language is documented and how unique it is.
          </p>
          <p className="about-pull">
            A practical rescue queue: document the languages with the least time left, before it is too late.
          </p>
        </Reveal>

        {/* rescue queue ----------------------------------------------------- */}
        <Reveal className="about-section about-queue-section">
          <p className="eyebrow">The Rescue Queue</p>
          <h2>A ranked list of who needs attention first.</h2>
          <p>
            Ranked by extinction risk, speaker scarcity, and linguistic uniqueness. Below is a live slice of
            LastEcho's own triage score, computed from the same Glottolog dataset the globe runs on.
          </p>
          <ol className="about-queue">
            {queue.map((l, i) => {
              const color = urgencyColor(l.vitality_group);
              return (
                <li key={l.iso_code} className="about-queue-row">
                  <span className="aq-rank num">{String(i + 1).padStart(2, '0')}</span>
                  <span className="aq-bar" style={{ background: color }} />
                  <span className="aq-main">
                    <span className="aq-name">{l.name}</span>
                    <span className="aq-meta">
                      {l.family_root} · {(l.speakers ?? 0).toLocaleString()} speakers
                    </span>
                  </span>
                  <span className="aq-doc" style={{ color }}>
                    {RISK_LABEL[l.risk] ?? l.risk}
                  </span>
                  <span className="aq-left">
                    <span className="aq-years num" style={{ color }}>
                      {Math.round(l.score * 100)}%
                    </span>
                    <span className="aq-left-label">priority score</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="about-queue-note">
            The goal is simple: turn language loss into a clear list of priorities — moving beyond awareness to
            answer “what should we focus on first?”
          </p>
        </Reveal>

        {/* how it works ----------------------------------------------------- */}
        <Reveal className="about-section">
          <p className="eyebrow">How LastEcho works</p>
          <h2>Visual storytelling, backed by data-based prioritization.</h2>
          <p>
            The globe gives an emotional, geographic view of the crisis: each language is a point of light, its
            color showing whether it is alive, at risk, or lost. The timeline lets you move through the years and
            watch how languages change — and, in future years, which ones may disappear next.
          </p>
          <p>When you select a language, LastEcho surfaces the detail behind the dot:</p>
          <div className="about-chips">
            {['Name', 'Location', 'Vitality status', 'Estimated speakers', 'Predicted disappearance', 'Documentation level', 'Language family', 'Priority rank'].map(
              (c) => (
                <span key={c} className="about-chip">{c}</span>
              ),
            )}
          </div>
        </Reveal>

        {/* audiences -------------------------------------------------------- */}
        <Reveal className="about-section">
          <p className="eyebrow">Who LastEcho is for</p>
          <h2>One view of the crisis, for many kinds of work.</h2>
          <div className="about-cards">
            {AUDIENCES.map((a) => (
              <div key={a.title} className="about-card panel">
                <span className="about-card-icon">{a.icon}</span>
                <h3>{a.title}</h3>
                <p>{a.body}</p>
              </div>
            ))}
          </div>
        </Reveal>

        {/* closing ---------------------------------------------------------- */}
        <Reveal className="about-section about-closing">
          <p className="eyebrow">Why it matters</p>
          <h2 className="about-closing-head">Every language is a way of seeing the world.</h2>
          <p>
            When a language disappears, the loss is not only linguistic. A community loses part of its memory,
            and humanity loses knowledge that may never be recovered. LastEcho exists because the world needs a
            better way to see these losses before they happen.
          </p>
          <p className="about-coda">
            Not just a map.
            <br />
            Not just a database.
            <br />
            <strong>A warning system. A priority list. A last chance to listen.</strong>
          </p>
          <a className="about-cta" href="/">
            Explore the globe
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 5l7 7-7 7" />
            </svg>
          </a>
        </Reveal>

        <footer className="about-foot">
          <span className="about-foot-mark">
            Last<span>Echo</span>
          </span>
          <span className="about-foot-tag">A planet of fading light.</span>
        </footer>
      </article>
    </main>
  );
}
