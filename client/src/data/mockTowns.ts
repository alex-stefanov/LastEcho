// ---------------------------------------------------------------------------
// LastEcho — mock "towns going extinct" dataset (scaffold only).
//
// A second layer that sits alongside the language layer: rural settlements
// emptying out through depopulation. Like mockLanguages, every status is
// precomputed per year from a closed-form profile, so scrubbing the timeline
// only re-reads values — it never runs a model. Replace with the real API once
// the pipeline exists; the TownPoint / Vitality contract stays the same.
//
// We reuse the Vitality scale so the two layers share one legend:
//   alive  → thriving   (stable population)
//   atRisk → emptying    (shrinking, ageing)
//   lost   → abandoned   (no permanent residents)
// ---------------------------------------------------------------------------

import { type Vitality, MAX_YEAR, TODAY } from './mockLanguages';

export type { Vitality } from './mockLanguages';

export interface TownRecord {
  id: number;
  name: string;
  lat: number;
  lng: number;
  country: string;
  region: string;
  population: number; // present-day estimate, 0 once abandoned
  peakPopulation: number;
  peakYear: number;
  // Closed-form vitality profile — the only state we store per town.
  declineStart: number | null; // year it slips into "emptying"; null = stable
  lostYear: number | null; // year the last residents leave; null = not abandoned
}

// What the globe renders for a town — derived from a TownRecord for one year.
export interface TownPoint {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

export function townStatusAt(t: TownRecord, year: number): Vitality {
  if (t.lostYear !== null && year >= t.lostYear) return 'lost';
  if (t.declineStart !== null && year >= t.declineStart) return 'atRisk';
  return 'alive';
}

// Human label for a town's vitality (distinct wording from languages).
export function townLabel(s: Vitality): string {
  if (s === 'alive') return 'Thriving';
  if (s === 'atRisk') return 'Emptying';
  return 'Abandoned';
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

const rnd = mulberry32(0x7041d9);
const jitter = (spread: number) => (rnd() + rnd() + rnd() - 1.5) * spread;

interface Cluster {
  name: string;
  country: string;
  lat: number;
  lng: number;
  spread: number;
  count: number;
}

// Grounded in real rural-depopulation belts.
const CLUSTERS: Cluster[] = [
  { name: 'Inland Iberia', country: 'Spain', lat: 41, lng: -4.5, spread: 3.4, count: 18 },
  { name: 'Apennines', country: 'Italy', lat: 42.5, lng: 13.2, spread: 2.6, count: 16 },
  { name: 'Tōhoku', country: 'Japan', lat: 39, lng: 140.6, spread: 2.4, count: 17 },
  { name: 'Great Plains', country: 'United States', lat: 43, lng: -100, spread: 5, count: 15 },
  { name: 'Russian North', country: 'Russia', lat: 60, lng: 44, spread: 6, count: 14 },
  { name: 'Carpathian Basin', country: 'Romania', lat: 46.5, lng: 24.5, spread: 3, count: 13 },
  { name: 'Anatolian Plateau', country: 'Türkiye', lat: 39, lng: 34, spread: 3.5, count: 11 },
  { name: 'Scottish Highlands', country: 'United Kingdom', lat: 57.4, lng: -4.6, spread: 1.8, count: 9 },
  { name: 'Patagonia', country: 'Argentina', lat: -44, lng: -69, spread: 5, count: 8 },
  { name: 'Sahel Margin', country: 'Mali', lat: 15.5, lng: -3, spread: 4, count: 9 },
];

// Lightweight, region-flavoured naming so towns don't read as languages.
const PREFIX = ['Vila', 'San', 'Castel', 'Kami', 'Shimo', 'Nieder', 'Stari', 'Nova', 'Fort', 'Mont', 'Aldea', 'Borgo', 'Kirk', 'Glen'];
const ROOT = ['monte', 'rio', 'campo', 'val', 'wood', 'mura', 'gawa', 'field', 'burgh', 'haven', 'mark', 'stead', 'cross', 'dorf', 'ovo', 'esti', 'köy', 'bal'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
function coinName(): string {
  const usePrefix = rnd() < 0.55;
  const root = cap(ROOT[Math.floor(rnd() * ROOT.length)]);
  return usePrefix ? `${PREFIX[Math.floor(rnd() * PREFIX.length)]} ${root}` : root + ROOT[Math.floor(rnd() * ROOT.length)];
}

function buildProfile(): Pick<TownRecord, 'declineStart' | 'lostYear'> {
  const r = rnd();
  if (r < 0.3) return { declineStart: null, lostYear: null }; // still thriving
  if (r < 0.55) {
    // long, slow drain — some empty out within the forecast window
    return { declineStart: 1970 + Math.floor(rnd() * 30), lostYear: rnd() < 0.45 ? TODAY + Math.floor(rnd() * 19) : null };
  }
  if (r < 0.82) {
    // actively emptying inside the window
    const declineStart = 1995 + Math.floor(rnd() * 30);
    return { declineStart, lostYear: declineStart + 10 + Math.floor(rnd() * 28) };
  }
  // already abandoned
  const lostYear = 1992 + Math.floor(rnd() * 32);
  return { declineStart: lostYear - (8 + Math.floor(rnd() * 18)), lostYear };
}

function popFor(p: Pick<TownRecord, 'declineStart' | 'lostYear'>): { population: number; peak: number; peakYear: number } {
  const peak = 200 + Math.floor(rnd() * 12000);
  const peakYear = 1950 + Math.floor(rnd() * 45);
  if (p.lostYear !== null && p.lostYear <= TODAY) return { population: 0, peak, peakYear };
  if (p.declineStart !== null && p.declineStart <= TODAY) return { population: 5 + Math.floor(rnd() * Math.max(20, peak * 0.25)), peak, peakYear };
  return { population: Math.floor(peak * (0.6 + rnd() * 0.4)), peak, peakYear };
}

function generate(): TownRecord[] {
  const out: TownRecord[] = [];
  let id = 0;

  for (const c of CLUSTERS) {
    for (let i = 0; i < c.count; i++) {
      const profile = buildProfile();
      const p = popFor(profile);
      out.push({
        id: id++,
        name: coinName(),
        lat: Math.max(-78, Math.min(80, c.lat + jitter(c.spread))),
        lng: ((c.lng + jitter(c.spread) + 540) % 360) - 180,
        country: c.country,
        region: c.name,
        population: p.population,
        peakPopulation: p.peak,
        peakYear: p.peakYear,
        ...profile,
      });
    }
  }
  return out;
}

export const TOWNS: TownRecord[] = generate();
export const MAX_TOWN_YEAR = MAX_YEAR; // re-export for symmetry / future use
