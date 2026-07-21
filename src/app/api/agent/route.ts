import { NextRequest } from "next/server";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { CURATOR_PROMPT } from "@/lib/agent/prompt";
import { createMuseumServer } from "@/lib/agent/tools";
import type { AgentStreamEvent } from "@/lib/agent/tools";
import type { Artwork } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// curator turns run several museum searches — allow a few minutes
export const maxDuration = 300;

interface AgentRequestBody {
  sessionId?: string;
  message: string;
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
      const museum = createMuseumServer({ cache, emit });

      let sessionId: string | undefined = body.sessionId;

      try {
        const conversation = query({
          prompt: body.message,
          options: {
            resume: body.sessionId,
            systemPrompt: CURATOR_PROMPT,
            mcpServers: { museum },
            allowedTools: [
              "mcp__museum__search_artworks",
              "mcp__museum__present_selection",
            ],
            // curation only — no file/bash/web tools
            tools: [],
            maxTurns: 12,
          },
        });

        for await (const msg of conversation) {
          if (msg.type === "system" && msg.subtype === "init") {
            sessionId = msg.session_id;
          } else if (msg.type === "assistant") {
            for (const block of msg.message.content) {
              if (block.type === "text" && block.text.trim()) {
                emit({ type: "text", text: block.text });
              } else if (block.type === "tool_use") {
                emit({
                  type: "status",
                  tool: block.name.replace("mcp__museum__", ""),
                  input: block.input,
                });
              }
            }
          } else if (msg.type === "result") {
            emit({
              type: "done",
              sessionId: msg.session_id ?? sessionId,
              ...(msg.subtype !== "success" ? { error: msg.subtype } : {}),
            });
          }
        }
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
