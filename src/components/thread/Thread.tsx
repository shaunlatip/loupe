"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { StickToBottom, useStickToBottomContext } from "use-stick-to-bottom";
import { ArrowDown, Check, RotateCcw, X } from "lucide-react";
import type { Artwork } from "@/lib/types";
import { EXAMPLES } from "@/lib/examples";
import Icon from "../Icon";
import Composer from "./Composer";
import { Spinner } from "./Glyph";
import { Elapsed, ThinkingLine } from "./Live";
import { AssistantMessage, UserMessage } from "./Message";
import { isWorking, statusText } from "./status";
import { THREAD_DEFAULT, THREAD_MIN, exhibitPartIdOf, threadMax, useThread } from "./ThreadProvider";

/**
 * Centred on the transcript's bottom edge whenever the reader isn't at the
 * bottom. Idle it's an arrow; while Curio works it shows what Curio is doing
 * right now (Flip searching, Morph looking, Gather curating).
 */
function JumpButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  const { curator } = useThread();
  const working = isWorking(curator);
  return (
    <button
      type="button"
      onClick={() => void scrollToBottom()}
      tabIndex={isAtBottom ? -1 : 0}
      aria-hidden={isAtBottom}
      aria-label={working ? `Jump to latest, ${statusText(curator).toLowerCase()}` : "Jump to latest"}
      title="Jump to latest"
      className={`invert-hover absolute bottom-3 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center border border-ink bg-paper transition-[opacity,transform,background-color,color] duration-200 ease-[var(--ease-out)] ${
        isAtBottom ? "pointer-events-none translate-y-1 opacity-0" : "translate-y-0 opacity-100"
      }`}
    >
      <span key={working ? curator.phase : "idle"} className="animate-fade flex items-center justify-center">
        {working ? <Spinner phase={curator.phase} size={14} /> : <Icon icon={ArrowDown} size={16} />}
      </span>
    </button>
  );
}

/** The thread's left edge, draggable (and arrow-key adjustable) to resize. */
function ResizeHandle() {
  const { width, setWidth } = useThread();
  const [drag, setDrag] = useState(false);
  const start = useRef<{ x: number; w: number } | null>(null);
  const frame = useRef(0);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, w: width };
    setDrag(true);
    document.body.style.userSelect = "none";
    document.documentElement.dataset.resizing = "true";
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const { x, w } = start.current;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => setWidth(w + (x - e.clientX)));
  };
  const end = () => {
    start.current = null;
    setDrag(false);
    document.body.style.userSelect = "";
    delete document.documentElement.dataset.resizing;
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the thread"
      aria-valuemin={THREAD_MIN}
      aria-valuemax={threadMax()}
      aria-valuenow={width}
      tabIndex={0}
      title="Drag to resize · double-click to reset"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => setWidth(THREAD_DEFAULT)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft") setWidth(width + step);
        else if (e.key === "ArrowRight") setWidth(width - step);
        else if (e.key === "Home") setWidth(threadMax());
        else if (e.key === "End") setWidth(THREAD_MIN);
        else return;
        e.preventDefault();
      }}
      className="group/rh absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize focus-visible:outline-none"
    >
      <span
        aria-hidden
        className={`absolute inset-y-0 left-1 w-px transition-[background-color,width] duration-150 group-hover/rh:w-0.5 group-hover/rh:bg-accent group-focus-visible/rh:w-0.5 group-focus-visible/rh:bg-accent ${
          drag ? "w-0.5 bg-accent" : "bg-ink"
        }`}
      />
    </div>
  );
}

function StatusLine() {
  const { curator } = useThread();
  const working = isWorking(curator);
  if (curator.phase === "idle") return null;
  return (
    <div
      className={`flex items-center gap-2 border-b border-ink/15 px-4 py-1.5 text-[12px] leading-[18px] ${
        curator.phase === "error" ? "text-destructive" : "text-ink/80"
      }`}
      role="status"
      aria-live="polite"
    >
      <span aria-hidden className="flex h-[18px] w-3 shrink-0 items-center justify-center text-accent">
        {working ? (
          <Spinner phase={curator.phase} size={11} />
        ) : curator.phase === "done" ? (
          <Icon icon={Check} size={12} className="text-ink" />
        ) : (
          <span className="block h-1.5 w-1.5 bg-current" />
        )}
      </span>
      <span key={statusText(curator)} className="animate-fade min-w-0 flex-1 truncate">
        {statusText(curator)}
      </span>
      {working ? (
        <Elapsed since={curator.turnStartedAt} className="text-muted-foreground" />
      ) : curator.phase === "done" && curator.seconds ? (
        <span className="tabular font-mono text-muted-foreground">{curator.seconds}s</span>
      ) : null}
    </div>
  );
}

