import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { gateway, type LanguageModel } from "ai";

/**
 * Which model answers, and through which door.
 *
 *   claude      Local `npm run dev`: the Claude Agent SDK via the
 *               ai-sdk-provider-claude-code provider, on your `claude login`
 *               subscription. Tools reach it as an in-process MCP server.
 *   openrouter  Hosted default (Vercel): OpenRouter through its AI SDK
 *               provider, on the OPENROUTER_API_KEY the deployment already has.
 *   gateway     Opt-in: the Vercel AI Gateway (OIDC on Vercel, or
 *               AI_GATEWAY_API_KEY locally). Set CURIO_LLM_ENGINE=gateway once
 *               the Gateway is enabled on the account.
 *
 * Vercel sets VERCEL=1; CURIO_LLM_ENGINE=claude|openrouter|gateway overrides
 * the choice either way (e.g. to exercise the hosted path locally).
 */

export type Engine = "claude" | "openrouter" | "gateway";

export function curatorEngine(): Engine {
  const o = process.env.CURIO_LLM_ENGINE?.trim().toLowerCase();
  if (o === "claude" || o === "openrouter" || o === "gateway") return o;
  return process.env.VERCEL ? "openrouter" : "claude";
}

/** Cheap paid vision + tool models; OpenRouter's :free tier shares a daily
 *  cap a public demo exhausts (see AGENTS.md § Deploy). Comma list: the first
 *  is primary, the rest are fallbacks. */
const DEFAULT_HOSTED = "google/gemini-2.5-flash-lite,qwen/qwen3-vl-30b-a3b-instruct";

function modelList(env: string | undefined, fallback: string): string[] {
  return (env?.trim() || fallback)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

export const CURATOR_MODELS = modelList(process.env.CURIO_CURATOR_MODEL, DEFAULT_HOSTED);
export const INTERPRET_MODELS = modelList(process.env.CURIO_INTERPRET_MODEL, DEFAULT_HOSTED);

/** Local Claude Code model aliases: the curator wants judgment, the one-shot
 *  describe compile wants speed. */
export const LOCAL_CURATOR_MODEL = process.env.CURIO_LOCAL_MODEL?.trim() || "sonnet";
export const LOCAL_INTERPRET_MODEL = process.env.CURIO_LOCAL_INTERPRET_MODEL?.trim() || "haiku";

function openRouterKey(): string | undefined {
  return process.env.LLM_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim() || undefined;
}

/** Can the hosted engine make a call at all? (Local Claude uses CLI auth.) */
export function hostedConfigured(engine: Engine): boolean {
  if (engine === "openrouter") return Boolean(openRouterKey());
  if (engine === "gateway") {
    return Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL);
  }
  return true;
}

export const NOT_CONFIGURED =
  "Curio isn't set up on this deployment yet. It needs OPENROUTER_API_KEY (or the AI Gateway).";

/** A hosted model plus the options that carry its fallbacks. */
export function hostedModel(kind: "curator" | "interpret", engine: Engine): {
  model: LanguageModel;
  providerOptions?: Record<string, Record<string, unknown>>;
} {
  const [primary, ...fallbacks] = kind === "curator" ? CURATOR_MODELS : INTERPRET_MODELS;
  if (engine === "gateway") {
    return {
      model: gateway(primary),
      providerOptions: fallbacks.length ? { gateway: { models: fallbacks } } : undefined,
    };
  }
  const baseURL = process.env.LLM_BASE_URL?.trim() || undefined;
  const openrouter = createOpenRouter({
    apiKey: openRouterKey(),
    baseURL,
    appName: "Curio",
    appUrl: "https://curiosearch.art",
  });
  return {
    model: openrouter.chat(primary),
    providerOptions: fallbacks.length ? { openrouter: { models: [primary, ...fallbacks] } } : undefined,
  };
}

/** "google/gemini-2.5-flash-lite" → "Gemini 2.5 Flash-Lite"; "sonnet" → "Claude Sonnet". */
export function modelLabel(id: string | undefined, engine: Engine): string {
  if (!id) return engine === "claude" ? "Claude" : "Curio";
  if (engine === "claude") {
    const alias = id.replace(/^claude-/, "").split("-")[0];
    return `Claude ${alias.charAt(0).toUpperCase()}${alias.slice(1)}`;
  }
  const name = id.split("/").pop() ?? id;
  return name
    .split("-")
    .map((w) => (/^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/ Lite$/, "-Lite");
}

/** A readable reason for a failed call, shown in the thread. */
export function describeLlmError(err: unknown): string {
  const e = err as { statusCode?: number; status?: number; message?: string; name?: string };
  const status = e?.statusCode ?? e?.status;
  if (status === 429) {
    return "The model is rate-limited right now. Try again in a minute.";
  }
  if (status === 401 || status === 403) {
    return "The model provider rejected the key. Check OPENROUTER_API_KEY.";
  }
  if (status === 402) {
    return "The model account is out of credit. Top it up and try again.";
  }
  if (status === 404) {
    return "No model endpoint matched. Check the model name in CURIO_CURATOR_MODEL.";
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/claude.*(login|auth)|not logged in|authentication/i.test(message)) {
    return "The local Claude session isn't signed in. Run `claude login` and try again.";
  }
  return message || "Something went wrong.";
}
