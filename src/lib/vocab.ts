import type { SearchQuery } from "@/lib/types";

/**
 * Shared vibe vocabulary — the art-historical knowledge that translates vague
 * designer language ("misty", "moody", "dreamy abstract") into real museum
 * metadata queries. Data-only, one place: the curator prompt renders its
 * vocabulary section from this table, /api/interpret uses it as the fast
 * path, and its entries double as few-shot examples for the LLM path.
 *
 * Facet recipes follow the same per-source patterns as CATEGORIES in
 * presets.ts (AIC style/subject/classification names resolved at runtime;
 * Met departmentId/medium/geo/tags; CMA type/technique/culture/q).
 */

export interface VocabEntry {
  id: string;
  label: string;
  aliases: string[];
  note?: string;
  query: SearchQuery;
}

export const VOCAB: VocabEntry[] = [
  {
    id: "tonalism",
    label: "Tonalism",
    aliases: ["tonalism", "tonalist", "misty field", "misty fields", "hazy", "haze"],
    note: "the misty-field school — Twachtman, Cazin; soft low-contrast grounds",
    query: {
      artist: "Twachtman",
      facets: { aic: { dateFrom: 1875, dateTo: 1925 } },
    },
  },
  {
    id: "nocturne",
    label: "Nocturne",
    aliases: [
      "nocturne",
      "nocturnes",
      "dark",
      "moody",
      "night",
      "midnight",
      "moonlight",
      "moonlit",
      "whistler",
    ],
    note: "Whistler's dark register — deep grounds for light UI",
    // AIC's "night" subject vocabulary is empty of PD works — full-text
    // "nocturne" is the query that actually hits the Whistlers everywhere.
    query: { q: "nocturne" },
  },
  {
    id: "impressionist-atmosphere",
    label: "Impressionist atmosphere",
    aliases: ["mist", "misty", "fog", "foggy", "atmospheric", "atmosphere", "boudin"],
    note: "Monet mist / fog / ice-floe series, Boudin sky studies",
    query: {
      q: "mist",
      facets: { aic: { styleName: "Impressionism" } },
    },
  },
  {
    id: "water-lilies",
    label: "Water lilies",
    aliases: [
      "water lilies",
      "waterlilies",
      "water lily",
      "nympheas",
      "nymphéas",
      "lily pond",
      "dreamy",
    ],
    note: "late Monet — the dreamy near-abstract register",
    query: { q: "water lilies", artist: "Monet" },
  },
  {
    id: "dutch-still-life",
    label: "Dutch still life",
    aliases: [
      "vanitas",
      "dutch still life",
      "dark ground",
      "banquet piece",
      "heda",
      "claesz",
      "kalf",
      "de heem",
    ],
    note: "Golden Age vanitas with dark grounds — Heda, Claesz, Kalf, de Heem",
    query: {
      q: "still life",
      dateRange: [1600, 1700],
      facets: {
        aic: { subjectName: "Still life" },
        met: { q: "Still Life", tags: true, dateBegin: 1600, dateEnd: 1700 },
        cma: { createdAfter: 1600, createdBefore: 1700 },
      },
    },
  },
  {
    id: "sky-clouds",
    label: "Sky and cloud studies",
    aliases: ["sky", "skies", "cloud", "clouds", "cloud study", "cloudscape"],
    note: "Constable-style cloud studies, open-sky grounds",
    query: {
      q: "clouds",
      facets: { met: { q: "Clouds", tags: true } },
    },
  },
  {
    id: "marine-calm",
    label: "Marine and seascape",
    aliases: [
      "marine",
      "seascape",
      "seascapes",
      "sea",
      "ocean",
      "calm sea",
      "harbor",
      "harbour",
      "boats",
      "ships",
    ],
    note: "calm horizons — large flat water and sky areas",
    query: {
      facets: {
        aic: { subjectName: "Seascapes" },
        met: { q: "Ships", tags: true },
        cma: { q: "seascape" },
      },
    },
  },
  {
    id: "color-field",
    label: "Color-field abstraction",
    aliases: ["color field", "colour field", "color-field", "abstract", "abstraction"],
    note: "CC0 modern abstraction is scarce — expect adjacent works",
    query: {
      q: "abstraction",
      facets: { cma: { type: "Painting", createdAfter: 1900 } },
    },
  },
  {
    id: "calm-serene",
    label: "Calm and serene",
    aliases: ["calm", "quiet", "serene", "serenity", "tranquil", "peaceful"],
    note: "proxied through calm landscape subjects",
    query: {
      facets: {
        aic: { subjectName: "Landscapes" },
        met: { q: "Landscapes", tags: true },
        cma: { q: "calm landscape" },
      },
    },
  },
  {
    id: "golden-light",
    label: "Golden and warm light",
    aliases: [
      "golden",
      "golden hour",
      "warm light",
      "sunset",
      "sunsets",
      "dusk",
      "amber",
      "glow",
    ],
    note: "sunset and dusk palettes — warm grounds",
    query: {
      q: "sunset",
      facets: { met: { q: "Sunsets", tags: true } },
    },
  },
  {
    id: "winter-snow",
    label: "Winter and snow",
    aliases: ["winter", "snow", "snowy", "frost", "ice", "frozen"],
    note: "white fields and cold light — near-blank grounds",
    query: {
      q: "snow",
      facets: { met: { q: "Snow", tags: true } },
    },
  },
  {
    id: "botanical",
    label: "Botanical and flowers",
    aliases: ["botanical", "flowers", "floral", "blossom", "blossoms", "garden", "bouquet"],
    note: "floral still lifes and botanical studies",
    query: {
      q: "flowers",
      facets: { met: { q: "Flowers", tags: true } },
    },
  },
  {
    id: "pastoral",
    label: "Pastoral",
    aliases: ["pastoral", "meadow", "meadows", "countryside", "rural", "grazing"],
    note: "fields, cattle, quiet countryside",
    query: {
      facets: {
        aic: { subjectName: "Landscapes" },
        met: { q: "pastoral" },
        cma: { q: "pastoral" },
      },
    },
  },
  {
    id: "night-city",
    label: "Night city",
    aliases: [
      "night city",
      "city at night",
      "city lights",
      "urban night",
      "street at night",
    ],
    note: "urban nocturnes — lit windows on dark grounds",
    query: { q: "city at night" },
  },
  {
    id: "impressionism",
    label: "Impressionism",
    aliases: ["impressionism", "impressionist", "plein air", "plein-air"],
    note: "broken color, atmospheric light",
    query: {
      facets: {
        aic: { styleName: "Impressionism" },
        met: { departmentId: 11, dateBegin: 1860, dateEnd: 1900, q: "impressionism" },
        cma: {
          department: "Modern European Painting and Sculpture",
          culture: "France",
          createdAfter: 1860,
        },
      },
    },
  },
  {
    id: "ukiyo-e",
    label: "Ukiyo-e",
    aliases: [
      "ukiyo-e",
      "ukiyoe",
      "ukiyo",
      "woodblock",
      "japanese print",
      "japanese prints",
      "hokusai",
      "hiroshige",
    ],
    note: "flat color planes — Hokusai, Hiroshige",
    query: {
      facets: {
        met: { departmentId: 6, geoLocation: "Japan", medium: "Prints|Woodblock" },
        cma: { culture: "Japan", type: "Print" },
        aic: { classificationName: "woodblock print" },
      },
    },
  },
  {
    id: "storm",
    label: "Storm and rough weather",
    aliases: ["storm", "stormy", "tempest", "rough sea", "squall"],
    note: "turbulent skies and seas — dramatic grounds",
    query: { q: "storm" },
  },
];

/** lowercase + strip diacritics, for alias matching */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Match a free-text phrase against the vocabulary: normalized whole-word /
 * whole-phrase containment over each entry's label + aliases. "misty
 * atmospheric morning" hits Impressionist atmosphere; "sea" does not match
 * inside "seascape" (word boundaries), but the "seascape" alias does.
 */
export function matchVocab(q: string): VocabEntry[] {
  const text = normalize(q);
  return VOCAB.filter((entry) =>
    [entry.label, ...entry.aliases].some((alias) => {
      const a = normalize(alias);
      if (!a) return false;
      return new RegExp(`(^|[^a-z0-9])${escapeRegExp(a)}([^a-z0-9]|$)`).test(text);
    }),
  );
}
