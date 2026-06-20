// ---------------------------------------------------------------------------
// LastEcho — major-group taxonomy from the real per-year data.
//
// The Family Tree view hangs every language in a year snapshot off a small set
// of MAJOR language groups so the canopy reads as a handful of legible clusters
// instead of ~190 specialized tufts. The per-year files carry a flat
// `family_root` per language (193 distinct) plus map coordinates. We keep the
// largest families as their own named groups and pool the long tail by
// continent (and a couple of special non-genetic buckets) into "Other …"
// clusters. Every language is still rendered as a leaf, and its true
// `family_root` shows in the leaf tooltip and the detail drawer.
// ---------------------------------------------------------------------------

import { type YearLang } from './timeline';

export interface MajorGroup {
  name: string;
  langs: YearLang[];
  pooled: boolean; // true for the "Other …" catch-all clusters
  subFamilies: string[]; // distinct real family_roots inside this group
  size: number;
}

// How many of the biggest families get their own named cluster. The rest of the
// long tail is pooled by region so the crown stays ~14–18 clusters.
const NAMED_TOP = 14;

// Family roots that aren't geographic clades get pooled into their own buckets
// rather than a continental "Other" (unless they're already big enough to be a
// named top group, e.g. Isolate / Sign Language).
const SPECIAL_POOL: Record<string, string> = {
  'Not recorded': 'Unclassified',
  Unclassified: 'Unclassified',
  Unattested: 'Unclassified',
  'Mixed Language': 'Other tongues',
  Creole: 'Other tongues',
  Pidgin: 'Other tongues',
  'Artificial Language': 'Other tongues',
  'Speech Register': 'Other tongues',
};

// Coarse continental bucket from a centroid — approximate on purpose; it only
// decides which "Other {region}" cluster a small family pools into.
function continentOf(lat: number, lng: number): string {
  if (lng >= -170 && lng <= -34 && lat >= -56 && lat <= 74) return 'American';
  if (lng >= 110 && lng <= 180 && lat >= -48 && lat <= 12) return 'Pacific';
  if (lng >= -20 && lng <= 52 && lat >= -37 && lat <= 37) return 'African';
  return 'Eurasian';
}

function centroidContinent(langs: YearLang[]): string {
  let n = 0;
  let slat = 0;
  let slng = 0;
  for (const l of langs) {
    if (l.latitude_map != null && l.longitude_map != null) {
      slat += l.latitude_map;
      slng += l.longitude_map;
      n++;
    }
  }
  if (!n) return 'Eurasian';
  return continentOf(slat / n, slng / n);
}

// Build the major-group clusters: the biggest NAMED_TOP families each get their
// own named cluster; the long tail pools by continent (plus a couple of special
// non-genetic buckets). Named clusters lead, pooled "Other …" clusters last.
export function buildMajorGroups(roster: YearLang[]): MajorGroup[] {
  const byFam = new Map<string, YearLang[]>();
  for (const l of roster) {
    const a = byFam.get(l.family_root) ?? [];
    a.push(l);
    byFam.set(l.family_root, a);
  }

  // Rank the genetic families by size; the biggest NAMED_TOP each become their
  // own named cluster. Special non-genetic roots (Unclassified, creoles…) are
  // excluded here so they always pool, regardless of how large they rank.
  const ranked = [...byFam.entries()]
    .filter(([fam]) => !SPECIAL_POOL[fam])
    .sort((a, b) => b[1].length - a[1].length);
  const named = new Set(ranked.slice(0, NAMED_TOP).map(([fam]) => fam));

  const groups = new Map<string, { langs: YearLang[]; subs: Set<string>; pooled: boolean }>();
  const put = (key: string, fam: string, langs: YearLang[], pooled: boolean) => {
    const g = groups.get(key) ?? { langs: [], subs: new Set<string>(), pooled };
    for (const l of langs) g.langs.push(l);
    g.subs.add(fam);
    g.pooled = pooled;
    groups.set(key, g);
  };

  for (const [fam, langs] of byFam) {
    if (named.has(fam)) {
      put(fam, fam, langs, false);
    } else if (SPECIAL_POOL[fam]) {
      put(SPECIAL_POOL[fam], fam, langs, true);
    } else {
      put(`Other ${centroidContinent(langs)} families`, fam, langs, true);
    }
  }

  const out: MajorGroup[] = [];
  for (const [name, g] of groups) {
    out.push({
      name,
      langs: g.langs,
      pooled: g.pooled,
      subFamilies: [...g.subs].sort(),
      size: g.langs.length,
    });
  }
  // Named clusters first (by size desc), pooled "Other …" clusters last.
  out.sort((a, b) => Number(a.pooled) - Number(b.pooled) || b.size - a.size);
  return out;
}
