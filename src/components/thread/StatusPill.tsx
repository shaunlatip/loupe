"use client";

import { Spinner } from "./Glyph";
import { Elapsed } from "./Live";
import { doneTitle, isWorking } from "./status";
import { useThread } from "./ThreadProvider";

/**
 * The header's door to the thread, which doubles as its status when the
 * thread isn't showing: what Curio is doing right now, a finished exhibit
 * you haven't looked at yet, or a turn that failed.
 */
export default function StatusPill() {
  const { curator, curatorText: text, curatorGlyph, open, setOpen, unseen, focusComposer } = useThread();
  const working = isWorking(curator);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next) focusComposer();
  };

  if (working && !open) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-controls="thread"
        className="invert-hover flex min-w-0 max-w-[22rem] items-center gap-2 border border-ink px-3 py-2 text-[13px]"
      >
        <span aria-hidden className="flex w-3.5 shrink-0 justify-center text-accent">
          <Spinner phase={curatorGlyph} size={13} />
        </span>
        <span key={text} className="animate-fade truncate">
          {text}
        </span>
        <Elapsed since={curator.turnStartedAt} className="shrink-0 text-[12px] opacity-60" />
      </button>
    );
  }

  if (unseen) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-controls="thread"
        className="invert-hover animate-rise flex min-w-0 max-w-[22rem] items-center gap-2 border border-ink px-3 py-2 text-[13px]"
      >
        <span aria-hidden className="block h-2 w-2 shrink-0 bg-accent" />
        <span className="truncate">{doneTitle(curator)}</span>
        <span className="shrink-0 font-semibold">Open</span>
      </button>
    );
  }

  if (curator.phase === "error" && !open) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-controls="thread"
        className="flex items-center gap-2 whitespace-nowrap border border-destructive px-3 py-2 text-[13px] text-destructive hover:bg-destructive hover:text-paper"
      >
        Didn&rsquo;t finish · Open
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={open}
      aria-controls="thread"
      className={`whitespace-nowrap border border-ink px-4 py-2 text-[13px] font-semibold ${
        open ? "bg-ink text-paper" : "invert-hover"
      }`}
    >
      {open ? "Curio" : "Ask Curio"}
    </button>
  );
}
