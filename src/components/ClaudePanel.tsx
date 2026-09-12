"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Artwork } from "@/lib/types";

/**
 * The curator panel: a bottom-sticking transcript of one conversation with
 * the museum agent. Modelled on the agentic-chat patterns in AI Elements
 * (Conversation / Message / Tool / Suggestion / Loader) and beautifului
 * (tool chips with live status, elapsed time), rendered in Loupe's flat
 * register: no bubbles with radius, no avatars, ink rules and captions.
 *
 * Turn kinds, in stream order:
 *   user       — what you typed (ink block)
 *   assistant  — prose from the model
 *   tool       — a tool call: running (blinking marker) → done (summary)
 *   selection  — the works it put on the wall, as a thumbnail strip
 *   error      — a failure, with a Retry
 *   stopped    — you pressed Stop
 */
type Turn =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "assistant"; text: string }
  | {
      id: number;
      kind: "tool";
      tool: string;
      label: string;
      state: "running" | "done" | "failed";
      summary?: string;
    }
  | { id: number; kind: "selection"; artworks: Artwork[]; note: string }
  | { id: number; kind: "error"; label: string; retry?: string }
  | { id: number; kind: "stopped" };

/** Omit that distributes over the union, so each turn shape keeps its fields. */
type TurnInput = Turn extends infer T ? (T extends Turn ? Omit<T, "id"> : never) : never;

interface StreamEvent {
  type: "text" | "status" | "tool_result" | "selection" | "done" | "error";
  text?: string;
  tool?: string;
  input?: Record<string, unknown>;
  summary?: string;
  ok?: boolean;
  count?: number;
  artworks?: Artwork[];
  note?: string;
  sessionId?: string;
  model?: string;
  message?: string;
  error?: string;
}

const SUGGESTIONS = [
  "Something dark and quiet I can put white text on",
  "Misty morning, like a Whistler nocturne but lighter",
  "Dutch Golden Age still life with a black ground",
  "Late Monet, almost abstract, cool blues",
];

const SOURCE_NAMES: Record<string, string> = {
  aic: "Art Institute of Chicago",
  cma: "Cleveland",
  met: "the Met",
  smk: "SMK Copenhagen",
  mia: "Minneapolis",
  rijks: "Rijksmuseum",
  harvard: "Harvard",
};

function toolLabel(tool: string, input: Record<string, unknown> = {}): string {
  if (tool === "search_artworks") {
    const terms = [input.artist, input.q].filter(Boolean).join(" · ");
    const where = input.source ? SOURCE_NAMES[String(input.source)] ?? String(input.source) : "all museums";
    const years =
      input.yearFrom !== undefined && input.yearTo !== undefined
        ? ` ${input.yearFrom}–${input.yearTo}`
        : "";
    return `Searching ${where}${terms ? ` for “${terms}”` : ""}${years}`;
  }
  if (tool === "view_artworks") {
    const n = Array.isArray(input.ids) ? input.ids.length : 0;
    return n ? `Looking at ${n} ${n === 1 ? "work" : "works"}` : "Looking at candidates";
  }
  if (tool === "present_selection") {
    const n = Array.isArray(input.artworkIds) ? input.artworkIds.length : 0;
    return n ? `Hanging ${n} ${n === 1 ? "work" : "works"}` : "Hanging the selection";
  }
  return tool;
}

/** The model occasionally emphasises a title with *asterisks*. Render the two
 *  common forms as real emphasis instead of showing the markup; anything
 *  else stays literal (no markdown pipeline for two-sentence replies). */
function Prose({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith("**") && p.endsWith("**") && p.length > 4)
          return <strong key={i}>{p.slice(2, -2)}</strong>;
        if (p.startsWith("*") && p.endsWith("*") && p.length > 2)
          return <em key={i}>{p.slice(1, -1)}</em>;
        return p;
      })}
    </>
  );
}

/** m:ss for the working line — a turn on the hosted engine can take 40s. */
function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return <span className="tabular font-mono">{fmtElapsed(now - since)}</span>;
}

