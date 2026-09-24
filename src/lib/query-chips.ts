import type { SearchFacets, SearchQuery } from "@/lib/types";

/**
 * How a description was read, as removable chips on the wall label. The
 * compiled query carries the same idea several times over (per museum, in
 * each museum's own field names, plus internal ids), so the chips show the
 * reading, not the plumbing: one keyword, one artist, one date range, then
 * the human facets (subject, style, type, culture, place, medium), each idea
 * once, at most six. Removing a chip clears every field behind it.
 */

const MAX_CHIPS = 6;

/** Facet fields worth showing, in the order they're shown, with their label. */
const SHOWN: Record<string, string> = {
  subjectName: "subject",
  styleName: "style",
  classificationName: "type",
  classification: "type",
  type: "type",
  objectName: "object",
  culture: "culture",
  nationality: "culture",
  geoLocation: "place",
  country: "place",
  medium: "medium",
  technique: "technique",
  material: "material",
};

/** Facet fields that are a date range in some museum's terms. */
const DATE_FIELDS = new Set([
  "dateFrom",
  "dateTo",
  "dateBegin",
  "dateEnd",
  "createdAfter",
  "createdBefore",
  "century",
  "datingPeriod",
]);

/** Never shown (internal ids, flags), but kept in the query. */
const HIDDEN = new Set(["departmentId", "departmentName", "tags"]);

type Target = { source: keyof SearchFacets; field: string };

export interface QueryChip {
  id: string;
  /** what kind of fact ("subject", "keyword") */
  label: string;
  value: string;
  /** the per-museum fields this chip stands for */
  targets?: Target[];
}

/** "Landscapes" / "landscape" / "Prints|Woodblock" → comparable words */
function norm(v: string): string {
  return v
    .toLowerCase()
    .replace(/[|,/]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");
}

const readable = (v: string) => v.replace(/\s*\|\s*/g, ", ");

function facetEntries(query: SearchQuery): (Target & { value: unknown })[] {
  const out: (Target & { value: unknown })[] = [];
  for (const source of Object.keys(query.facets ?? {}) as (keyof SearchFacets)[]) {
    const ns = query.facets?.[source] as Record<string, unknown> | undefined;
    if (!ns) continue;
    for (const [field, value] of Object.entries(ns)) out.push({ source, field, value });
  }
  return out;
}

export function queryChips(query: SearchQuery): QueryChip[] {
  const chips: QueryChip[] = [];
  const words = new Map<QueryChip, Set<string>>();
  /** the chip that already says this (its words are all on that chip) */
  const sayer = (value: string): QueryChip | undefined => {
    const w = norm(value).split(" ").filter(Boolean);
    if (w.length === 0) return undefined;
    for (const [chip, set] of words) if (w.every((x) => set.has(x))) return chip;
    return undefined;
  };
  const add = (chip: QueryChip) => {
    chips.push(chip);
    words.set(chip, new Set(norm(chip.value).split(" ").filter(Boolean)));
  };
  const facets = facetEntries(query);

  // keyword: the top-level q, and any museum's own q folded into it
  const keywordTargets = facets.filter((f) => f.field === "q" && typeof f.value === "string");
  const keyword = query.q ?? (keywordTargets[0]?.value as string | undefined);
  if (keyword) add({ id: "q", label: "keyword", value: keyword, targets: keywordTargets });
  if (query.artist && !sayer(query.artist)) add({ id: "artist", label: "artist", value: query.artist });

  // one dates chip, whether the range is top level or only in museum fields
  const dateTargets = facets.filter((f) => DATE_FIELDS.has(f.field));
  if (query.dateRange) {
    const [a, b] = query.dateRange;
    const value = a <= -3000 ? `before ${b}` : b >= 2100 ? `after ${a}` : `${a}–${b}`;
    chips.push({ id: "dateRange", label: "dates", value, targets: dateTargets });
  } else if (dateTargets.length) {
    const nums = dateTargets.map((f) => Number(f.value)).filter((n) => Number.isFinite(n));
    if (nums.length) {
      const lo = Math.min(...nums);
      const hi = Math.max(...nums);
      chips.push({ id: "dates", label: "dates", value: lo === hi ? String(lo) : `${lo}–${hi}`, targets: dateTargets });
    }
  }

  // the human facets, in SHOWN order, each idea once: a facet whose words are
  // already on a chip folds into that chip (removing the chip removes it too)
  const order = Object.keys(SHOWN);
  const shown = facets
    .filter((f) => f.field in SHOWN && !HIDDEN.has(f.field) && (typeof f.value === "string" || typeof f.value === "number"))
    .sort((x, y) => order.indexOf(x.field) - order.indexOf(y.field));
  const overflow: typeof shown = [];
  for (const f of shown) {
    const value = readable(String(f.value));
    const owner = sayer(value);
    if (owner) {
      (owner.targets ??= []).push({ source: f.source, field: f.field });
    } else if (chips.length < MAX_CHIPS) {
      add({ id: `${f.source}.${f.field}`, label: SHOWN[f.field], value, targets: [{ source: f.source, field: f.field }] });
    } else {
      overflow.push(f);
    }
  }
  // past the cap, anything a chip already says still goes with that chip
  for (const f of overflow) {
    const owner = sayer(readable(String(f.value)));
    if (owner) (owner.targets ??= []).push({ source: f.source, field: f.field });
  }
  return chips;
}

/** Remove one chip's field (and, for facets, every museum field behind it). */
export function removeQueryField(query: SearchQuery, chip: QueryChip): SearchQuery {
  const next: SearchQuery = structuredClone(query);
  if (chip.id === "q") delete next.q;
  else if (chip.id === "artist") delete next.artist;
  else if (chip.id === "dateRange") delete next.dateRange;
  for (const t of chip.targets ?? []) {
    const ns = next.facets?.[t.source] as Record<string, unknown> | undefined;
    if (ns) delete ns[t.field];
  }
  for (const source of Object.keys(next.facets ?? {}) as (keyof SearchFacets)[]) {
    const ns = next.facets?.[source] as Record<string, unknown> | undefined;
    if (ns && Object.keys(ns).length === 0) delete next.facets?.[source];
  }
  if (next.facets && Object.keys(next.facets).length === 0) delete next.facets;
  return next;
}
