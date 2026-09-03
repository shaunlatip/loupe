import { NextRequest, NextResponse } from "next/server";
import type { AgentStreamEvent } from "@/lib/agent/tools";
import { runOpenRouterCurator } from "@/lib/agent/openrouter-engine";
import { useClaudeSdk } from "@/lib/engine";
import { llmConfigured } from "@/lib/llm";
import { clientKey, rateLimited } from "@/lib/rate-limit";
import type { Artwork } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s (and fails the build above the plan
// limit). The hosted OpenRouter engine keeps turns short to fit; local runs
// on the Claude SDK where this ceiling doesn't apply.
export const maxDuration = 60;

// soft per-visitor ceiling on the hosted engine so one person can't drain the
// free model quota for everyone
const TURNS_PER_WINDOW = 12;
const WINDOW_MS = 10 * 60 * 1000;

interface AgentRequestBody {
  sessionId?: string;
  message: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as AgentRequestBody;
  if (!body.message?.trim()) {
    return NextResponse.json({ error: "message required" }, { status: 400 });
  }

  const claude = useClaudeSdk();

  // Guardrails only apply to the hosted engine — local uses your own CLI auth.
  if (!claude) {
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

      const ctx = { cache: new Map<string, Artwork>(), emit };

      try {
        if (claude) {
          // dynamic import so the Agent SDK never loads on the hosted path
          const { runClaudeCurator } = await import("@/lib/agent/claude-engine");
          await runClaudeCurator(body.message, body.sessionId, ctx);
        } else {
          await runOpenRouterCurator(body.message, body.sessionId, ctx);
        }
      } catch (err) {
        emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
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
