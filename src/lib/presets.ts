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
      },
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
      facets: {
        aic: { subjectName: "Night" },
        met: { q: "Night", tags: true },
      },
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
