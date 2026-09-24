import { NextRequest, NextResponse } from "next/server";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
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
import { attachedArtworkIds, exhibitArtworks, toModelMessages } from "@/lib/agent/history";
import {
  closeOpenSteps,
  createMuseumContext,
  fallbackExhibit,
  type MuseumContext,
} from "@/lib/agent/museum";
import { CURATOR_PROMPT, HOSTED_NOTE } from "@/lib/agent/prompt";
import { MCP_TOOL_NAMES, museumMcpServer, museumTools } from "@/lib/agent/tools";
import { clientKey, rateLimited } from "@/lib/rate-limit";
import type { CurioUIMessage, WallContext } from "@/lib/thread/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Vercel Hobby caps functions at 60s (and fails the build above the plan
// limit). The hosted loop curates by HOSTED_BUDGET_MS so it always lands.
export const maxDuration = 60;

const NO_EXHIBIT =
  "Curio couldn't put an exhibit together this time: the searches didn't come back. A museum may be slow to answer; try again in a moment.";

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
      // Earlier exhibits' works, so a follow-up can keep, reorder or view
      // them without asking each museum again (see MuseumContext.known).
      for (const a of exhibitArtworks(messages)) ctx.known.set(a.id, a);

      // a fresh run of a brief ("Run it fresh") doesn't build on the wall
      const wall = last.metadata?.fresh ? undefined : body.wall;
      const meta =
        engine === "claude"
          ? await runLocal(messages, wall, ctx, writer)
          : await runHosted(messages, wall, ctx, writer, engine, startedAt, req.signal);

      if (req.signal.aborted) return;
      closeOpenSteps(ctx);
      if (!ctx.exhibit) {
        const fallback = fallbackExhibit(ctx);
        if (fallback) {
          writer.write({ type: "data-exhibit", id: ctx.nextId("exhibit"), data: fallback });
        } else {
          // Nothing to show at all (the searches never came back, or the
          // session ended early): say so, with Try again, rather than leave a
          // turn that just stops.
          writer.write({ type: "error", errorText: NO_EXHIBIT });
          return;
        }
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
    // Stop once an exhibit is up (not at any present_selection call: one that
    // named works that couldn't load is handed back for another try).
    stopWhen: [isStepCount(MAX_STEPS), () => Boolean(ctx.exhibit)],
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
  // Name new sessions up front (a resumed one keeps its id), so the turn can
  // be ended at the exhibit without waiting for the session's own finish.
  const sessionId = resume ?? crypto.randomUUID();
  const turn = new AbortController();

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
    sessionId: resume ? undefined : sessionId,
  });

  const result = streamText({
    model,
    // Resuming a session: it already holds the earlier turns (with the
    // images it looked at), so only the new message goes in.
    messages: toModelMessages(resume ? [lastUser] : messages, wall),
    abortSignal: ctx.signal ? AbortSignal.any([ctx.signal, turn.signal]) : turn.signal,
    // ending the turn at the exhibit aborts the session on purpose
    onError: ({ error }) => {
      if (!turn.signal.aborted) console.error(error);
    },
  });
  writer.merge(
    endAtExhibit(
      result.toUIMessageStream({ sendStart: false, sendFinish: false, sendReasoning: false }),
      ctx,
      () => turn.abort(),
    ),
  );
  const done = { model: modelLabel(LOCAL_CURATOR_MODEL, "claude"), engine: "claude" as const, claudeSessionId: sessionId };
  try {
    const finalStep = await result.finalStep;
    const cc = (finalStep.providerMetadata?.["claude-code"] ?? {}) as { sessionId?: string };
    return {
      ...done,
      model: modelLabel(finalStep.response?.modelId ?? LOCAL_CURATOR_MODEL, "claude"),
      claudeSessionId: cc.sessionId ?? sessionId,
    };
  } catch (err) {
    if (turn.signal.aborted && !ctx.signal?.aborted) return done;
    throw err;
  }
}

/**
 * The local session can't be stopped at present_selection the way the hosted
 * loop is (stopWhen), and left alone a model will often add a recap or
 * "polish" the exhibit it just made. So once the exhibit's tool result has
 * gone back to the session (it's in the transcript, so a later turn resumes
 * cleanly), the turn ends here: open text is closed, the session is aborted,
 * and nothing after it reaches the visitor. Tool chunks are dropped as in
 * withoutToolChunks.
 */
function endAtExhibit<T extends { type: string; id?: string }>(
  stream: ReadableStream<T>,
  ctx: MuseumContext,
  abort: () => void,
): ReadableStream<T> {
  const open = new Set<string>();
  let ended = false;
  return stream.pipeThrough(
    new TransformStream<T, T>({
      transform(chunk, controller) {
        if (ended) return;
        if (chunk.type === "tool-output-available" && ctx.exhibit) {
          ended = true;
          for (const id of open) controller.enqueue({ type: "text-end", id } as unknown as T);
          abort();
          controller.terminate();
          return;
        }
        if (chunk.type.startsWith("tool-")) return;
        if (chunk.type === "text-start" && chunk.id) open.add(chunk.id);
        if (chunk.type === "text-end" && chunk.id) open.delete(chunk.id);
        controller.enqueue(chunk);
      },
    }),
  );
}
