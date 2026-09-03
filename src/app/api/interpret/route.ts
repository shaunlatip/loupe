import { NextRequest, NextResponse } from "next/server";
import { CATEGORIES } from "@/lib/presets";
import { searchQuerySchema } from "@/lib/search-schema";
import { matchVocab, VOCAB, type VocabEntry } from "@/lib/vocab";
import { INTERPRET_MODELS, llmClient, llmConfigured, modelParams } from "@/lib/llm";
import { useClaudeSdk } from "@/lib/engine";
import { clientKey, rateLimited } from "@/lib/rate-limit";
import type { SearchQuery } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// soft per-visitor ceiling on LLM compiles (vocab hits are free and uncounted)
const CALLS_PER_WINDOW = 40;
const WINDOW_MS = 10 * 60 * 1000;

/**
 * POST /api/interpret { q } → { query, explanation, method } — compiles a
 * vague vibe phrase into one concrete SearchQuery. Fast path: the shared
 * vocabulary (vocab.ts), no LLM. Otherwise one one-shot model call: locally
 * the Claude Agent SDK (method "claude"), on a hosted build the OpenAI-
 * compatible endpoint in llm.ts (method "llm"), chosen by useClaudeSdk().
 * Any failure (missing key, rate limit, unparseable reply) degrades to
 * method:"fallback" (search the phrase as-is); this route never 500s.
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
    if (out.dateRange === undefined && q.dateRange !== undefined)
      out.dateRange = q.dateRange;
    if (q.facets) {
      out.facets ??= {};
      for (const source of ["aic", "cma", "met", "rijks"] as const) {
        const add = q.facets[source];
        if (!add) continue;
        // field-level first-wins merge within each source namespace
        out.facets[source] = { ...add, ...out.facets[source] };
      }
    }
  }
  return out;
}

function buildInterpretPrompt(): string {
  const vocabTable = VOCAB.map(
    (v) =>
      `- ${v.label}${v.note ? ` (${v.note})` : ""}: ${JSON.stringify(v.query)}`,
  ).join("\n");
  const categoryTable = CATEGORIES.map(
    (c) => `- ${c.label}: ${JSON.stringify(c.query)}`,
  ).join("\n");

  return `You compile a product designer's vague "vibe" phrase into exactly ONE SearchQuery JSON object for museum open-access APIs (Art Institute of Chicago "aic", The Met "met", Cleveland "cma"). The results become full-bleed design backdrops — favor atmospheric works with large calm areas.

SearchQuery shape (all fields optional; omit what you don't need; never invent other fields):
{
  "q": string,                      // free-text keyword sent to every source
  "artist": string,
  "dateRange": [number, number],    // years
  "facets": {
    "aic": { "styleName": string, "subjectName": string, "classificationName": string, "departmentName": string, "dateFrom": number, "dateTo": number },
    "met": { "departmentId": number, "medium": string, "geoLocation": string, "dateBegin": number, "dateEnd": number, "q": string, "tags": boolean },
    "cma": { "type": string, "technique": string, "department": string, "culture": string, "createdAfter": number, "createdBefore": number, "q": string }
  }
}

Rules:
- aic styleName/subjectName/classificationName are resolved against AIC's real vocabulary at runtime — only use names you'd expect there (styles: Impressionism, Post-Impressionism, Baroque, Romanticism, Realism; subjects: Landscapes, Seascapes, Still life, Portraits; classifications: painting, print, woodblock print). Unresolvable names are dropped silently. AIC's night-related subject terms are empty — for nocturnes use the keyword "nocturne" instead.
- A top-level "q" is ANDed with aic subject filters and can intersect to empty — when a keyword only helps one source, put it in facets.met.q or facets.cma.q instead.
- facets.met.tags:true makes facets.met.q match The Met's subject tags.
- cma fields are free-text and substring-matched.
- Omit "rijks" entirely (dormant source).
- Prefer 2–4 concrete fields over many speculative ones.

Known vocabulary recipes (concept: query):
${vocabTable}

Category recipes (more working examples):
${categoryTable}

Example compilations:
"misty atmospheric morning" → {"query":{"q":"mist","facets":{"aic":{"styleName":"Impressionism"}}},"explanation":"Impressionist mist and fog studies — Monet, Boudin territory."}
"something dark and moody to put white text on" → {"query":{"q":"nocturne"},"explanation":"Nocturnes — Whistler's dark register, deep grounds for light UI."}
"quiet dutch kitchen scene" → {"query":{"q":"interior","dateRange":[1600,1700],"facets":{"met":{"geoLocation":"Netherlands","dateBegin":1600,"dateEnd":1700},"cma":{"culture":"Netherlands"}}},"explanation":"Dutch Golden Age domestic interiors."}

Respond with ONLY this JSON object, no markdown fences, no prose:
{"query": <SearchQuery>, "explanation": "<one sentence naming the art-historical idea>"}`;
}

/** Pull the first {...} JSON object out of a model reply (fences tolerated). */
function extractJson(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no JSON object in reply");
  return JSON.parse(cleaned.slice(start, end + 1));
}

/** Ask the hosted OpenAI-compatible endpoint for the compile; returns raw text. */
async function llmInterpretText(q: string): Promise<string> {
  const client = llmClient();
  const res = await client.chat.completions.create({
    ...modelParams(INTERPRET_MODELS),
    messages: [
      { role: "system", content: buildInterpretPrompt() },
      { role: "user", content: q },
    ],
    max_tokens: 1024,
    temperature: 0,
  });
  return res.choices[0]?.message?.content ?? "";
}

/** Run the compile through whichever engine this build uses, then extract and
 *  validate the JSON (shared, so both engines behave identically downstream). */
async function compileInterpret(q: string): Promise<InterpretResult> {
  const claude = useClaudeSdk();
  let text: string;
  if (claude) {
    // dynamic import so the Agent SDK never loads on the hosted path
    const { interpretRawWithClaudeSdk } = await import("@/lib/agent/claude-engine");
    text = await interpretRawWithClaudeSdk(q, buildInterpretPrompt());
  } else {
    text = await llmInterpretText(q);
  }
  const raw = extractJson(text) as { query?: unknown; explanation?: unknown };
  const parsed = searchQuerySchema.parse(raw.query);
  return {
    query: parsed,
    explanation:
      typeof raw.explanation === "string" && raw.explanation.trim()
        ? raw.explanation.trim()
        : "Compiled by the model.",
    method: claude ? "claude" : "llm",
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
  if (!q) {
    return NextResponse.json({ error: "q required" }, { status: 400 });
  }

  // Fast path: the shared vocabulary, no LLM call.
  const matches = matchVocab(q);
  if (matches.length > 0) {
    return NextResponse.json({
      query: mergeVocabQueries(matches),
      explanation: `Matched: ${matches.map((m) => m.label).join(", ")}.`,
      method: "vocab",
    } satisfies InterpretResult);
  }

  // Model path — one-shot compile; ANY failure degrades to as-is search. The
  // hosted engine also skips the call when unconfigured or rate-limited; the
  // local Claude engine uses your own CLI auth, so no gate there.
  const fallback: InterpretResult = {
    query: { q },
    explanation: "searched as-is",
    method: "fallback",
  };
  if (!useClaudeSdk()) {
    if (!llmConfigured() || rateLimited(clientKey(req), CALLS_PER_WINDOW, WINDOW_MS)) {
      return NextResponse.json(fallback);
    }
  }
  try {
    return NextResponse.json(await compileInterpret(q));
  } catch {
    return NextResponse.json(fallback);
  }
}
