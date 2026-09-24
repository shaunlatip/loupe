import { NextRequest, NextResponse } from "next/server";
import type { AgentStreamEvent } from "@/lib/agent/tools";
import { runOpenRouterCurator } from "@/lib/agent/openrouter-engine";
import { getArtworkById } from "@/lib/adapters";
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
  /** ids of works the user attached from the wall ("Add to chat") */
  context?: unknown;
}

const CONTEXT_LIMIT = 8;
const ARTWORK_ID = /^[a-z]+:[\w.-]+$/;

/**
 * Attached works arrive as ids only and are looked up server-side, so the
 * records (and the image URLs view_artworks later fetches) come from the
 * museum adapters rather than from the request. Found records seed this
 * turn's cache; the message gets a plain-text header naming them.
 */
async function withAttachedWorks(
  message: string,
  context: unknown,
  cache: Map<string, Artwork>,
): Promise<string> {
  const ids = Array.isArray(context)
    ? [...new Set(context.filter((id): id is string => typeof id === "string" && ARTWORK_ID.test(id)))].slice(
        0,
        CONTEXT_LIMIT,
      )
    : [];
  if (ids.length === 0) return message;

  const works = await Promise.all(ids.map((id) => getArtworkById(id).catch(() => null)));
  const lines = ids.map((id, i) => {
    const a = works[i];
    if (!a) return `- ${id} (details unavailable)`;
    cache.set(a.id, a);
    const size = a.dims?.width && a.dims?.height ? `${a.dims.width}×${a.dims.height}px` : undefined;
    return `- ${[a.id, a.title, a.artist, a.date, a.medium, size].filter(Boolean).join(" · ")}`;
  });
  return `The user attached ${ids.length === 1 ? "this work" : "these works"} from the wall as context. Use view_artworks on the ids to see ${ids.length === 1 ? "it" : "them"}.\n${lines.join("\n")}\n\n${message}`;
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
        { error: "The curator isn't set up on this deployment. It needs OPENROUTER_API_KEY." },
        { status: 503 },
      );
    }
    if (rateLimited(clientKey(req), TURNS_PER_WINDOW, WINDOW_MS)) {
      return NextResponse.json(
        { error: "Too many curator turns from this address. Try again in a few minutes." },
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

      // req.signal fires when the browser aborts the fetch (the Stop button
      // or a closed tab); both engines check it between steps.
      const ctx = {
        cache: new Map<string, Artwork>(),
        emit,
        viewed: new Set<string>(),
        signal: req.signal,
      };

      try {
        const message = await withAttachedWorks(body.message, body.context, ctx.cache);
        if (claude) {
          // dynamic import so the Agent SDK never loads on the hosted path
          const { runClaudeCurator } = await import("@/lib/agent/claude-engine");
          await runClaudeCurator(message, body.sessionId, ctx);
        } else {
          await runOpenRouterCurator(message, body.sessionId, ctx);
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
