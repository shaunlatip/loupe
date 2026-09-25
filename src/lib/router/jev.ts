import { experimental_evaluate as evaluate } from "ai";
import type { Route } from "@/lib/thread/types";
import { classifyRules, type RouteContext, type RouteDecision } from "./rules";

/**
 * The router on Jev (TypeSafe's "System One" judgment model, through the
 * Vercel AI Gateway as typesafe-ai/jev): one request, two questions, about
 * 100ms. Off unless CURIO_ROUTER=jev and a Gateway credential exist; it falls
 * back to the rules on a 300ms timeout, an error, or a choice under 0.6.
 *
 * Server-only (the key stays on the server). The composer's live verb keeps
 * using the rules, which answer in well under a millisecond; this is the
 * candidate for the decision made on submit, and it goes on by default only
 * if scripts/eval-router.mjs --jev shows it beating the rules by 5 points
 * with p95 under 250ms. Untested against the live model tonight: early
 * access and a Gateway key weren't available.
 */

const MODEL = process.env.CURIO_JEV_MODEL ?? "typesafe-ai/jev";
const TIMEOUT_MS = 300;
const MIN_CONFIDENCE = 0.6;

export function jevEnabled(): boolean {
  return (
    process.env.CURIO_ROUTER === "jev" &&
    Boolean(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN)
  );
}

export interface JevContext {
  /** the wall label's heading, when there's a wall */
  wallHeading?: string;
  /** Curio's last exhibit note, for "that one" / "the second one" */
  lastNote?: string;
}

const ROUTE_CRITERIA = {
  lookup:
    "A name or a plain keyword to search the museums for as typed: an artist, a title, a movement, a subject (e.g. 'Hokusai', 'water lilies', 'still life').",
  describe:
    "A short description of what the works should look like or feel like, to be read into search terms (e.g. 'misty harbour at dawn', 'monet mist').",
  curate:
    "A brief that needs judgment: choosing, ranking, ordering, comparing, a number of works, a question, or a twist on an idea (e.g. 'the most dramatic sky', 'Hammershøi, but outside').",
  refine:
    "A change to the works already on the wall: warmer, only prints, without the portraits, more like the second one.",
} as const;

export async function classifyJev(
  input: string,
  ctx: RouteContext,
  context: JevContext = {},
): Promise<RouteDecision> {
  const fallback = classifyRules(input, ctx);
  if (!jevEnabled() || !input.trim()) return fallback;
  try {
    const { answers } = await evaluate({
      model: MODEL,
      state: {
        query: input.slice(0, 500),
        wall: ctx.hasWall ? (context.wallHeading ?? "works are on the wall") : null,
        attachments: ctx.attachments,
        lastNote: context.lastNote?.slice(0, 500) ?? null,
      },
      questions: {
        route: {
          type: "choice",
          instructions: "What should a museum search tool do with this query?",
          criteria: ROUTE_CRITERIA,
        },
        aboutWall: {
          type: "boolean",
          instructions: "Does the query refer to the works currently on the wall?",
        },
      },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let route = answers.route.choice as Route;
    const confidence = answers.route.probabilities?.[answers.route.choice] ?? 0;
    if (!ctx.hasWall && route === "refine") route = "curate";
    if (ctx.hasWall && answers.aboutWall.probability >= 0.7 && route !== "lookup") route = "refine";
    if (confidence < MIN_CONFIDENCE) return fallback;
    return { route, confidence, source: "jev", reason: `jev chose ${answers.route.choice}` };
  } catch {
    return fallback;
  }
}
