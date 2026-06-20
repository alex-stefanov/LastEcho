// ---------------------------------------------------------------------------
// LastEcho — mock language dataset (scaffold only).
//
// This stands in for the SQLite artifact the Python build script will emit and
// the C# API will serve. Every status here is *precomputed* per year via a
// closed-form profile, mirroring the real plan: scrubbing the timeline only
// re-reads values, it never calls a model. Replace this file with the real API
// once the pipeline exists — the GlobePoint / Vitality contract stays the same.
// ---------------------------------------------------------------------------

export type Vitality = 'alive' | 'atRisk' | 'lost';

export const MIN_YEAR = 1990;
export const MAX_YEAR = 2045;
export const TODAY = 2026;

export interface LangRecord {
  id: number;
  name: string;
  lat: number;
  lng: number;
  family: string;
  region: string;
  speakers: number; // present-day estimate, 0 once lost
  docLevel: 'none' | 'wordlist' | 'grammar sketch' | 'full grammar';
  rank: number; // triage rank (1 = most urgent), placeholder
  // Closed-form vitality profile — the only state we store per language.
  declineStart: number | null; // year it slips into "at risk"; null = stable
  lostYear: number | null; // year its last speakers are gone; null = not lost
}

// What the globe actually renders — derived from a LangRecord for one year.
export interface GlobePoint {
  id: number;
  name: string;
  lat: number;
  lng: number;
  status: Vitality;
  color: string;
  radius: number;
}

export function statusAt(l: LangRecord, year: number): Vitality {
  if (l.lostYear !== null && year >= l.lostYear) return 'lost';
  if (l.declineStart !== null && year >= l.declineStart) return 'atRisk';
  return 'alive';
}

export function colorFor(s: Vitality): string {
  // Lost is rendered dim — absence you can see on the globe.
  if (s === 'alive') return 'rgba(52, 224, 161, 0.92)';
  if (s === 'atRisk') return 'rgba(246, 169, 59, 0.95)';
  return 'rgba(108, 125, 148, 0.45)';
}

export function radiusFor(s: Vitality): number {
  if (s === 'atRisk') return 0.26;
  if (s === 'alive') return 0.18;
  return 0.16;
}

// --- deterministic generation -------------------------------------------------

function mulberry32(seed: number) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20260620);
// roughly-gaussian jitter in [-1.5, 1.5] * spread
const jitter = (spread: number) => (rnd() + rnd() + rnd() - 1.5) * spread;

interface Hotspot {
  name: string;
  lat: number;
  lng: number;
  spread: number;
  count: number;
  family: string;
}

// Grounded in the real endangerment hotspots from PLAN.md.
const HOTSPOTS: Hotspot[] = [
  { name: 'New Guinea Highlands', lat: -5.6, lng: 143.5, spread: 6, count: 34, family: 'Trans–New Guinea' },
  { name: 'Amazon Basin', lat: -4.5, lng: -64, spread: 9, count: 26, family: 'Arawakan' },
  { name: 'Northern Australia', lat: -14, lng: 133, spread: 8, count: 20, family: 'Pama–Nyungan' },
  { name: 'Caucasus', lat: 42.6, lng: 44.5, spread: 3, count: 13, family: 'Northeast Caucasian' },
  { name: 'Pacific Northwest', lat: 50, lng: -124, spread: 6, count: 14, family: 'Salishan' },
  { name: 'Mesoamerica', lat: 17, lng: -95, spread: 5, count: 14, family: 'Oto–Manguean' },
  { name: 'West Africa', lat: 8, lng: 6, spread: 8, count: 16, family: 'Niger–Congo' },
  { name: 'Eastern Himalaya', lat: 27.5, lng: 93, spread: 5, count: 18, family: 'Sino–Tibetan' },
  { name: 'Siberia', lat: 62, lng: 108, spread: 12, count: 12, family: 'Tungusic' },
  { name: 'Mainland SE Asia', lat: 20, lng: 101, spread: 6, count: 14, family: 'Austroasiatic' },
];