export default function ClaudePanel({
  open,
  onClose,
  onSelection,
}: {
  open: boolean;
  onClose: () => void;
  onSelection: (artworks: Artwork[], note: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [model, setModel] = useState<string | undefined>();
  const sessionRef = useRef<string | undefined>(undefined);
  const abortRef = useRef<AbortController | null>(null);
  const nextId = useRef(1);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastUser = useRef<string>("");

  const push = useCallback((turn: TurnInput) => {
    setTurns((t) => [...t, { ...turn, id: nextId.current++ } as Turn]);
  }, []);

  // Stick to the bottom: new turns and streamed content grow downward and
  // stay in view, filling the empty space instead of scrolling up out of it.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  // Opening the drawer puts the caret in the composer; Escape closes it
  // (unless the detail dialog is up — it owns Escape then).
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const send = useCallback(
    async (message: string) => {
      lastUser.current = message;
      push({ kind: "user", text: message });
      setBusy(true);
      setStartedAt(Date.now());
      const abort = new AbortController();
      abortRef.current = abort;
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, sessionId: sessionRef.current }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) {
          // the route explains itself (not configured / rate-limited) as JSON
          let detail = `The curator didn't answer (${res.status}).`;
          try {
            const j = (await res.json()) as { error?: string };
            if (j.error) detail = j.error;
          } catch {
            /* keep the generic line */
          }
          throw new Error(detail);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let ev: StreamEvent;
            try {
              ev = JSON.parse(line) as StreamEvent;
            } catch {
              continue;
            }
            if (ev.type === "text" && ev.text) {
              push({ kind: "assistant", text: ev.text });
            } else if (ev.type === "status" && ev.tool) {
              push({
                kind: "tool",
                tool: ev.tool,
                label: toolLabel(ev.tool, ev.input),
                state: "running",
              });
            } else if (ev.type === "tool_result" && ev.tool) {
              // resolve the most recent running row for this tool
              setTurns((t) => {
                const i = [...t]
                  .reverse()
                  .findIndex((x) => x.kind === "tool" && x.tool === ev.tool && x.state === "running");
                if (i < 0) return t;
                const idx = t.length - 1 - i;
                const row = t[idx] as Extract<Turn, { kind: "tool" }>;
                const next = [...t];
                next[idx] = {
                  ...row,
                  state: ev.ok === false ? "failed" : "done",
                  summary: ev.summary,
                };
                return next;
              });
            } else if (ev.type === "selection" && ev.artworks) {
              push({ kind: "selection", artworks: ev.artworks, note: ev.note ?? "" });
              onSelection(ev.artworks, ev.note ?? "");
            } else if (ev.type === "done") {
              if (ev.sessionId) sessionRef.current = ev.sessionId;
              if (ev.model) setModel(ev.model);
              if (ev.error) {
                push({ kind: "error", label: `The turn ended early: ${ev.error}.`, retry: message });
              }
            } else if (ev.type === "error") {
              push({
                kind: "error",
                label: ev.message ?? "Something went wrong.",
                retry: message,
              });
            }
          }
        }
      } catch (err) {
        if (abort.signal.aborted) {
          push({ kind: "stopped" });
        } else {
          push({
            kind: "error",
            label: err instanceof Error ? err.message : String(err),
            retry: message,
          });
        }
      } finally {
        // any tool row still "running" when the stream ends was cut off
        setTurns((t) =>
          t.map((x) => (x.kind === "tool" && x.state === "running" ? { ...x, state: "failed" } : x)),
        );
        abortRef.current = null;
        setBusy(false);
        setStartedAt(null);
        inputRef.current?.focus();
      }
    },
    [onSelection, push],
  );

  const reset = useCallback(() => {
    stop();
    setTurns([]);
    sessionRef.current = undefined;
    setModel(undefined);
    inputRef.current?.focus();
  }, [stop]);

  const submit = useCallback(() => {
    const message = value.trim();
    if (!message || busy) return;
    setValue("");
    void send(message);
  }, [value, busy, send]);

  if (!open) return null;

  const hasTurns = turns.length > 0;

  return (
    <aside
      id="curator-panel"
      aria-label="Curator"
      className="animate-slide-in fixed inset-y-0 right-0 z-40 flex w-full max-w-[420px] flex-col border-l border-ink bg-paper"
    >
      <header className="flex items-center justify-between border-b border-ink px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold">Curator</span>
          {model && (
            <span className="caption hidden font-mono sm:inline" title="Model answering this conversation">
              {model.replace(/^.*\//, "")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {hasTurns && (
            <button
              type="button"
              onClick={reset}
              title="Start a new conversation"
              className="invert-hover border border-ink px-3 py-1 text-[12px]"
            >
              New
            </button>
          )}
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="invert-hover border border-ink px-3 py-1 text-[12px] font-semibold"
          >
            Close
          </button>
        </div>
      </header>

      <div
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {!hasTurns && (
          <div className="animate-fade flex flex-col gap-5 pt-4">
            <p className="pretty text-[15px] leading-snug">
              Describe the picture you need behind your UI. The curator searches
              five museums, looks at the candidates, and hangs a set on the wall.
            </p>
            <div className="flex flex-col gap-1.5">
              <span className="caption">Try</span>
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="invert-hover press-none animate-rise border border-ink px-3 py-2 text-left text-[13px] leading-snug"
                  style={{ ["--stagger" as string]: `${60 + i * 40}ms` }}
                >
                  {s}
                </button>
              ))}
            </div>
            <p className="caption pretty leading-relaxed">
              Then refine in plain words: “warmer”, “more abstract”, “just Monet”,
              “swap the portraits out”.
            </p>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className="animate-rise">
            {turn.kind === "user" && (
              <div className="ml-8 flex justify-end">
                <p className="pretty max-w-full bg-ink px-3 py-2 text-[13px] leading-relaxed text-paper">
                  {turn.text}
                </p>
              </div>
            )}
            {turn.kind === "assistant" && (
              <p className="pretty whitespace-pre-line text-[13px] leading-relaxed">
                <Prose text={turn.text} />
              </p>
            )}
            {turn.kind === "tool" && (
              <div
                className={`caption flex items-baseline gap-2 ${
                  turn.state === "running" ? "text-ink" : ""
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-[3px] block h-[6px] w-[6px] shrink-0 self-start ${
                    turn.state === "running"
                      ? "blink bg-accent"
                      : turn.state === "failed"
                        ? "border border-destructive"
                        : "bg-ink"
                  }`}
                />
                <span className="min-w-0">
                  <span className={turn.state === "running" ? "text-sweep" : ""}>
                    {turn.label}
                  </span>
                  {turn.state !== "running" && (
                    <span className="text-muted-foreground">
                      {" · "}
                      {turn.summary ?? (turn.state === "failed" ? "cut off" : "done")}
                    </span>
                  )}
                </span>
              </div>
            )}
            {turn.kind === "selection" && (
              <div className="flex flex-col gap-2 border-t border-b border-ink py-3">
                <div className="flex gap-1">
                  {turn.artworks.slice(0, 8).map((a, i) => (
                    <span
                      key={a.id}
                      className="animate-fade block h-10 min-w-0 flex-1 border border-ink bg-wash"
                      style={{ ["--stagger" as string]: `${i * 40}ms` }}
                      title={`${a.title}, ${a.artist}`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={a.imageThumb}
                        alt=""
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    </span>
                  ))}
                  {turn.artworks.length > 8 && (
                    <span className="caption tabular flex h-10 shrink-0 items-center px-1">
                      +{turn.artworks.length - 8}
                    </span>
                  )}
                </div>
                {turn.note && (
                  <p className="pretty border-l-2 border-accent pl-2 text-[13px] leading-snug">
                    {turn.note}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => onSelection(turn.artworks, turn.note)}
                  className="caption press-none self-start underline underline-offset-2 hover:text-ink"
                >
                  Show these {turn.artworks.length} on the wall
                </button>
              </div>
            )}
            {turn.kind === "error" && (
              <div className="flex flex-col gap-1.5 border-l-2 border-destructive pl-3">
                <p className="pretty text-[13px] leading-snug text-destructive">{turn.label}</p>
                {turn.retry && !busy && (
                  <button
                    type="button"
                    onClick={() => void send(turn.retry!)}
                    className="caption press-none self-start underline underline-offset-2 hover:text-ink"
                  >
                    Try again
                  </button>
                )}
              </div>
            )}
            {turn.kind === "stopped" && <p className="caption">Stopped.</p>}
          </div>
        ))}

        {busy && startedAt !== null && (
          <div className="caption flex items-center gap-2 pt-1">
            <span aria-hidden className="blink block h-[6px] w-[6px] bg-accent" />
            <span className="text-sweep">Working</span>
            <span className="ml-auto">
              <Elapsed since={startedAt} />
            </span>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-end border-t border-ink"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            enterKeyHint="send"
            aria-label="Message the curator"
            placeholder={hasTurns ? "Refine, or ask for something else…" : "Describe the backdrop you need…"}
            className="w-full resize-none bg-paper px-4 pt-3 pb-1 text-[13px] leading-relaxed outline-none placeholder:text-muted-foreground focus:bg-wash"
          />
          <span className="caption px-4 pb-2 text-[10px]">
            Enter to send · Shift+Enter for a new line
          </span>
        </div>
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="shrink-0 self-stretch border-l border-ink px-5 text-[13px] font-semibold text-destructive transition-colors hover:bg-destructive hover:text-paper"
          >
            Stop
          </button>
        ) : (
          <button
            type="submit"
            disabled={!value.trim()}
            className="invert-hover shrink-0 self-stretch border-l border-ink px-5 text-[13px] font-semibold disabled:opacity-40"
          >
            Send
          </button>
        )}
      </form>
    </aside>
  );
}
