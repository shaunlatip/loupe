/**
 * Which LLM engine backs the curator and interpret routes.
 *
 * Local (`npm run dev`) → the Claude Agent SDK, which spawns the `claude` CLI
 * and resolves auth from your logged-in profile or ANTHROPIC_API_KEY. That's
 * the cost-effective path when developing on your own machine.
 *
 * Vercel (or any serverless host) → OpenRouter via the OpenAI-compatible
 * client in llm.ts. The Agent SDK can't run there (no subprocess), and free
 * OpenRouter models cost $0/token for real visitors.
 *
 * Vercel sets `VERCEL=1` in build and runtime. Override either way with
 * LOUPE_LLM_ENGINE=claude|openrouter (handy for testing the hosted path
 * locally, or forcing the SDK in a self-hosted Node deploy).
 */
export function useClaudeSdk(): boolean {
  const override = process.env.LOUPE_LLM_ENGINE?.trim().toLowerCase();
  if (override === "claude") return true;
  if (override === "openrouter") return false;
  return !process.env.VERCEL;
}
