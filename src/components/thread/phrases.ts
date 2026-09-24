import type { CuratorStatus } from "./status";

/**
 * What the thinking line says while the model is between visible steps.
 * Chosen by what just happened (never random), filled with real numbers,
 * rotated slowly. Sentence case, no ellipses, no em dashes.
 */
export function thinkingPhrases(s: CuratorStatus, waitingMs: number): string[] {
  if (waitingMs > 20_000) {
    return ["Still looking, the collections are deep", "Taking a second pass"];
  }
  switch (s.after) {
    case "nothing":
      return ["Reading your brief", "Deciding where to look", "Picking search terms"];
    case "search":
      return [
        s.resultCount > 0 ? `Sorting through ${s.resultCount} results` : "Sorting through the results",
        "Choosing what to look at",
        "Pulling the promising ones",
      ];
    case "look":
      return [
        "Comparing what I saw",
        "Deciding what makes the exhibit",
        s.lookedAt > 0 ? `Weighing ${s.lookedAt} candidates` : "Weighing the candidates",
      ];
    case "read":
      return ["Checking the label against the picture", "Putting it in my own words", "Deciding what to point out"];
    case "curate":
      return ["Arranging the exhibit", "Writing the exhibit text"];
    case "revise":
      return ["Checking the wall", "Wrapping up"];
  }
}

export const PHRASE_MS = 2400;
