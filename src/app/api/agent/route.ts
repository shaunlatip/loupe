import { NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { CURATOR_PROMPT } from "@/lib/agent/prompt";
import { MUSEUM_TOOLS, runMuseumTool } from "@/lib/agent/tools";
import type { AgentStreamEvent } from "@/lib/agent/tools";
import type { Artwork } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps serverless functions at 60s (and fails the build if this
// exceeds the plan limit). A curator turn runs several sequential model+tool
// round-trips, so complex turns can bump this ceiling — raise it on Pro.
export const maxDuration = 60;

const MODEL = "claude-opus-4-8";
// one create() call per loop step; a turn rarely needs more than a handful
const MAX_STEPS = 12;

/**
 * Session continuation without a server session: the running message history is
 * kept in-process, keyed by an opaque id we mint and hand back in `done`. On a
 * cold serverless instance the map is empty, so a follow-up simply starts a
 * fresh conversation — the curator still works, it just loses the earlier
 * brief. Image blocks are stripped before persisting to keep memory bounded
 * (the model re-reads works by id when it needs them again).
 */
const SESSIONS = new Map<string, Anthropic.MessageParam[]>();

interface AgentRequestBody {
  sessionId?: string;
  message: string;
}

/** Replace base64 image blocks in stored tool_results with a light placeholder. */
function stripImages(history: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  return history.map((msg) => {
    if (msg.role !== "user" || typeof msg.content === "string") return msg;
    const content = msg.content.map((block) => {
      if (block.type !== "tool_result" || !Array.isArray(block.content)) return block;
      const inner = block.content.map((b) =>
        b.type === "image"
          ? ({ type: "text", text: "[image viewed]" } as Anthropic.TextBlockParam)
          : b,
      );
      return { ...block, content: inner };
    });
    return { ...msg, content };
  });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as AgentRequestBody;
  if (!body.message?.trim()) {
    return new Response(JSON.stringify({ error: "message required" }), {
      status: 400,
    });
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
      const history: Anthropic.MessageParam[] = prior ? [...prior] : [];
      history.push({ role: "user", content: body.message });

      try {
        const client = new Anthropic();

        for (let step = 0; step < MAX_STEPS; step++) {
          const res = await client.messages.create({
            model: MODEL,
            max_tokens: 4096,
            system: CURATOR_PROMPT,
            thinking: { type: "adaptive" },
            tools: MUSEUM_TOOLS,
            messages: history,
          });

          history.push({ role: "assistant", content: res.content });

          const toolUses: Anthropic.ToolUseBlock[] = [];
          for (const block of res.content) {
            if (block.type === "text" && block.text.trim()) {
              emit({ type: "text", text: block.text });
            } else if (block.type === "tool_use") {
              emit({ type: "status", tool: block.name, input: block.input });
              toolUses.push(block);
            }
          }

          if (res.stop_reason !== "tool_use" || toolUses.length === 0) break;

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            try {
              const content = await runMuseumTool(tu.name, tu.input, ctx);
              results.push({ type: "tool_result", tool_use_id: tu.id, content });
            } catch (err) {
              results.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: err instanceof Error ? err.message : "tool failed",
                is_error: true,
              });
            }
          }
          history.push({ role: "user", content: results });
        }

        if (!sessionId) sessionId = crypto.randomUUID();
        SESSIONS.set(sessionId, stripImages(history));
        emit({ type: "done", sessionId });
      } catch (err) {
        emit({
          type: "error",
          message: err instanceof Error ? err.message : String(err),
        });
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
