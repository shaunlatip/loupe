import type { SearchQuery } from "@/lib/types";

/**
 * Browse taxonomy — non-LLM categories that map to each museum API's real
 * facet/filter fields (AIC style/subject/classification vocabulary, CMA
 * type/technique/culture, Met department/medium/geo, Rijks type/material/
 * century). One SearchQuery per category fans out to every adapter; each
 * adapter reads only its own `facets` namespace, with top-level q/dateRange
 * as a fallback for sources that can't facet the category. Data-only —
 * execution lives in the search route + adapters.
 */

export interface Category {
  id: string;
  label: string;
  group: "Movements" | "Periods" | "Cultures" | "Subjects" | "Media";
  query: SearchQuery;
}

export const CATEGORIES: Category[] = [
  // — Movements —
  {
    id: "impressionism",
    label: "Impressionism",
    group: "Movements",
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
    id: "post-impressionism",
    label: "Post-impressionism",
    group: "Movements",
    query: {
      facets: {
        aic: { styleName: "Post-Impressionism" },
        met: { dateBegin: 1885, dateEnd: 1910, q: "post-impressionism" },
      },
    },
  },
  {
    id: "dutch-golden-age",
    label: "Dutch Golden Age",
    group: "Movements",
    query: {
      facets: {
        rijks: { type: "painting", datingPeriod: 17 },
        met: {
          geoLocation: "Netherlands",
          dateBegin: 1600,
          dateEnd: 1700,
          medium: "Paintings",
        },
        cma: {
          culture: "Netherlands",
          type: "Painting",
          createdAfter: 1600,
          createdBefore: 1700,
        },
        aic: { dateFrom: 1600, dateTo: 1700 },
        // SMK holds Dutch Golden Age painting — nationality is Danish-valued
        smk: { nationality: "hollandsk", objectName: "maleri" },
        mia: { classification: "Paintings", country: "Netherlands" },
      },
      dateRange: [1600, 1700],
      q: "dutch",
    },
  },
  {
    id: "baroque",
    label: "Baroque",
    group: "Movements",
    query: {
      facets: {
        aic: { styleName: "Baroque" },
        met: { dateBegin: 1600, dateEnd: 1750 },
        rijks: { datingPeriod: 17 },
      },
    },
  },
  {
    id: "romanticism",
    label: "Romanticism",
    group: "Movements",
    query: {
      facets: { aic: { styleName: "Romanticism" } },
    },
  },
  {
    id: "realism",
    label: "Realism",
    group: "Movements",
    query: {
      facets: { aic: { styleName: "Realism" } },
    },
  },
  {
    id: "ukiyo-e",
    label: "Ukiyo-e",
    group: "Movements",
    query: {
      facets: {
        met: { departmentId: 6, geoLocation: "Japan", medium: "Prints|Woodblock" },
        cma: { culture: "Japan", type: "Print" },
        rijks: { type: "print", technique: "woodcut" },
        aic: { classificationName: "woodblock print" },
      },
    },
  },

  // — Periods —
  {
    id: "renaissance",
    label: "Renaissance",
    group: "Periods",
    query: {
      facets: {
        met: { dateBegin: 1400, dateEnd: 1600 },
        rijks: { datingPeriod: 16 },
        cma: { createdAfter: 1400, createdBefore: 1600 },
      },
    },
  },
  {
    id: "nineteenth-century",
    label: "Nineteenth century",
    group: "Periods",
    query: {
      facets: {
        met: { dateBegin: 1800, dateEnd: 1900 },
        cma: { createdAfter: 1800, createdBefore: 1900 },
        rijks: { datingPeriod: 19 },
        aic: { dateFrom: 1800, dateTo: 1900 },
      },
    },
  },

  // — Cultures —
  {
    id: "japanese-art",
    label: "Japanese art",
    group: "Cultures",
    query: {
      facets: {
        met: { geoLocation: "Japan" },
        cma: { culture: "Japan" },
      },
    },
  },
  {
    id: "chinese-art",
    label: "Chinese art",
    group: "Cultures",
    query: {
      facets: {
        met: { geoLocation: "China" },
        cma: { culture: "China" },
      },
    },
  },
  {
    id: "french-art",
    label: "French art",
    group: "Cultures",
    query: {
      facets: {
        met: { geoLocation: "France" },
        cma: { culture: "France" },
      },
    },
  },

  // — Subjects —
  {
    id: "landscape",
    label: "Landscape",
    group: "Subjects",
    query: {
      facets: {
        aic: { subjectName: "Landscapes" },
        met: { q: "Landscapes", tags: true },
        rijks: { q: "landscape" },
      },
      // CMA has no subject facet — top-level q serves it (a text hit for AIC/Met too)
      q: "landscape",
    },
  },
  {
    id: "seascape",
    label: "Seascape",
    group: "Subjects",
    query: {
      facets: {
        aic: { subjectName: "Seascapes" },
        met: { q: "Ships", tags: true },
        rijks: { q: "zee" },
      },
    },
  },
  {
    id: "still-life",
    label: "Still life",
    group: "Subjects",
    query: {
      facets: {
        aic: { subjectName: "Still life" },
        met: { q: "Still Life", tags: true },
        rijks: { type: "painting", q: "stilleven" },
      },
      // CMA has no subject facet — top-level q serves it
      q: "still life",
    },
  },
  {
    id: "portrait",
    label: "Portrait",
    group: "Subjects",
    query: {
      facets: {
        aic: { subjectName: "Portraits" },
        met: { q: "Portraits", tags: true },
        rijks: { type: "portrait" },
      },
    },
  },
  {
    id: "nocturne-night",
    label: "Nocturne / night",
    group: "Subjects",
    query: {
      // AIC's "night" subject terms carry ~0 public-domain works (verified:
      // TM-12702 / TM-13355 / TM-8868 all empty), so a subject facet there
      // intersects to nothing. Full-text "nocturne" is what actually returns
      // the Whistler nocturnes at AIC — and serves Met + CMA keyword search.
      q: "nocturne",
    },
  },

  // — Media —
  {
    id: "oil-painting",
    label: "Oil painting",
    group: "Media",
    query: {
      facets: {
        cma: { technique: "oil on canvas" },
        met: { medium: "Oil on canvas" },
        rijks: { material: "oil paint" },
        aic: { classificationName: "painting" },
        smk: { objectName: "maleri" },
        mia: { classification: "Paintings" },
        harvard: { classification: "Paintings", medium: "Oil" },
      },
    },
  },
  {
    id: "prints",
    label: "Prints",
    group: "Media",
    query: {
      facets: {
        cma: { type: "Print" },
        met: { departmentId: 9, medium: "Prints" },
        rijks: { type: "print" },
        aic: { classificationName: "print" },
        mia: { classification: "Prints" },
        harvard: { classification: "Prints" },
      },
    },
  },
  {
    id: "watercolor",
    label: "Watercolor",
    group: "Media",
    query: {
      facets: {
        cma: { technique: "watercolor" },
        met: { medium: "Watercolors" },
        rijks: { material: "watercolor" },
      },
    },
  },
];

