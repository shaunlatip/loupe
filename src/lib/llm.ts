import OpenAI from "openai";

/**
 * One OpenAI-compatible client for every LLM call in Loupe. Defaults to
 * OpenRouter, whose `:free` models cost $0/token (rate-limited), but any
 * OpenAI-compatible endpoint works — Gemini, Qwen/DashScope, DeepSeek, GLM,
 * or OpenRouter routing to Anthropic/OpenAI — by pointing LLM_BASE_URL at it.
 * Keys come from env only; nothing here is read from code.
 *
 * Model env vars take a comma-separated list. The first is the primary; on
 * OpenRouter the rest are passed as `models` fallbacks, so when a free
 * endpoint is rate-limited or down the request rolls to the next one.
 * Defaults are free models that support both image input and tool calling
 * (the curator needs both); check https://openrouter.ai/models?q=free.
 */

const OPENROUTER = "https://openrouter.ai/api/v1";

export const LLM_BASE_URL = process.env.LLM_BASE_URL?.trim() || OPENROUTER;

const DEFAULT_MODELS =
  "minimax/minimax-m3:free,google/gemma-4-31b-it:free,google/gemma-4-26b-a4b-it:free";

function modelList(env: string | undefined, fallback: string): string[] {
  return (env?.trim() || fallback)
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

export const CURATOR_MODELS = modelList(process.env.LOUPE_CURATOR_MODEL, DEFAULT_MODELS);
export const INTERPRET_MODELS = modelList(process.env.LOUPE_INTERPRET_MODEL, DEFAULT_MODELS);

export function isOpenRouter(): boolean {
  return LLM_BASE_URL.startsWith(OPENROUTER);
}

function apiKey(): string | undefined {
  return (
    process.env.LLM_API_KEY?.trim() || process.env.OPENROUTER_API_KEY?.trim() || undefined
  );
}

export function llmConfigured(): boolean {
  return Boolean(apiKey());
}

export class LlmNotConfigured extends Error {
  constructor() {
    super("The curator isn't configured on this deployment — set OPENROUTER_API_KEY.");
  }
}

export function llmClient(): OpenAI {
  const key = apiKey();
  if (!key) throw new LlmNotConfigured();
  return new OpenAI({
    apiKey: key,
    baseURL: LLM_BASE_URL,
    // OpenRouter app attribution (ignored by other endpoints)
    defaultHeaders: { "HTTP-Referer": "https://loupe-xi.vercel.app", "X-Title": "Loupe" },
    // a hung free endpoint must not eat the whole 60s function budget
    timeout: 45_000,
    maxRetries: 1,
  });
}

/** Request fields that select the model — plus OpenRouter's `models` fallback list. */
export function modelParams(models: string[]): { model: string; models?: string[] } {
  const [primary, ...rest] = models;
  return isOpenRouter() && rest.length > 0 ? { model: primary, models } : { model: primary };
}

/** A human-readable reason for a failed call, shown in the UI. */
export function describeLlmError(err: unknown): string {
  if (err instanceof LlmNotConfigured) return err.message;
  if (err instanceof OpenAI.APIError) {
    if (err.status === 429) {
      return "The curator's free model quota is used up right now — try again in a minute, or tomorrow if the daily cap was hit.";
    }
    if (err.status === 401 || err.status === 403) {
      return "The LLM key was rejected — check OPENROUTER_API_KEY.";
    }
    if (err.status === 404) {
      return "No model endpoint matched — check the model name, and on OpenRouter enable providers that may train on inputs (free models require it).";
    }
    return `LLM error ${err.status ?? ""}: ${err.message}`.replace("  ", " ");
  }
  return err instanceof Error ? err.message : String(err);
}
