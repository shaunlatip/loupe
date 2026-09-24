import artistMovements from "@/data/artist-movements.json";
import { CATEGORIES } from "@/lib/presets";
import { matchVocab, VOCAB } from "@/lib/vocab";
import type { Route } from "@/lib/thread/types";

/**
 * The one input's router, as rules. Four routes:
 *
 *   lookup    a name, a title, a plain keyword: the museums' own search,
 *             instantly, no model ("Hokusai", "water lilies").
 *   describe  a short description: read into facets by one model call,
 *             then searched ("misty harbour at dawn").
 *   curate    a brief that needs judgment, looking, choosing, ordering:
 *             a full curator turn ("the most dramatic sky, then five
 *             runners-up", "Hammershøi, but outside").
 *   refine    a follow-up about what's on the wall ("warmer", "only the
 *             prints", "more like this").
 *
 * Rules first because they're free and instant; the same `classify` shape is
 * what a Jev-backed router plugs into (see ./jev.ts). Misroutes are cheap in
 * one direction (a lookup that should have been curated still shows works)
 * and the composer always shows the route before you press it.
 */

export interface RouteContext {
  /** there are works on the wall to refine */
  hasWall: boolean;
  /** artworks/artists/movements are attached to this message */
  attachments: number;
}

export interface RouteDecision {
  route: Route;
  confidence: number;
  source: "rules" | "jev";
  reason: string;
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Artist names from the Wikidata join ("claude monet", "monet, claude"),
// plus bare surnames, so "Monet" and "Hokusai" read as lookups.
let artistNames: Set<string> | undefined;
let surnames: Set<string> | undefined;
function artists() {
  if (!artistNames || !surnames) {
    artistNames = new Set();
    surnames = new Set();
    for (const key of Object.keys(artistMovements as Record<string, unknown>)) {
      const n = normalize(key.replace(",", " "));
      artistNames.add(n);
      const surname = key.includes(",") ? normalize(key.split(",")[0]) : n.split(" ").pop();
      if (surname && surname.length > 3) surnames.add(surname);
    }
  }
  return { artistNames, surnames };
}

const LABELS = new Set(
  [...CATEGORIES.map((c) => c.label), ...VOCAB.map((v) => v.label)].map(normalize),
);

/** Asking for judgment: choosing, ranking, ordering, comparing, a count. */
const CURATE =
  /\b(pick|choose|select|curate|best|most|least|favou?rite|rank|ranking|top \d+|winner|runners? ?up|compare|versus|vs|sequence|in order|order them|date order|from (dawn|morning|day|spring|light) to|like [a-z' ]+ but|but (outside|outdoors|indoors|at night|brighter|darker|warmer|cooler|happier|sadder)|for (a|an|my|our|the) |why|which|exhibit|a set|set of|series|a pair|trio|one of each|exactly|with opinions|through history|across (the )?centuries|that (feel|look|go)|(two|three|four|five|six|seven|eight|nine|ten|twelve|\d+) (works|paintings|prints|pictures|pieces|images|drawings))\b/;

/** Talking about what's already on the wall. */
const REFINE =
  /^(warmer|cooler|colder|darker|lighter|brighter|calmer|quieter|busier|more|less|fewer|only|just|without|no |not |swap|remove|drop|keep|replace|instead|again|another|different|these|this|those|narrow|widen|same but|similar|and |but )/;

/** Descriptive words that make a short phrase a description, not a lookup. */
const DESCRIPTIVE =
  /\b(quiet|calm|moody|dark|bright|warm|cold|cool|soft|dreamy|lonely|melancholy|melancholic|joyful|happy|sad|strange|weird|absurd|eerie|gloomy|serene|peaceful|dramatic|stormy|misty|foggy|hazy|golden|pale|muted|vivid|colou?rful|minimal|busy|empty|wild|gentle|tender|cosy|cozy|sunlit|moonlit|rainy|snowy|windy|early|late|ancient|tiny|huge|vast|small|big|feeling|mood|light|evening|morning|dawn|dusk|night)\b/;

export function classifyRules(input: string, ctx: RouteContext): RouteDecision {
  const q = normalize(input);
  const words = q ? q.split(" ").length : 0;
  const decide = (route: Route, confidence: number, reason: string): RouteDecision => ({
    route,
    confidence,
    source: "rules",
    reason,
  });

  if (!q) return decide("lookup", 0, "empty");
  if (ctx.attachments > 0) {
    return decide(ctx.hasWall && REFINE.test(q) ? "refine" : "curate", 0.85, "has attachments");
  }
  if (ctx.hasWall && REFINE.test(q) && words <= 12) return decide("refine", 0.8, "refers to the wall");
  if (/\?\s*$/.test(input.trim())) return decide("curate", 0.75, "a question");
  if (CURATE.test(q)) return decide("curate", 0.8, "asks for judgment");
  if (words >= 7) return decide("curate", 0.65, "a long brief");

  const { artistNames: names, surnames: last } = artists();
  const isName = names.has(q) || last.has(q) || LABELS.has(q);
  if (isName) return decide("lookup", 0.9, "a known name or label");

  const descriptive = DESCRIPTIVE.test(q) || matchVocab(input).length > 0;
  if (words <= 3 && !descriptive) return decide("lookup", 0.7, "a short keyword");
  const mentionsArtist = q.split(" ").some((w) => last.has(w));
  if (words <= 3 && mentionsArtist) return decide("lookup", 0.6, "an artist and a keyword");
  return decide("describe", descriptive ? 0.7 : 0.55, "a description");
}

/** The composer's verb for a route: what pressing Enter will do. */
export function routeVerb(route: Route): string {
  if (route === "lookup") return "Search";
  if (route === "describe") return "Find";
  return "Ask";
}
