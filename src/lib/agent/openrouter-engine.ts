import type OpenAI from "openai";
import { CURATOR_PROMPT } from "@/lib/agent/prompt";
import { MUSEUM_TOOLS, runMuseumTool, type MuseumToolContext } from "@/lib/agent/tools";
import { CURATOR_MODELS, describeLlmError, llmClient, modelParams } from "@/lib/llm";
import type { Artwork } from "@/lib/types";

/**
 * Curator engine for hosted (serverless) builds: a hand-rolled tool-use loop
 * over an OpenAI-compatible chat endpoint (OpenRouter by default). No agent
 * SDK, no subprocess. Emits the same NDJSON events as the local Claude engine.
 */

// one chat completion per loop step; free models + the 60s cap want short turns
const MAX_STEPS = 6;
// stop looping well before Vercel's 60s function cap so we can always present
// something (the fallback below) instead of the platform killing the request
const TIME_BUDGET_MS = 42_000;
// most works to auto-present when the model runs out of time before it does
const FALLBACK_LIMIT = 12;

/**
 * Hosted-only guardrails appended to the shared curator prompt. AIC's image
 * host blocks Vercel's datacenter IP, so view_artworks can't fetch AIC thumbs
 * here — without this the model loops forever "retrying" them and never
 * presents (see the 60s-timeout bug). Keep the turn short and always finish.
 */
const HOSTED_NOTE = `

## This is the hosted build — work fast and finish

- Thumbnails from the Art Institute of Chicago (ids starting "aic:") CANNOT be viewed here; view_artworks will report them unavailable. Do NOT call view_artworks on aic ids and NEVER retry an unavailable image. When you need to SEE a work, use met, cma, smk or mia ids.
- You may still include aic works in the final selection judged by their metadata (title/artist/date) even though you can't view them.
- Strict time budget: run at most 2-3 searches and one view_artworks call on non-aic ids, then ALWAYS finish with present_selection (6-12 works). A good set you've mostly seen beats timing out with nothing on screen.`;

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Session continuation without a server session: the running message history
 * is kept in-process, keyed by an opaque id handed back in `done`. A cold
 * serverless instance simply starts fresh. Image parts are stripped before
 * persisting to keep memory bounded (the model re-views works by id).
 */
const SESSIONS = new Map<string, Msg[]>();

function stripImages(history: Msg[]): Msg[] {
  return history.map((msg) => {
    if (msg.role !== "user" || typeof msg.content === "string") return msg;
    const content = msg.content.map((part) =>
      part.type === "image_url" ? { type: "text" as const, text: "[image viewed]" } : part,
    );
    return { ...msg, content };
  });
}

function parseArgs(raw: string | undefined): unknown {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export async function runOpenRouterCurator(
  message: string,
  sessionId: string | undefined,
  ctx: MuseumToolContext,
): Promise<void> {
  const prior = sessionId ? SESSIONS.get(sessionId) : undefined;
  const history: Msg[] = prior
    ? [...prior]
    : [{ role: "system", content: CURATOR_PROMPT + HOSTED_NOTE }];
  history.push({ role: "user", content: message });

  const start = Date.now();
  let presented = false;

  try {
    const client = llmClient();
    let model: string | undefined;

    for (let step = 0; step < MAX_STEPS; step++) {
      // stop before the platform kills us, so the fallback below can run
      if (Date.now() - start > TIME_BUDGET_MS) break;
      const res = await client.chat.completions.create({
        ...modelParams(CURATOR_MODELS),
        messages: history,
        tools: MUSEUM_TOOLS,
        tool_choice: "auto",
        max_tokens: 2048,
      });
      model = res.model;
      const msg = res.choices[0]?.message;
      if (!msg) break;

      const calls = (msg.tool_calls ?? []).filter((c) => c.type === "function");
      history.push({
        role: "assistant",
        content: msg.content ?? null,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      if (msg.content?.trim()) ctx.emit({ type: "text", text: msg.content });
      if (calls.length === 0) break;

      const images: { data: string; mimeType: string }[] = [];
      for (const call of calls) {
        const name = call.function.name;
        const input = parseArgs(call.function.arguments);
        if (name === "present_selection") presented = true;
        ctx.emit({ type: "status", tool: name, input });
        try {
          const outcome = await runMuseumTool(name, input, ctx);
          history.push({ role: "tool", tool_call_id: call.id, content: outcome.text });
          if (outcome.images?.length) images.push(...outcome.images);
        } catch (err) {
          history.push({
            role: "tool",
            tool_call_id: call.id,
            content: `error: ${err instanceof Error ? err.message : "tool failed"}`,
          });
        }
      }
      // tool messages are text-only in this format — images ride in a
      // follow-up user message, in the order view_artworks listed them
      if (images.length > 0) {
        history.push({
          role: "user",
          content: [
            { type: "text", text: "Thumbnails for the works you asked to view, in order:" },
            ...images.map((img) => ({
              type: "image_url" as const,
              image_url: { url: `data:${img.mimeType};base64,${img.data}` },
            })),
          ],
        });
      }
    }

    // Safety net: a free model on the 60s cap sometimes stops (or is cut off
    // by TIME_BUDGET_MS) without ever calling present_selection. Rather than
    // leave the grid empty, present what it actually saw — or, if it viewed
    // nothing, the strongest search hits it gathered.
    if (!presented) {
      const viewed = ctx.viewed
        ? [...ctx.viewed].map((id) => ctx.cache.get(id)).filter((a): a is Artwork => !!a)
        : [];
      const pool = viewed.length > 0 ? viewed : [...ctx.cache.values()];
      const picks = pool.slice(0, FALLBACK_LIMIT);
      if (picks.length > 0) {
        ctx.emit({
          type: "selection",
          artworks: picks,
          note: "A quick set gathered before the time limit — ask the curator to refine it.",
        });
      }
    }

    const sid = sessionId ?? crypto.randomUUID();
    SESSIONS.set(sid, stripImages(history));
    ctx.emit({ type: "done", sessionId: sid, model });
  } catch (err) {
    ctx.emit({ type: "error", message: describeLlmError(err) });
  }
}