export function getCategory(id: string): Category | undefined {
  return CATEGORIES.find((c) => c.id === id);
}

/**
 * Intersection of several categories: merge their SearchQueries into one so a
 * single fanout returns works matching ALL of them ("impressionist landscape"
 * = Impressionism ∩ Landscape). AIC is the true intersection engine — it ANDs
 * every facet term it's handed (styleName + subjectName resolve to two term
 * filters that compose). For the other sources, distinct facet fields also AND
 * within the adapter; a same-field conflict takes the last selection, and
 * free-text (`q` top-level and the cma/met per-source keyword) concatenates so
 * both terms bias the text hit rather than one clobbering the other.
 *
 * A single id returns that category's query verbatim, so this is the one path
 * for any taxonomy selection (1 or N) — identical to the old single-category
 * fetch when N=1.
 */
export function mergeCategoryQueries(ids: string[]): SearchQuery {
  const facets: Record<string, Record<string, unknown>> = {};
  const topQ: string[] = [];
  const out: SearchQuery = {};

  for (const id of ids) {
    const cat = getCategory(id);
    if (!cat) continue;
    const q = cat.query;
    if (q.q) topQ.push(q.q);
    if (q.artist) out.artist = q.artist;
    if (q.dateRange) out.dateRange = q.dateRange;
    if (q.limit) out.limit = q.limit;
    for (const [src, ns] of Object.entries(q.facets ?? {})) {
      if (!ns) continue;
      const target = (facets[src] ??= {});
      for (const [field, value] of Object.entries(ns)) {
        if (value === undefined) continue;
        if (field === "q" && typeof value === "string" && typeof target.q === "string") {
          target.q = `${target.q} ${value}`.trim();
        } else {
          target[field] = value;
        }
      }
    }
  }

  if (topQ.length) out.q = topQ.join(" ");
  if (Object.keys(facets).length) out.facets = facets as SearchQuery["facets"];
  return out;
}
