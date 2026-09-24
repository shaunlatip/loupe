import { NextRequest, NextResponse } from "next/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  hasToolCall,
  isStepCount,
  smoothStream,
  streamText,
  type ModelMessage,
} from "ai";
import { claudeCode } from "ai-sdk-provider-claude-code";
import { getArtworkById } from "@/lib/adapters";
import {
  LOCAL_CURATOR_MODEL,
  NOT_CONFIGURED,
  curatorEngine,
  describeLlmError,
  hostedConfigured,
  hostedModel,
  modelLabel,
} from "@/lib/ai/models";
import { attachedArtworkIds, toModelMessages } from "@/lib/agent/history";
import { createMuseumContext, fallbackExhibit, type MuseumContext } from "@/lib/agent/museum";
import { CURATOR_PROMPT, HOSTED_NOTE } from "@/lib/agent/prompt";
import { MCP_TOOL_NAMES, museumMcpServer, museumTools } from "@/lib/agent/tools";
import { clientKey, rateLimited } from "@/lib/rate-limit";
import type { CurioUIMessage, WallContext } from "@/lib/thread/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s (and fails the build above the plan
// limit). The hosted loop curates by HOSTED_BUDGET_MS so it always lands.
export const maxDuration = 60;

const MAX_STEPS = 8;
const HOSTED_BUDGET_MS = 38_000;
const LOCAL_MAX_TURNS = 16;

// soft per-visitor ceiling on the hosted engine
const TURNS_PER_WINDOW = 12;
const WINDOW_MS = 10 * 60 * 1000;

interface AgentRequestBody {
  messages?: CurioUIMessage[];
  wall?: WallContext;
}

/**
 * POST /api/agent { messages, wall } → an AI SDK UI message stream.
 *
 * One route, two engines behind it (see src/lib/ai/models.ts): the hosted AI
 * SDK tool loop, or a local Claude Code session. Either way the tools are the
 * same executors (museum.ts), which narrate their own work as `data-step`
 * parts and deliver the result as a `data-exhibit` part.
 */
export async function POST(req: NextRequest) {
  let body: AgentRequestBody;
  try {
    body = (await req.json()) as AgentRequestBody;
  } catch {
    return NextResponse.json({ error: "Expected JSON." }, { status: 400 });
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") {
    return NextResponse.json({ error: "The last message must be the visitor's." }, { status: 400 });
  }

  const engine = curatorEngine();
  // Guardrails only apply to the hosted engines; local uses your own CLI auth.
  if (engine !== "claude") {
    if (!hostedConfigured(engine)) {
      return NextResponse.json({ error: NOT_CONFIGURED }, { status: 503 });
    }
    if (rateLimited(clientKey(req), TURNS_PER_WINDOW, WINDOW_MS)) {
      return NextResponse.json(
        { error: "That's a lot of exhibits in a few minutes. Give it a moment and try again." },
        { status: 429 },
      );
    }
  }

  const startedAt = Date.now();
  const stream = createUIMessageStream<CurioUIMessage>({
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageMetadata: { startedAt, engine } });
      const ctx = createMuseumContext(writer, { hosted: engine !== "claude", signal: req.signal });

      // Attached works are looked up server-side (never trusting client
      // records or image URLs) so the tools can resolve them by id.
      await Promise.all(
        attachedArtworkIds(last).map((id) =>
          getArtworkById(id)
            .then((a) => {
              if (a) ctx.cache.set(a.id, a);
            })
            .catch(() => undefined),
        ),
      );

      const meta =
        engine === "claude"
          ? await runLocal(messages, body.wall, ctx, writer)
          : await runHosted(messages, body.wall, ctx, writer, engine, startedAt, req.signal);

      if (!ctx.exhibit && !req.signal.aborted) {
        const fallback = fallbackExhibit(ctx);
        if (fallback) writer.write({ type: "data-exhibit", id: ctx.nextId("exhibit"), data: fallback });
      }
      writer.write({ type: "finish", messageMetadata: { ...meta, finishedAt: Date.now() } });
    },
    onError: describeLlmError,
  });
  return createUIMessageStreamResponse({ stream });
}

type Writer = Parameters<Parameters<typeof createUIMessageStream<CurioUIMessage>>[0]["execute"]>[0]["writer"];

/**
 * Drop the raw tool-call chunks before they reach the browser. The thread
 * renders the executors' own data-step parts instead, and the raw outputs are
 * heavy (search rows as JSON; on the local engine, view_artworks' base64
 * thumbnails), which would also ride back up with every later request.
 */
