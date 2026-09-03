import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
import { CURATOR_PROMPT } from "@/lib/agent/prompt";
import { MUSEUM_TOOLS, runMuseumTool } from "@/lib/agent/tools";
import type { AgentStreamEvent } from "@/lib/agent/tools";
import {
  CURATOR_MODELS,
  describeLlmError,
  llmClient,
  llmConfigured,
  modelParams,
} from "@/lib/llm";
import { clientKey, rateLimited } from "@/lib/rate-limit";
import type { Artwork } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s (and fails the build above the plan
// limit). A turn is several sequential model+tool round-trips — keep it tight.
export const maxDuration = 60;

// one chat completion per loop step; free models + the 60s cap want short turns
const MAX_STEPS = 8;
// soft per-visitor ceiling so one person can't drain the free quota for all
const TURNS_PER_WINDOW = 12;
const WINDOW_MS = 10 * 60 * 1000;

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * Session continuation without a server session: the running message history
 * is kept in-process, keyed by an opaque id we mint and hand back in `done`.
 * On a cold serverless instance the map is empty, so a follow-up simply starts
 * a fresh conversation. Image parts are stripped before persisting to keep
 * memory bounded (the model re-views works by id when it needs them again).
 */
const SESSIONS = new Map<string, Msg[]>();

interface AgentRequestBody {
  sessionId?: string;
  message: string;
}

/** Replace base64 image parts in stored user messages with a light placeholder. */
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

export async function POST(req: NextRequest) {
  const body = (await req.json()) as AgentRequestBody;
  if (!body.message?.trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }
  if (!llmConfigured()) {
    return NextResponse.json(
      { error: "The curator isn't configured on this deployment (missing OPENROUTER_API_KEY)." },
      { status: 503 },
    );
  }
  if (rateLimited(clientKey(req), TURNS_PER_WINDOW, WINDOW_MS)) {
    return NextResponse.json(
      { error: "Too many curator turns from this address — try again in a few minutes." },
      { status: 429 },
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: AgentStreamEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // client disconnected — let the loop finish quietly
        }
      };

      const cache = new Map<string, Artwork>();
      const ctx = { cache, emit };

      let sessionId = body.sessionId;
      const prior = sessionId ? SESSIONS.get(sessionId) : undefined;
      const history: Msg[] = prior
        ? [...prior]
        : [{ role: "system", content: CURATOR_PROMPT }];
      history.push({ role: "user", content: body.message });

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
          if (msg.content?.trim()) emit({ type: "text", text: msg.content });
          if (calls.length === 0) break;

          const images: { data: string; mimeType: string }[] = [];
          for (const call of calls) {
            const name = call.function.name;
            const input = parseArgs(call.function.arguments);
            emit({ type: "status", tool: name, input });
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

        if (!sessionId) sessionId = crypto.randomUUID();
        SESSIONS.set(sessionId, stripImages(history));
        emit({ type: "done", sessionId, model });
      } catch (err) {
        emit({ type: "error", message: describeLlmError(err) });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
    },
  });
}
