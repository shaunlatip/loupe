import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";
import { z } from "zod";
import { CATEGORIES } from "@/lib/presets";
import { searchFacetsSchema, searchQuerySchema } from "@/lib/search-schema";
import { matchVocab, vocabCoversPhrase, VOCAB, type VocabEntry } from "@/lib/vocab";
import {
  LOCAL_INTERPRET_MODEL,
  curatorEngine,
  hostedConfigured,
  hostedModel,
} from "@/lib/ai/models";
import { clientKey, rateLimited } from "@/lib/rate-limit";
import type { SearchQuery } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// soft per-visitor ceiling on model compiles (vocab hits are free and uncounted)
const CALLS_PER_WINDOW = 40;
const WINDOW_MS = 10 * 60 * 1000;

/**
 * POST /api/interpret { q } → { query, explanation, method } — turns a
 * description into one concrete SearchQuery (the one input's "describe"
 * route). Fast path: the shared vocabulary, but only when it accounts for the
 * whole phrase. Otherwise one structured-output model call (a small Claude
 * locally, the hosted model on Vercel). Any failure degrades to
 * method:"fallback" (search the phrase as typed); this route never 500s.
 */

interface InterpretResult {
  query: SearchQuery;
  explanation: string;
  method: "vocab" | "claude" | "llm" | "fallback";
}

/** Shallow-merge matched entries' queries; first match wins on conflicts. */
function mergeVocabQueries(entries: VocabEntry[]): SearchQuery {
  const out: SearchQuery = {};
  for (const entry of entries) {
    const q = entry.query;
    if (out.q === undefined && q.q !== undefined) out.q = q.q;
    if (out.artist === undefined && q.artist !== undefined) out.artist = q.artist;
    if (out.dateRange === undefined && q.dateRange !== undefined) out.dateRange = q.dateRange;
    if (q.facets) {
      out.facets ??= {};
      for (const source of ["aic", "cma", "met", "rijks"] as const) {
        const add = q.facets[source];
        if (!add) continue;
        out.facets[source] = { ...add, ...out.facets[source] };
      }
    }
  }
  return out;
}

/** What the model fills in: SearchQuery with years instead of a tuple (a
 *  2-tuple is awkward for structured-output JSON schemas). */
const compileSchema = z.object({
  q: z.string().optional().describe("free-text keyword sent to every museum"),
  artist: z.string().optional(),
  yearFrom: z.number().int().optional(),
  yearTo: z.number().int().optional(),
  facets: searchFacetsSchema.optional(),
  explanation: z
    .string()
    .describe("one short plain sentence naming the art-historical idea; no em dashes"),
});

function buildInstructions(): string {
  const vocabTable = VOCAB.map(
    (v) => `- ${v.label}${v.note ? ` (${v.note})` : ""}: ${JSON.stringify(v.query)}`,
  ).join("\n");
  const categoryTable = CATEGORIES.map((c) => `- ${c.label}: ${JSON.stringify(c.query)}`).join("\n");

  return `You turn a visitor's description into ONE search over museum open-access APIs (Art Institute of Chicago "aic", The Met "met", Cleveland "cma", Statens Museum for Kunst "smk", Minneapolis "mia"). Keep every idea in the phrase that a museum record could match: subjects, places, periods, techniques, named artists.

Fields (all optional; omit what you don't need; never invent others): q, artist, yearFrom, yearTo, facets.
- facets.aic: styleName, subjectName, classificationName, departmentName, dateFrom, dateTo. Names are resolved against AIC's real vocabulary (styles: Impressionism, Post-Impressionism, Baroque, Romanticism, Realism; subjects: Landscapes, Seascapes, Still life, Portraits; classifications: painting, print, woodblock print); unresolvable names are dropped. AIC's night subjects are empty: for nocturnes use q "nocturne".
- facets.met: departmentId, medium, geoLocation, dateBegin, dateEnd, q, tags (tags:true makes met.q match The Met's subject tags).
- facets.cma: type, technique, department, culture, createdAfter, createdBefore, q (free text, substring-matched).
- facets.smk: objectName, nationality, technique, q (Danish values, e.g. objectName "maleri").
- facets.mia: classification, department, country, q.
- A top-level q is ANDed with AIC subject filters and can intersect to nothing: when a keyword only helps one museum, put it in that museum's q.
- Prefer 2-4 concrete fields over many speculative ones.

Known vocabulary (concept: query):
${vocabTable}

Category recipes:
${categoryTable}

Examples:
"misty atmospheric morning" → {"q":"mist","facets":{"aic":{"styleName":"Impressionism"}},"explanation":"Impressionist mist and fog studies, Monet and Boudin territory."}
"a lonely lighthouse on a stormy coast" → {"q":"lighthouse","facets":{"aic":{"subjectName":"Seascapes"},"met":{"q":"storm","tags":true}},"explanation":"Lighthouses and storm-lit coasts from the marine painters."}
"quiet dutch kitchen scene" → {"q":"interior","yearFrom":1600,"yearTo":1700,"facets":{"met":{"geoLocation":"Netherlands"},"cma":{"culture":"Netherlands"}},"explanation":"Dutch Golden Age domestic interiors."}`;
}

async function compile(q: string, engine: ReturnType<typeof curatorEngine>): Promise<InterpretResult> {
  const local = engine === "claude";
  const { model, providerOptions } = local
    ? {
        model: claudeCode(LOCAL_INTERPRET_MODEL, {
          systemPrompt: buildInstructions(),
          tools: [],
          settingSources: [],
          maxTurns: 1,
        }),
        providerOptions: undefined,
      }
    : hostedModel("interpret", engine);
  const { output } = await generateText({
    model,
    ...(local ? {} : { instructions: buildInstructions() }),
    prompt: q,
    output: Output.object({ schema: compileSchema }),
    providerOptions: providerOptions as never,
    abortSignal: AbortSignal.timeout(40_000),
  });
  const { explanation, yearFrom, yearTo, ...rest } = output;
  const query = searchQuerySchema.parse({
    ...rest,
    ...(yearFrom !== undefined || yearTo !== undefined
      ? { dateRange: [yearFrom ?? -3000, yearTo ?? 2100] }
      : {}),
  });
  return {
    query,
    explanation: explanation?.trim() || "Read by the model.",
    method: local ? "claude" : "llm",
  };
}

export async function POST(req: NextRequest) {
  let q = "";
  try {
    const body = (await req.json()) as { q?: unknown };
    if (typeof body.q === "string") q = body.q.trim();
  } catch {
    /* handled below */
  }
  if (!q) return NextResponse.json({ error: "q required" }, { status: 400 });

  // Fast path: the shared vocabulary, when it covers the whole phrase.
  const matches = matchVocab(q);
  if (vocabCoversPhrase(q, matches)) {
    return NextResponse.json({
      query: mergeVocabQueries(matches),
      explanation: `Read as ${matches.map((m) => m.label).join(", ")}.`,
      method: "vocab",
    } satisfies InterpretResult);
  }

  const fallback: InterpretResult = {
    query: { q },
    explanation: "Searched as typed.",
    method: "fallback",
  };
  const engine = curatorEngine();
  if (engine !== "claude") {
    if (!hostedConfigured(engine) || rateLimited(clientKey(req), CALLS_PER_WINDOW, WINDOW_MS)) {
      return NextResponse.json(fallback);
    }
  }
  try {
    return NextResponse.json(await compile(q, engine));
  } catch {
    return NextResponse.json(fallback);
  }
}