function withoutToolChunks<T extends { type: string }>(stream: ReadableStream<T>): ReadableStream<T> {
  return stream.pipeThrough(
    new TransformStream<T, T>({
      transform(chunk, controller) {
        if (!chunk.type.startsWith("tool-")) controller.enqueue(chunk);
      },
    }),
  );
}

/** Hosted: the AI SDK tool loop over OpenRouter or the Gateway. */
async function runHosted(
  messages: CurioUIMessage[],
  wall: WallContext | undefined,
  ctx: MuseumContext,
  writer: Writer,
  engine: "openrouter" | "gateway",
  startedAt: number,
  signal: AbortSignal,
) {
  const { model, providerOptions } = hostedModel("curator", engine);
  const result = streamText({
    model,
    instructions: CURATOR_PROMPT + HOSTED_NOTE,
    messages: toModelMessages(messages, wall),
    tools: museumTools(ctx),
    providerOptions: providerOptions as never,
    maxOutputTokens: 2048,
    stopWhen: [isStepCount(MAX_STEPS), hasToolCall("present_selection")],
    prepareStep: ({ stepNumber, messages: stepMessages }) => {
      const out: { messages?: ModelMessage[]; toolChoice?: { type: "tool"; toolName: "present_selection" } } = {};
      // Thumbnails from view_artworks reach the model as a user message
      // (OpenAI-format tool messages are text-only). v7 carries a messages
      // override forward, so each batch is appended exactly once.
      if (ctx.pendingImages.length) {
        const images = ctx.pendingImages.splice(0);
        out.messages = [
          ...stepMessages,
          {
            role: "user",
            content: [
              { type: "text", text: "The works you asked to view, in order:" },
              ...images.flatMap((img) => [
                { type: "text" as const, text: img.label },
                { type: "image" as const, image: img.data, mediaType: img.mimeType },
              ]),
            ],
          },
        ];
      }
      // Always land an exhibit inside the platform's time limit.
      if (!ctx.exhibit && (Date.now() - startedAt > HOSTED_BUDGET_MS || stepNumber >= MAX_STEPS - 1)) {
        out.toolChoice = { type: "tool", toolName: "present_selection" };
      }
      return out;
    },
    abortSignal: signal,
    experimental_transform: smoothStream({ chunking: "word" }),
  });
  writer.merge(
    withoutToolChunks(
      result.toUIMessageStream({ sendStart: false, sendFinish: false, sendReasoning: false }),
    ),
  );
  const response = await result.response;
  return { model: modelLabel(response.modelId, engine), engine };
}

/** Local: a Claude Code session on your `claude login`, tools over in-process MCP. */
async function runLocal(
  messages: CurioUIMessage[],
  wall: WallContext | undefined,
  ctx: MuseumContext,
  writer: Writer,
) {
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const resume = lastAssistant?.metadata?.claudeSessionId;
  const lastUser = messages[messages.length - 1];

  const model = claudeCode(LOCAL_CURATOR_MODEL, {
    systemPrompt: CURATOR_PROMPT,
    mcpServers: { museum: museumMcpServer(ctx) },
    allowedTools: MCP_TOOL_NAMES,
    // A curator and nothing else: no built-in Claude Code tools; none of the
    // user's settings, hooks or CLAUDE.md; and no MCP servers but ours. Without
    // strictMcpConfig (and the claude.ai connector switch) the session can see
    // every connector on the signed-in account (Gmail, Todoist, …).
    tools: [],
    settingSources: [],
    strictMcpConfig: true,
    env: { ENABLE_CLAUDEAI_MCP_SERVERS: "false" },
    maxTurns: LOCAL_MAX_TURNS,
    resume,
  });

  const result = streamText({
    model,
    // Resuming a session: it already holds the earlier turns (with the
    // images it looked at), so only the new message goes in.
    messages: toModelMessages(resume ? [lastUser] : messages, wall),
    abortSignal: ctx.signal,
  });
  writer.merge(
    withoutToolChunks(
      result.toUIMessageStream({ sendStart: false, sendFinish: false, sendReasoning: false }),
    ),
  );
  const finalStep = await result.finalStep;
  const cc = (finalStep.providerMetadata?.["claude-code"] ?? {}) as { sessionId?: string };
  return {
    model: modelLabel(finalStep.response?.modelId ?? LOCAL_CURATOR_MODEL, "claude"),
    engine: "claude" as const,
    claudeSessionId: cc.sessionId,
  };
}
