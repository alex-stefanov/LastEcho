// ---------------------------------------------------------------------------
// LastEcho — linguistic family taxonomy (scaffold).
//
// A reference classification for the families used by mockLanguages. Each
// family lists its major branches/groups; the tree page hangs the mock
// languages off these so the catalogue reads as a real genealogy rather than a
// flat list. Replace with a Glottolog-backed tree once the pipeline exists —
// the FamilyInfo contract (name → groups) stays the same.
// ---------------------------------------------------------------------------

export interface FamilyInfo {
  name: string; // must match LangRecord.family
  blurb: string;
  groups: string[]; // major branches / subgroups, most prominent first
}

export const FAMILY_INFO: FamilyInfo[] = [
  {
    name: 'Trans–New Guinea',
    blurb: 'The largest family of the New Guinea highlands — and one of the densest endangerment hotspots on Earth.',
    groups: ['Finisterre–Huon', 'Madang', 'Ok–Awyu', 'Chimbu–Wahgi', 'Angan'],
  },
  {
    name: 'Arawakan',
    blurb: 'Once spread across the Amazon basin and the Caribbean; many branches now survive in only a handful of villages.',
    groups: ['Northern Arawakan', 'Southern Arawakan', 'Caribbean Arawakan'],
  },
  {
    name: 'Pama–Nyungan',
    blurb: 'Covers most of the Australian continent; the great majority of its languages are no longer learned by children.',
    groups: ['Pama–Maric', 'Yolŋu', 'Ngumpin–Yapa', 'Karnic', 'Arandic'],
  },
  {
    name: 'Northeast Caucasian',
    blurb: 'A tightly packed mountain family famous for its sprawling consonant systems and many small speech communities.',
    groups: ['Avar–Andic', 'Lezgic', 'Nakh', 'Tsezic', 'Dargic'],
  },
  {
    name: 'Salishan',
    blurb: 'Indigenous to the Pacific Northwest; intensive documentation races against a dwindling number of elder speakers.',
    groups: ['Coast Salish', 'Interior Salish', 'Tsamosan', 'Bella Coola'],
  },
  {
    name: 'Oto–Manguean',
    blurb: 'A tonal family of Mesoamerica with deep internal diversity, centred on the highlands of Oaxaca.',
    groups: ['Zapotecan', 'Mixtecan', 'Otomian', 'Popolocan', 'Chinantecan'],
  },
  {
    name: 'Niger–Congo',
    blurb: 'By some counts the largest family in the world; endangerment concentrates in its smaller, non-Bantu branches.',
    groups: ['Bantu', 'Kwa', 'Gur', 'Atlantic', 'Mande'],
  },
  {
    name: 'Sino–Tibetan',
    blurb: 'Spans from Mandarin to hundreds of small Himalayan tongues, many spoken in a single valley.',
    groups: ['Sinitic', 'Bodish', 'Lolo–Burmese', 'Karenic', 'Kuki–Chin'],
  },
  {
    name: 'Tungusic',
    blurb: 'A Siberian and Manchurian family under intense pressure from Russian and Mandarin alike.',
    groups: ['Northern Tungusic', 'Southern Tungusic'],
  },
  {
    name: 'Austroasiatic',
    blurb: 'Scattered across mainland Southeast Asia and eastern India, often as enclaves within larger language areas.',
    groups: ['Mon–Khmer', 'Munda', 'Bahnaric', 'Khasian', 'Aslian'],
  },
  {
    name: 'Austronesian',
    blurb: 'One of the most far-flung families, reaching from Taiwan to the Pacific; its outliers are especially fragile.',
    groups: ['Oceanic', 'Malayo–Polynesian', 'Philippine', 'Formosan'],
  },
  {
    name: 'Indo–European',
    blurb: 'Globally dominant overall, yet home to small minority languages quietly slipping out of daily use.',
    groups: ['Indo–Iranian', 'Slavic', 'Germanic', 'Romance', 'Celtic'],
  },
  {
    name: 'Uralic',
    blurb: 'Stretches from Northern Europe across Siberia; its smaller members are among Russia’s most endangered tongues.',
    groups: ['Finnic', 'Samoyedic', 'Ugric', 'Permic', 'Mordvinic'],
  },
];

export const FAMILY_BY_NAME = new Map(FAMILY_INFO.map((f) => [f.name, f]));

// Languages whose family has no internal branching (or is unknown) live here.
export const ISOLATE_FAMILY = 'Isolate';

// ---------------------------------------------------------------------------
// Broader categories — the macro-areas the families roll up into. These are
// geographic groupings (not proven super-families), used to give the tree graph
// a top tier so families branch upward into something broader.
// ---------------------------------------------------------------------------

export interface MacroCategory {
  name: string;
  blurb: string;
  families: string[]; // family names, must match FAMILY_INFO / LangRecord.family
}

export const MACRO_CATEGORIES: MacroCategory[] = [
  {
    name: 'Eurasia',
    blurb: 'The great landmass families, from Atlantic Europe to the Pacific coast of Asia.',
    families: ['Indo–European', 'Uralic', 'Sino–Tibetan', 'Austroasiatic', 'Northeast Caucasian', 'Tungusic'],
  },
  {
    name: 'Sahul',
    blurb: 'New Guinea and Australia — the densest concentration of language diversity on Earth.',
    families: ['Trans–New Guinea', 'Pama–Nyungan'],
  },
  {
    name: 'Americas',
    blurb: 'Indigenous families of the New World, from the Amazon to the Pacific Northwest.',
    families: ['Arawakan', 'Oto–Manguean', 'Salishan'],
  },
  {
    name: 'Africa',
    blurb: 'Sub-Saharan families, anchored by the vast Niger–Congo expansion.',
    families: ['Niger–Congo'],
  },
  {
    name: 'Austronesia',
    blurb: 'The seafaring family that spread from Taiwan across the Indian and Pacific oceans.',
    families: ['Austronesian'],
  },
];

// The macro-category that holds language isolates (each its own family).
export const ISOLATE_CATEGORY = 'Isolates';
