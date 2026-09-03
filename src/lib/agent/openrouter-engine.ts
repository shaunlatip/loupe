import type OpenAI from "openai";
import { CURATOR_PROMPT } from "@/lib/agent/prompt";
import { MUSEUM_TOOLS, runMuseumTool, type MuseumToolContext } from "@/lib/agent/tools";
import { CURATOR_MODELS, describeLlmError, llmClient, modelParams } from "@/lib/llm";

/**
 * Curator engine for hosted (serverless) builds: a hand-rolled tool-use loop
 * over an OpenAI-compatible chat endpoint (OpenRouter by default). No agent
 * SDK, no subprocess. Emits the same NDJSON events as the local Claude engine.
 */

// one chat completion per loop step; free models + the 60s cap want short turns
const MAX_STEPS = 8;

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
  const history: Msg[] = prior ? [...prior] : [{ role: "system", content: CURATOR_PROMPT }];
  history.push({ role: "user", content: message });

  try {
    const client = llmClient();
    let model: string | undefined;

    for (let step = 0; step < MAX_STEPS; step++) {
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

    const sid = sessionId ?? crypto.randomUUID();
    SESSIONS.set(sid, stripImages(history));
    ctx.emit({ type: "done", sessionId: sid, model });
  } catch (err) {
    ctx.emit({ type: "error", message: describeLlmError(err) });
  }
}
