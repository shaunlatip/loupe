import type { ChatStatus } from "ai";
import type { CurioUIMessage, ExhibitData, RevisionData, StepData } from "@/lib/thread/types";
import { thinkingPhrases } from "./phrases";

/**
 * What Curio is doing right now, derived once from the conversation and read
 * by every surface that shows it (the thread's status line, the header pill,
 * the jump button, the tab title) so they can never disagree.
 */
export type CuratorPhase =
  | "idle"
  | "thinking"
  | "searching"
  | "looking"
  | "reading"
  /** between steps after a look (weighing what it saw, the longest quiet
   *  stretch of a turn) or after curating (arranging the exhibit) */
  | "choosing"
  | "curating"
  | "done"
  | "error"
  | "stopped";

export interface CuratorStatus {
  phase: CuratorPhase;
  /** the live step's own label, when a step is running */
  label?: string;
  /** when the current (or last) turn started */
  turnStartedAt?: number;
  /** done: how long the turn took */
  seconds?: number;
  /** done: the exhibit it curated */
  exhibit?: ExhibitData;
  /** done: its edit to the exhibit on the wall, when it revised instead */
  revision?: RevisionData;
  /** what just happened, for choosing thinking phrases */
  after: "nothing" | "search" | "look" | "read" | "curate" | "revise";
  searches: number;
  resultCount: number;
  lookedAt: number;
  /** works read about so far this turn */
  readAbout: number;
  /** id of the assistant message this describes */
  messageId?: string;
  error?: string;
}

const works = (n: number) => `${n} ${n === 1 ? "work" : "works"}`;

export function stepLabel(step: StepData, running: boolean): string {
  if (step.kind === "search") {
    const what = step.terms ? `“${step.terms}”` : "the collections";
    return running ? `Searching for ${what}` : `Searched ${what}`;
  }
  if (step.kind === "look") {
    const n = step.count ?? step.items?.length ?? 0;
    return running ? `Looking at ${works(n)}` : `Looked at ${works(n)}`;
  }
  if (step.kind === "read") {
    const n = step.count ?? step.items?.length ?? 0;
    // one work is named: "Reading about “Lucretia”"
    const what = n === 1 && step.items?.[0]?.title ? `“${step.items[0].title}”` : works(n);
    return running ? `Reading about ${what}` : `Read about ${what}`;
  }
  if (step.kind === "revise") return running ? "Revising the exhibit" : "Revised the exhibit";
  return running ? "Curating the exhibit" : "Curated the exhibit";
}

function stepsOf(m: CurioUIMessage): StepData[] {
  return m.parts.flatMap((p) => (p.type === "data-step" ? [p.data] : []));
}

export function exhibitOf(m: CurioUIMessage | undefined): ExhibitData | undefined {
  if (!m) return undefined;
  for (let i = m.parts.length - 1; i >= 0; i--) {
    const p = m.parts[i];
    if (p.type === "data-exhibit") return p.data;
  }
  return undefined;
}

export function revisionOf(m: CurioUIMessage | undefined): RevisionData | undefined {
  if (!m) return undefined;
  for (let i = m.parts.length - 1; i >= 0; i--) {
    const p = m.parts[i];
    if (p.type === "data-revision") return p.data;
  }
  return undefined;
}

const PHASE_OF: Record<StepData["kind"], CuratorPhase> = {
  search: "searching",
  look: "looking",
  read: "reading",
  exhibit: "curating",
  revise: "curating",
};

export function deriveStatus(
  messages: CurioUIMessage[],
  chatStatus: ChatStatus,
  opts: { stopped: boolean; error?: string; pendingSince?: number },
): CuratorStatus {
  const last = messages[messages.length - 1];
  const turn = last?.role === "assistant" && !last.parts.some((p) => p.type === "data-search") ? last : undefined;
  const steps = turn ? stepsOf(turn) : [];
  const searches = steps.filter((s) => s.kind === "search");
  const looks = steps.filter((s) => s.kind === "look");
  const base = {
    after: "nothing" as CuratorStatus["after"],
    searches: searches.length,
    resultCount: searches.reduce((n, s) => n + (s.count ?? 0), 0),
    lookedAt: looks.reduce((n, s) => n + (s.items?.filter((i) => i.state === "seen").length ?? 0), 0),
    readAbout: steps.filter((s) => s.kind === "read").reduce((n, s) => n + (s.count ?? 0), 0),
    messageId: turn?.id,
    turnStartedAt: turn?.metadata?.startedAt ?? opts.pendingSince,
  };
  const lastStep = steps[steps.length - 1];
  if (lastStep) base.after = lastStep.kind === "exhibit" ? "curate" : lastStep.kind;

  if (chatStatus === "submitted") return { ...base, phase: "thinking" };
  if (chatStatus === "streaming") {
    const running = [...steps].reverse().find((s) => s.phase === "running");
    if (running) return { ...base, phase: PHASE_OF[running.kind], label: stepLabel(running, true) };
    // after a look it's weighing what it saw; after curating, arranging it
    const choosing = base.after === "look" || base.after === "curate";
    return { ...base, phase: choosing ? "choosing" : "thinking" };
  }
  if (chatStatus === "error") return { ...base, phase: "error", error: opts.error };
  if (opts.stopped) return { ...base, phase: "stopped" };
  if (!turn) return { ...base, phase: "idle" };
  // A finished turn: a new exhibit, a revision of the one on the wall, or an
  // answer in the thread.
  const { startedAt, finishedAt } = turn.metadata ?? {};
  const seconds =
    startedAt && finishedAt ? Math.max(1, Math.round((finishedAt - startedAt) / 1000)) : undefined;
  const exhibit = exhibitOf(turn);
  const revision = exhibit ? undefined : revisionOf(turn);
  const answered = turn.parts.some((p) => p.type === "text" && p.text.trim());
  if (exhibit || revision || answered) return { ...base, phase: "done", exhibit, revision, seconds };
  return { ...base, phase: "idle" };
}

/** A one-line status for the pill / title / status line. */
export function statusText(s: CuratorStatus): string {
  switch (s.phase) {
    case "searching":
    case "looking":
    case "reading":
    case "curating":
      return s.label ?? "Working";
    case "thinking":
    case "choosing":
      // the first (steady) phrase for what just happened; the thread's own
      // thinking line is the one that rotates
      return thinkingPhrases(s, 0)[0];
    case "done":
      if (s.exhibit) return curatedLine(s.exhibit);
      if (s.revision) return revisedLine(s.revision);
      return "Answered";
    case "error":
      return "Something went wrong";
    case "stopped":
      return "Stopped";
    default:
      return "";
  }
}

export function curatedLine(e: ExhibitData): string {
  return `Curated an exhibit of ${works(e.artworks.length)}`;
}

export function revisedLine(r: RevisionData): string {
  const set = Object.values(r.comments).filter(Boolean).length;
  if (set > 0) return `Added notes on ${works(set)}`;
  if (r.note) return "Rewrote the exhibit note";
  if (r.retitled) return "Retitled the exhibit";
  return "Revised the exhibit";
}

/** What a finished turn you haven't seen yet is called (the header pill, the
 *  tab title). */
export function doneTitle(s: CuratorStatus): string {
  if (s.exhibit) return s.exhibit.title;
  if (s.revision) return s.revision.title;
  return "Curio answered";
}

export function isWorking(s: CuratorStatus): boolean {
  return (
    s.phase === "thinking" ||
    s.phase === "searching" ||
    s.phase === "looking" ||
    s.phase === "reading" ||
    s.phase === "choosing" ||
    s.phase === "curating"
  );
}