const SYLL = ['ka', 'wa', 'mi', 'tu', 'na', 'ku', 'li', 'ya', 'ro', 'en', 'ba', 'si', 'to', 'nga', 'ai', 'um', 'da', 'we', 'pa', 'ngu'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function coinName(): string {
  const n = 2 + Math.floor(rnd() * 2);
  let out = '';
  for (let i = 0; i < n; i++) out += SYLL[Math.floor(rnd() * SYLL.length)];
  return cap(out);
}

const DOC: LangRecord['docLevel'][] = ['none', 'wordlist', 'grammar sketch', 'full grammar'];

function buildProfile(): Pick<LangRecord, 'declineStart' | 'lostYear'> {
  const r = rnd();
  if (r < 0.4) return { declineStart: null, lostYear: null }; // stable / alive
  if (r < 0.62) {
    // chronic at-risk, some heading to loss
    return { declineStart: 1900, lostYear: rnd() < 0.4 ? TODAY + Math.floor(rnd() * 18) : null };
  }
  if (r < 0.85) {
    // actively declining within the window
    const declineStart = 1995 + Math.floor(rnd() * 30);
    return { declineStart, lostYear: declineStart + 8 + Math.floor(rnd() * 32) };
  }
  // already lost
  const lostYear = 1992 + Math.floor(rnd() * 32);
  return { declineStart: lostYear - (5 + Math.floor(rnd() * 15)), lostYear };
}

function speakersFor(p: Pick<LangRecord, 'declineStart' | 'lostYear'>): number {
  if (p.lostYear !== null && p.lostYear <= TODAY) return 0;
  if (p.declineStart !== null && p.declineStart <= TODAY) return 20 + Math.floor(rnd() * 3000);
  return 1500 + Math.floor(rnd() * 90000);
}

function generate(): LangRecord[] {
  const out: LangRecord[] = [];
  let id = 0;

  const push = (lat: number, lng: number, family: string, region: string) => {
    const profile = buildProfile();
    out.push({
      id: id++,
      name: coinName(),
      lat: Math.max(-78, Math.min(80, lat)),
      lng: ((lng + 540) % 360) - 180,
      family: rnd() < 0.08 ? 'Isolate' : family,
      region,
      speakers: speakersFor(profile),
      docLevel: DOC[Math.min(3, Math.floor(rnd() * rnd() * 4 + rnd() * 0.6))],
      rank: 0,
      ...profile,
    });
  };

  for (const h of HOTSPOTS) {
    for (let i = 0; i < h.count; i++) push(h.lat + jitter(h.spread), h.lng + jitter(h.spread), h.family, h.name);
  }
  // sparse global scatter so the whole planet reads as inhabited
  const SCATTER_FAMILIES = ['Sino–Tibetan', 'Niger–Congo', 'Austronesian', 'Indo–European', 'Uralic', 'Isolate'];
  for (let i = 0; i < 30; i++) {
    push(jitter(36) + 18, rnd() * 360 - 180, SCATTER_FAMILIES[Math.floor(rnd() * SCATTER_FAMILIES.length)], 'Scattered');
  }

  // Triage rank (placeholder proxy): soonest-closing window first, lost last.
  const urgency = (l: LangRecord): number => {
    if (l.lostYear !== null && l.lostYear <= TODAY) return -1; // already lost
    if (l.lostYear !== null) return MAX_YEAR + 1 - l.lostYear; // sooner = higher
    if (l.declineStart !== null) return 4;
    return 0;
  };
  const docGap = (l: LangRecord) => 3 - DOC.indexOf(l.docLevel); // thinner record = higher
  out.sort((a, b) => urgency(b) * 4 + docGap(b) - (urgency(a) * 4 + docGap(a)));
  out.forEach((l, i) => (l.rank = i + 1));

  return out;
}

export const LANGUAGES: LangRecord[] = generate();
