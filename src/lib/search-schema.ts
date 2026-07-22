import { z } from "zod";
import type { SearchQuery } from "@/lib/types";

/**
 * Strict zod mirror of SearchQuery/SearchFacets (types.ts) — validates JSON
 * bodies on POST /api/search and the LLM output of /api/interpret. Unknown
 * keys are rejected so a hallucinated facet field fails loudly instead of
 * silently doing nothing. Keep in lockstep with SearchFacets.
 */

const aicFacetsSchema = z
  .object({
    styleName: z.string().optional(),
    subjectName: z.string().optional(),
    classificationName: z.string().optional(),
    departmentName: z.string().optional(),
    dateFrom: z.number().int().optional(),
    dateTo: z.number().int().optional(),
  })
  .strict();

const cmaFacetsSchema = z
  .object({
    type: z.string().optional(),
    technique: z.string().optional(),
    department: z.string().optional(),
    culture: z.string().optional(),
    createdAfter: z.number().int().optional(),
    createdBefore: z.number().int().optional(),
    q: z.string().optional(),
  })
  .strict();

const metFacetsSchema = z
  .object({
    departmentId: z.number().int().optional(),
    medium: z.string().optional(),
    geoLocation: z.string().optional(),
    dateBegin: z.number().int().optional(),
    dateEnd: z.number().int().optional(),
    q: z.string().optional(),
    tags: z.boolean().optional(),
  })
  .strict();

const rijksFacetsSchema = z
  .object({
    type: z.string().optional(),
    material: z.string().optional(),
    technique: z.string().optional(),
    datingPeriod: z.number().int().optional(),
    q: z.string().optional(),
  })
  .strict();

const smkFacetsSchema = z
  .object({
    objectName: z.string().optional(),
    nationality: z.string().optional(),
    technique: z.string().optional(),
    q: z.string().optional(),
  })
  .strict();

const miaFacetsSchema = z
  .object({
    classification: z.string().optional(),
    department: z.string().optional(),
    country: z.string().optional(),
    q: z.string().optional(),
  })
  .strict();

const harvardFacetsSchema = z
  .object({
    classification: z.string().optional(),
    century: z.string().optional(),
    culture: z.string().optional(),
    medium: z.string().optional(),
    q: z.string().optional(),
  })
  .strict();

export const searchFacetsSchema = z
  .object({
    aic: aicFacetsSchema.optional(),
    cma: cmaFacetsSchema.optional(),
    met: metFacetsSchema.optional(),
    rijks: rijksFacetsSchema.optional(),
    smk: smkFacetsSchema.optional(),
    mia: miaFacetsSchema.optional(),
    harvard: harvardFacetsSchema.optional(),
  })
  .strict();

export const searchQuerySchema = z
  .object({
    q: z.string().optional(),
    artist: z.string().optional(),
    dateRange: z.tuple([z.number().int(), z.number().int()]).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    facets: searchFacetsSchema.optional(),
  })
  .strict();

// compile-time check that the schema output stays assignable to SearchQuery
type SchemaQuery = z.infer<typeof searchQuerySchema>;
const _assertAssignable: SearchQuery = {} as SchemaQuery;
void _assertAssignable;
