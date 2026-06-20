// ---------------------------------------------------------------------------
// LastEcho — triage scoring over real Glottolog timeline data (2026.json).
//
// Three normalised [0,1] signals combined with user-adjustable weights.
// All inputs are YearLang objects — no mock data, no LangRecord dependency.
// ---------------------------------------------------------------------------

import type { YearLang, YearRisk } from './timeline';

export interface TriageWeights {
  urgency: number;    // 0–10  how critical the extinction risk level is
  population: number; // 0–10  how few speakers remain
  uniqueness: number; // 0–10  how rare the language family is
}

export const DEFAULT_WEIGHTS: TriageWeights = { urgency: 5, population: 3, uniqueness: 2 };

// ---------------------------------------------------------------------------
// Signal 1: Extinction urgency from the Glottolog 8-level risk scale.
// ---------------------------------------------------------------------------

const RISK_SCORE: Record<YearRisk, number> = {
  critical:   1.00,
  at_risk:    0.80,
  vulnerable: 0.55,
  unknown:    0.25,
  stable:     0.20,
  recovering: 0.10,
  alive:      0.05,
  lost:       0.00,
};

function urgencySignal(l: YearLang): number {
  return RISK_SCORE[l.risk] ?? 0.25;
}

// ---------------------------------------------------------------------------
// Signal 2: Population pressure — fewer speakers = higher need.
// Log-normalised so a language with 10 speakers isn't dwarfed by one with 100k.
// maxSpeakers is precomputed from the full 2026 dataset.
// ---------------------------------------------------------------------------

function populationSignal(l: YearLang, logMax: number): number {
  if (l.speakers === null || l.speakers <= 0) return 1.0;
  if (logMax <= 0) return 0;
  return 1 - Math.log(l.speakers + 1) / logMax;
}

// ---------------------------------------------------------------------------
// Signal 3: Linguistic uniqueness — is this the last of its family?
// familySizes maps family_root → count across the 2026 snapshot.
// ---------------------------------------------------------------------------

function uniquenessSignal(l: YearLang, familySizes: Map<string, number>): number {
  const n = familySizes.get(l.family_root) ?? 1;
  if (n === 1)  return 1.00;
  if (n <= 3)   return 0.75;
  if (n <= 10)  return 0.45;
  if (n <= 30)  return 0.20;
  return 0.05;
}

// ---------------------------------------------------------------------------
// Helpers — call once per dataset change, pass results into scoring.
// ---------------------------------------------------------------------------

export function buildFamilySizes(languages: YearLang[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const l of languages) {
    m.set(l.family_root, (m.get(l.family_root) ?? 0) + 1);
  }
  return m;
}

/** log(maxSpeakers + 1) — precomputed so populationSignal stays pure. */
export function buildLogMax(languages: YearLang[]): number {
  let max = 0;
  for (const l of languages) {
    if (l.speakers !== null && l.speakers > max) max = l.speakers;
  }
  return Math.log(max + 1);
}

// ---------------------------------------------------------------------------
// Composite score and ranked list.
// ---------------------------------------------------------------------------

export function triageScore(
  l: YearLang,
  weights: TriageWeights,
  familySizes: Map<string, number>,
  logMax: number,
): number {
  const p = scoreParts(l, weights, familySizes, logMax);
  return p.urgency + p.population + p.uniqueness;
}

/**
 * The three *weighted, normalised* contributions to the composite score — they
 * sum to triageScore(). Surfacing them lets the UI explain WHY a language ranks
 * where it does (the "explainable triage" goal in MODEL.md).
 */
export interface ScoreParts {
  urgency: number;
  population: number;
  uniqueness: number;
}

export function scoreParts(
  l: YearLang,
  weights: TriageWeights,
  familySizes: Map<string, number>,
  logMax: number,
): ScoreParts {
  const total = weights.urgency + weights.population + weights.uniqueness;
  if (total === 0) return { urgency: 0, population: 0, uniqueness: 0 };
  return {
    urgency:    (weights.urgency    * urgencySignal(l)) / total,
    population: (weights.population * populationSignal(l, logMax)) / total,
    uniqueness: (weights.uniqueness * uniquenessSignal(l, familySizes)) / total,
  };
}

export interface RankedLang extends YearLang {
  score: number;
  parts: ScoreParts;
  familySize: number;
  liveRank: number;
}

/** Returns the top `limit` languages sorted by triage score. Excludes lost. */
export function rankLanguages(
  languages: YearLang[],
  weights: TriageWeights,
  familySizes: Map<string, number>,
  logMax: number,
  limit = 40,
): RankedLang[] {
  const scored = languages
    .filter((l) => l.risk !== 'lost' && (l.speakers === null || l.speakers > 0))
    .map((l) => {
      const parts = scoreParts(l, weights, familySizes, logMax);
      return {
        ...l,
        parts,
        score: parts.urgency + parts.population + parts.uniqueness,
        familySize: familySizes.get(l.family_root) ?? 1,
        liveRank: 0,
      };
    });

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);
  top.forEach((l, i) => { l.liveRank = i + 1; });
  return top;
}
