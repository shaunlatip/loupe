import type { UIMessage } from "ai";
import type { Artwork } from "@/lib/types";

/**
 * The thread's message shape, shared by the route (which writes it) and the
 * client (which renders it). One AI SDK UIMessage stream carries everything:
 * prose as text parts, and Curio's own structured parts as `data-*` parts that
 * the tool executors write directly, so the UI looks the same whichever
 * engine ran the turn (the tool-call parts themselves are ignored).
 */

export type StepKind = "search" | "look" | "exhibit";
export type StepPhase = "running" | "done" | "error";

/** A work the curator has in hand during a step (a search preview or a look). */
export interface StepItem {
  id: string;
  title: string;
  artist: string;
  thumb: string;
  state: "loading" | "seen" | "failed";
}

/** One unit of the curator's visible work. Written with a stable id and
 *  rewritten in place as it progresses (AI SDK data-part reconciliation). */
export interface StepData {
  kind: StepKind;
  phase: StepPhase;
  startedAt: number;
  endedAt?: number;
  /** search: the terms as typed to the tool ("vanitas", "Heda") */
  terms?: string;
  /** search: "1600–1720" / "after 1850" / "before 1700" */
  years?: string;
  /** search: the one museum it was restricted to, if any */
  source?: string;
  /** search: results returned · look: works requested */
  count?: number;
  /** search: how many museums answered with something */
  museums?: number;
  /** museums that didn't answer (search) */
  unavailable?: string[];
  /** search: a 5-work preview of what came back · look: the works in view */
  items?: StepItem[];
  error?: string;
}

/** An exhibit the curator put together: the result of a turn. */
export interface ExhibitData {
  title: string;
  note: string;
  artworks: Artwork[];
  /** 2-3 short refinements to offer next */
  followUps: string[];
  /** assembled by the time budget rather than chosen by the model */
  fallback?: boolean;
}

/** A plain search run from the one input, recorded in the thread so the
 *  curator knows what's on the wall (no model call behind it). */
export interface SearchEntryData {
  route: "lookup" | "describe";
  query: string;
  heading: string;
  count: number;
  museums: number;
  /** describe route: the facets the phrase was read as */
  readAs?: string[];
}

export type Attachment =
  | { kind: "artwork"; id: string; title: string; artist: string; thumb: string }
  | { kind: "artist"; name: string }
  | { kind: "movement"; name: string };

export type Route = "lookup" | "describe" | "curate" | "refine";

export interface CurioMetadata {
  /** user message: what was attached to it */
  attachments?: Attachment[];
  /** user message: how the one input routed it */
  route?: Route;
  /** user message: a fresh run of a brief, blind to what's on the wall */
  fresh?: boolean;
  /** assistant message: the model that answered, human-readable */
  model?: string;
  engine?: "claude" | "openrouter" | "gateway";
  /** local engine: the Claude Code session to resume on the next turn */
  claudeSessionId?: string;
  startedAt?: number;
  finishedAt?: number;
  /** a replayed example run rather than a live one */
  recorded?: boolean;
}

export type CurioDataTypes = {
  step: StepData;
  exhibit: ExhibitData;
  search: SearchEntryData;
};

export type CurioUIMessage = UIMessage<CurioMetadata, CurioDataTypes>;

/** What the client says is on the wall right now, so "narrow these" works
 *  after any kind of search. Text only; ids let the curator re-present works. */
export interface WallContext {
  heading?: string;
  count: number;
  works: { id: string; title: string; artist: string; date: string }[];
}
