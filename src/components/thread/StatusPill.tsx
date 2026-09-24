"use client";

import { Spinner } from "./Glyph";
import { Elapsed } from "./Live";
import { isWorking, statusText } from "./status";
import { useThread } from "./ThreadProvider";

/**
 * The header's door to the thread, which doubles as its status when the
 * thread isn't showing: what Curio is doing right now, a finished exhibit
 * you haven't looked at yet, or a turn that failed.
 */
export default function StatusPill() {
  const { curator, open, setOpen, unseen, focusComposer } = useThread();
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
        className="invert-hover flex max-w-[22rem] items-center gap-2 border border-ink px-3 py-2 text-[13px]"
      >
        <span aria-hidden className="flex w-3.5 shrink-0 justify-center text-accent">
          <Spinner phase={curator.phase} size={13} />
        </span>
        <span key={statusText(curator)} className="animate-fade truncate">
          {statusText(curator)}
        </span>
        <Elapsed since={curator.turnStartedAt} className="shrink-0 text-[12px] opacity-60" />
      </button>
    );
  }

  if (unseen && curator.exhibit) {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-controls="thread"
        className="invert-hover animate-rise flex max-w-[22rem] items-center gap-2 border border-ink px-3 py-2 text-[13px]"
      >
        <span aria-hidden className="block h-2 w-2 shrink-0 bg-accent" />
        <span className="truncate">{curator.exhibit.title}</span>
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
        className="flex items-center gap-2 border border-destructive px-3 py-2 text-[13px] text-destructive hover:bg-destructive hover:text-paper"
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
      className={`border border-ink px-4 py-2 text-[13px] font-semibold ${
        open ? "bg-ink text-paper" : "invert-hover"
      }`}
    >
      {open ? "Curio" : "Ask Curio"}
    </button>
  );
}