/** Suggestions shown in an empty thread: the same starting points as the wall. */
function EmptyThread({ onPick }: { onPick: (slug: string) => void }) {
  return (
    <div className="animate-fade flex flex-col gap-5 pt-2">
      <p className="pretty text-[15px] leading-snug">
        Ask for an artist, a feeling, or something stranger. Curio searches five museums, looks at every
        candidate, and curates a small exhibit for you.
      </p>
      <div className="flex flex-col gap-1.5">
        <span className="caption">Try</span>
        {EXAMPLES.slice(0, 4).map((ex, i) => (
          <button
            key={ex.slug}
            type="button"
            onClick={() => onPick(ex.slug)}
            className="invert-hover press-none animate-rise border border-ink px-3 py-2 text-left text-[13px] leading-snug"
            style={{ ["--stagger" as string]: `${60 + i * 40}ms` }}
          >
            {ex.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Thread({ onOpenArtwork }: { onOpenArtwork: (a: Artwork) => void }) {
  const {
    messages,
    chatStatus,
    curator,
    open,
    setOpen,
    mode,
    width,
    reset,
    retry,
    submit,
    showExhibit,
    wallExhibitId,
    runExample,
  } = useThread();
  const busy = chatStatus === "submitted" || chatStatus === "streaming";
  const panelRef = useRef<HTMLElement>(null);

  // Escape closes the thread unless a dialog (the detail view) owns it.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector('[role="dialog"]')) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const followUp = useCallback((text: string) => submit(text, "refine"), [submit]);
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const model = lastAssistant?.metadata?.model;
  const lastIndex = messages.length - 1;

  if (!open) return null;

  const style =
    mode === "docked" ? { width } : mode === "overlay" ? { width: Math.min(width, 520) } : undefined;

  return (
    <>
      {mode === "overlay" && (
        <div
          aria-hidden
          onClick={() => setOpen(false)}
          className="animate-fade fixed inset-0 z-30 bg-ink/20"
        />
      )}
      <aside
        ref={panelRef}
        id="thread"
        aria-label="Curio"
        style={style}
        className={`animate-slide-in fixed inset-y-0 right-0 z-40 flex flex-col bg-paper ${
          mode === "sheet" ? "w-full" : "border-l border-ink"
        }`}
      >
        {mode !== "sheet" && <ResizeHandle />}
        <header className="flex items-center justify-between gap-3 border-b border-ink px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="text-[15px] leading-5 font-semibold">Curio</span>
            {model && (
              <span className="caption truncate leading-5" title="The model answering this thread">
                {model}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={reset}
                aria-label="Start a new thread"
                title="New thread"
                className="press-none flex h-8 w-8 items-center justify-center text-ink/70 hover:bg-wash hover:text-ink"
              >
                <Icon icon={RotateCcw} size={16} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close the thread"
              title="Close (Esc)"
              className="press-none flex h-8 w-8 items-center justify-center text-ink/70 hover:bg-wash hover:text-ink"
            >
              <Icon icon={X} size={16} />
            </button>
          </div>
        </header>
        <StatusLine />

        <StickToBottom className="relative min-h-0 flex-1" initial="instant" resize="smooth">
          <StickToBottom.Content
            className="flex flex-col gap-4 px-4 py-4"
            scrollClassName="overscroll-contain"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {messages.length === 0 ? (
              <EmptyThread onPick={runExample} />
            ) : (
              messages.map((m, i) =>
                m.role === "user" ? (
                  <UserMessage key={m.id} message={m} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    live={i === lastIndex && busy}
                    status={curator}
                    onWallExhibitId={wallExhibitId}
                    exhibitPartId={exhibitPartIdOf(m)}
                    onShow={() => showExhibit(m.id)}
                    onOpen={onOpenArtwork}
                    onFollowUp={followUp}
                    onRunFresh={
                      m.metadata?.recorded
                        ? () => {
                            const prompt = messages[i - 1]?.parts
                              .map((p) => (p.type === "text" ? p.text : ""))
                              .join(" ");
                            if (prompt) submit(prompt, "curate");
                          }
                        : undefined
                    }
                    busy={busy}
                  />
                ),
              )
            )}
            {chatStatus === "submitted" && messages[lastIndex]?.role === "user" && (
              <ThinkingLine status={curator} />
            )}
            {curator.phase === "error" && (
              <div className="animate-rise flex flex-col gap-1.5 border-l-2 border-destructive pl-3">
                <p className="pretty text-[13px] leading-snug text-destructive">
                  {curator.error ?? "Something went wrong."}
                </p>
                <button
                  type="button"
                  onClick={retry}
                  className="caption press-none self-start underline underline-offset-2 hover:text-ink"
                >
                  Try again
                </button>
              </div>
            )}
            {curator.phase === "stopped" && (
              <p className="caption">
                Stopped.{" "}
                <button type="button" onClick={retry} className="press-none underline underline-offset-2 hover:text-ink">
                  Pick it up again
                </button>
              </p>
            )}
          </StickToBottom.Content>
          <JumpButton />
        </StickToBottom>

        <div className="border-t border-ink p-3">
          <Composer
            variant="thread"
            placeholder={messages.length ? "Refine, or ask for something else" : "Ask for anything in five museums"}
            autoFocus
          />
        </div>
      </aside>
    </>
  );
}
