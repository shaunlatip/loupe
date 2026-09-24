import type { SearchFacets, SearchQuery } from "@/lib/types";

/**
 * How a description was read, as removable chips on the wall label: each
 * facet of the compiled query is one chip, and removing it searches again
 * without that field.
 */

const FIELD_LABELS: Record<string, string> = {
  styleName: "style",
  subjectName: "subject",
  classificationName: "type",
  departmentName: "department",
  departmentId: "department",
  dateFrom: "from",
  dateTo: "to",
  dateBegin: "from",
  dateEnd: "to",
  createdAfter: "after",
  createdBefore: "before",
  geoLocation: "place",
  medium: "medium",
  technique: "technique",
  type: "type",
  culture: "culture",
  material: "material",
  datingPeriod: "century",
  objectName: "object",
  nationality: "nationality",
  classification: "type",
  country: "country",
  century: "century",
  q: "keyword",
  tags: "tags",
};

export interface QueryChip {
  id: string;
  /** what kind of fact ("subject", "keyword") */
  label: string;
  value: string;
}

export function queryChips(query: SearchQuery): QueryChip[] {
  const chips: QueryChip[] = [];
  if (query.q) chips.push({ id: "q", label: "keyword", value: query.q });
  if (query.artist) chips.push({ id: "artist", label: "artist", value: query.artist });
  if (query.dateRange) {
    const [a, b] = query.dateRange;
    const value = a <= -3000 ? `before ${b}` : b >= 2100 ? `after ${a}` : `${a}–${b}`;
    chips.push({ id: "dateRange", label: "dates", value });
  }
  const seen = new Set<string>();
  for (const source of Object.keys(query.facets ?? {}) as (keyof SearchFacets)[]) {
    const ns = query.facets?.[source] as Record<string, unknown> | undefined;
    if (!ns) continue;
    for (const [field, value] of Object.entries(ns)) {
      if (value === undefined || field === "tags" || typeof value === "boolean") continue;
      // the same idea often recurs per museum ("storm" for Met and CMA):
      // show it once, remove it everywhere
      const key = `${FIELD_LABELS[field] ?? field}:${String(value).toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      chips.push({ id: `${source}.${field}`, label: FIELD_LABELS[field] ?? field, value: String(value) });
    }
  }
  return chips;
}

/** Remove one chip's field (and, for facets, the same value in every museum). */
export function removeQueryField(query: SearchQuery, chip: QueryChip): SearchQuery {
  const next: SearchQuery = structuredClone(query);
  if (chip.id === "q") delete next.q;
  else if (chip.id === "artist") delete next.artist;
  else if (chip.id === "dateRange") delete next.dateRange;
  else {
    for (const source of Object.keys(next.facets ?? {}) as (keyof SearchFacets)[]) {
      const ns = next.facets?.[source] as Record<string, unknown> | undefined;
      if (!ns) continue;
      for (const [field, value] of Object.entries(ns)) {
        if ((FIELD_LABELS[field] ?? field) === chip.label && String(value) === chip.value) {
          delete ns[field];
        }
      }
      if (Object.keys(ns).length === 0) delete next.facets?.[source];
    }
    if (next.facets && Object.keys(next.facets).length === 0) delete next.facets;
  }
  return next;
}
