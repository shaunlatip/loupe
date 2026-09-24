import type { ChatStatus } from "ai";
import type { CurioUIMessage, ExhibitData, StepData } from "@/lib/thread/types";
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
  /** what just happened, for choosing thinking phrases */
  after: "nothing" | "search" | "look" | "curate";
  searches: number;
  resultCount: number;
  lookedAt: number;
  /** id of the assistant message this describes */
  messageId?: string;
  error?: string;
}

export function stepLabel(step: StepData, running: boolean): string {
  if (step.kind === "search") {
    const what = step.terms ? `“${step.terms}”` : "the collections";
    return running ? `Searching for ${what}` : `Searched ${what}`;
  }
  if (step.kind === "look") {
    const n = step.count ?? step.items?.length ?? 0;
    const works = `${n} ${n === 1 ? "work" : "works"}`;
    return running ? `Looking at ${works}` : `Looked at ${works}`;
  }
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
    messageId: turn?.id,
    turnStartedAt: turn?.metadata?.startedAt ?? opts.pendingSince,
  };
  const lastStep = steps[steps.length - 1];
  if (lastStep) base.after = lastStep.kind === "exhibit" ? "curate" : lastStep.kind;

  if (chatStatus === "submitted") return { ...base, phase: "thinking" };
  if (chatStatus === "streaming") {
    const running = [...steps].reverse().find((s) => s.phase === "running");
    if (running) {
      const phase = running.kind === "search" ? "searching" : running.kind === "look" ? "looking" : "curating";
      return { ...base, phase, label: stepLabel(running, true) };
    }
    return { ...base, phase: "thinking" };
  }
  if (chatStatus === "error") return { ...base, phase: "error", error: opts.error };
  if (opts.stopped) return { ...base, phase: "stopped" };
  const exhibit = exhibitOf(turn);
  if (turn && exhibit) {
    const { startedAt, finishedAt } = turn.metadata ?? {};
    const seconds =
      startedAt && finishedAt ? Math.max(1, Math.round((finishedAt - startedAt) / 1000)) : undefined;
    return { ...base, phase: "done", exhibit, seconds };
  }
  return { ...base, phase: "idle" };
}

/** A one-line status for the pill / title / status line. */
export function statusText(s: CuratorStatus): string {
  switch (s.phase) {
    case "searching":
    case "looking":
    case "curating":
      return s.label ?? "Working";
    case "thinking":
      // the first (steady) phrase for what just happened; the thread's own
      // thinking line is the one that rotates
      return thinkingPhrases(s, 0)[0];
    case "done":
      return s.exhibit ? curatedLine(s.exhibit) : "Done";
    case "error":
      return "Something went wrong";
    case "stopped":
      return "Stopped";
    default:
      return "";
  }
}

export function curatedLine(e: ExhibitData): string {
  const n = e.artworks.length;
  return `Curated an exhibit of ${n} ${n === 1 ? "work" : "works"}`;
}

export function isWorking(s: CuratorStatus): boolean {
  return s.phase === "thinking" || s.phase === "searching" || s.phase === "looking" || s.phase === "curating";
}
