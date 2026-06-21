// ---------------------------------------------------------------------------
// LastEcho — per-year timeline data.
//
// The globe's extinction-risk layer is driven by the real, per-year snapshots
// in ./timeline_by_year/{year}.json (2000–2050, ~3,300 languages each). Those
// files total ~99 MB, so they are NOT bundled: Vite's import.meta.glob gives one
// lazily-loaded, code-split chunk per year, fetched straight from the client
// data folder on demand and cached by the browser.
//
// We additionally cache the parsed result in memory so scrubbing back to a year
// already visited is instant and never re-fetches — this is the "show a year"
// gate: a year is only rendered once its snapshot has been loaded. The in-memory
// cache is LRU-bounded (see MAX_CACHED_YEARS) so playing through all 51 years
// can't pin tens of MB of parsed objects in the tab on low-memory devices.
// ---------------------------------------------------------------------------

import metadata from './timeline_by_year/metadata.json';

// The real per-year snapshots carry an 8-level vitality scale (`risk`), each
// already mapped to one of 5 broad groups (`vitality_group`) by the data
// pipeline — this is the grouping the globe's color and filters key off, not
// the old 3-bucket mock Vitality type (which still drives the unrelated Tree
// view's separate dataset).
export type YearRisk =
  | 'alive'
  | 'stable'
  | 'recovering'
  | 'vulnerable'
  | 'at_risk'
  | 'critical'
  | 'lost'
  | 'unknown';

export type VitalityGroup = 'healthy' | 'watch' | 'serious' | 'gone' | 'unknown';

export interface YearLang {
  iso_code: string;
  name: string;
  speakers: number | null;
  risk: YearRisk;
  vitality_group: VitalityGroup;
  family_root: string;
  latitude_map: number | null;
  longitude_map: number | null;
}

export interface YearData {
  year: number;
  language_count: number;
  languages: YearLang[];
}

export const TL_MIN_YEAR = metadata.min_year; // 2000
export const TL_MAX_YEAR = metadata.max_year; // 2050
// Last observed / benchmark year — everything past it is the scenario forecast.
export const TL_TODAY = 2026;
export const FORECAST_START = TL_TODAY + 1; // 2027

// One lazy import per snapshot. import.meta.glob is lazy by default (it returns
// loader functions, not the data), so each year becomes its own chunk.
const loaders = import.meta.glob('./timeline_by_year/*.json') as Record<
  string,
  () => Promise<{ default: YearData }>
>;

const byYear = new Map<number, () => Promise<{ default: YearData }>>();
for (const path in loaders) {
  const m = path.match(/(\d{4})\.json$/); // skip metadata.json
  if (m) byYear.set(Number(m[1]), loaders[path]);
}

// Bound the in-memory snapshot cache. Each year is ~2 MB of parsed objects;
// keeping the most-recently-used handful covers scrubbing and playback while
// preventing unbounded heap growth across all 51 years on a long session.
const MAX_CACHED_YEARS = 8;
const cache = new Map<number, YearData>();

// Mark `year` as most-recently-used: re-insert it so it moves to the end of the
// Map's insertion order (the first key is then the least-recently-used).
function touch(year: number): void {
  const value = cache.get(year);
  if (value === undefined) return;
  cache.delete(year);
  cache.set(year, value);
}

function evictIfNeeded(): void {
  while (cache.size > MAX_CACHED_YEARS) {
    const oldest = cache.keys().next().value as number | undefined;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export function hasYear(year: number): boolean {
  return byYear.has(year);
}

export function getCachedYear(year: number): YearData | undefined {
  const hit = cache.get(year);
  if (hit) touch(year); // reading counts as use, so it isn't evicted first
  return hit;
}

// Fetch (or return cached) one year's snapshot. Resolving this is what grants a
// year permission to be shown on the globe.
export async function loadYear(year: number): Promise<YearData> {
  const hit = cache.get(year);
  if (hit) {
    touch(year);
    return hit;
  }
  const loader = byYear.get(year);
  if (!loader) throw new Error(`No timeline snapshot for ${year}`);
  const mod = await loader();
  cache.set(year, mod.default);
  evictIfNeeded();
  return mod.default;
}

// Display order, worst-to-... actually best-to-worst-then-unknown — used for
// filter rows and tie-breaking the dominant group in a cluster.
export const GROUP_ORDER: VitalityGroup[] = ['healthy', 'watch', 'serious', 'gone', 'unknown'];

export const GROUP_LABEL: Record<VitalityGroup, string> = {
  healthy: 'Healthy',
  watch: 'Watch',
  serious: 'Serious',
  gone: 'Gone',
  unknown: 'Unknown',
};

export const LEVEL_LABEL: Record<YearRisk, string> = {
  alive: 'Alive',
  stable: 'Stable',
  recovering: 'Recovering',
  vulnerable: 'Vulnerable',
  at_risk: 'At risk',
  critical: 'Critical',
  lost: 'Lost',
  unknown: 'Unknown',
};

export function countByGroup(data: YearData): Record<VitalityGroup, number> {
  const c: Record<VitalityGroup, number> = { healthy: 0, watch: 0, serious: 0, gone: 0, unknown: 0 };
  for (const l of data.languages) c[l.vitality_group]++;
  return c;
}

// Globe palette, one hue per group — the primary visual signal, since this is
// the grouping the data itself defines (vitality_group), not the old 3-bucket
// mock Vitality scale used by the unrelated Tree view.
export const GROUP_COLOR: Record<VitalityGroup, string> = {
  healthy: '#35d49a',
  watch: '#e8c34a',
  serious: '#ef5b3f',
  gone: '#5d6878',
  unknown: '#8d7fce',
};

// Monotonic worse-direction rank of the 8-level scale (higher = worse off),
// used to tell whether a language's status improved or declined between two
// year snapshots. Distinct from LEVEL_URGENCY, which is a non-monotonic glow
// weight (e.g. `lost` glows small but is the worst outcome). `unknown` is -1 so
// transitions into / out of it never register as a direction.
export const LEVEL_SEVERITY: Record<YearRisk, number> = {
  alive: 0,
  stable: 1,
  recovering: 2,
  vulnerable: 3,
  at_risk: 4,
  critical: 5,
  lost: 6,
  unknown: -1,
};

// How a language's level has drifted between two snapshots. `worse`/`better`
// move along the severity scale; `shift` covers transitions into or out of
// `unknown` (the projection gaining or losing confidence), which have no
// direction but are still a real change worth showing. `steps` is the number of
// severity levels moved (0 for `shift`/`none`).
export type Trend = { dir: 'worse' | 'better' | 'shift' | 'none'; steps: number };

export function levelTrend(from: YearRisk, to: YearRisk): Trend {
  if (from === to) return { dir: 'none', steps: 0 };
  const a = LEVEL_SEVERITY[from];
  const b = LEVEL_SEVERITY[to];
  if (a < 0 || b < 0) return { dir: 'shift', steps: 0 };
  return { dir: b > a ? 'worse' : 'better', steps: Math.abs(b - a) };
}

// Within a group, severity still varies by level (e.g. watch's only level is
// "vulnerable", but "serious" spans at_risk → critical). This drives how big
// a glow/halo a point gets around its core dot — a second, independent visual
// channel from color, so two languages in the same group still read apart
// instead of looking identical just because they share a hue.
export const LEVEL_URGENCY: Record<YearRisk, number> = {
  alive: 1,
  stable: 1.1,
  recovering: 1.3,
  vulnerable: 1.5,
  at_risk: 1.9,
  critical: 2.5,
  lost: 1.15,
  unknown: 1,
};
