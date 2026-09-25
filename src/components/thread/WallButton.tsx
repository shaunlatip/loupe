"use client";

import { ArrowLeft } from "lucide-react";
import Icon from "../Icon";
import { useThread } from "./ThreadProvider";

/**
 * The corner of an exhibit in the thread: "On the wall" while it's the one
 * showing, otherwise a small button that hangs it again (the wall sits to the
 * thread's left, hence the arrow).
 *
 * When the thread isn't docked it covers the wall (the phone's full-screen
 * sheet, the overlay on a tablet), so hanging an exhibit also closes the
 * thread, and "On the wall" becomes the way back to it.
 */
export default function WallButton({ onWall, onShow }: { onWall: boolean; onShow: () => void }) {
  const { mode, setOpen } = useThread();
  const covered = mode !== "docked";
  const button =
    "invert-hover press-none flex shrink-0 items-center gap-1 border border-ink px-2 py-0.5 text-[12px] leading-[18px] max-sm:py-1.5";
  if (onWall && !covered) return <span className="caption shrink-0 text-ink">On the wall</span>;
  if (onWall) {
    return (
      <button type="button" onClick={() => setOpen(false)} title="Close the thread and see the wall" className={button}>
        <Icon icon={ArrowLeft} size={12} />
        See the wall
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        onShow();
        if (!covered) return;
        setOpen(false);
        // a different exhibit goes up: start at its title, not partway down
        // the last one
        window.scrollTo({ top: 0 });
      }}
      title="Put this exhibit back on the wall"
      className={button}
    >
      <Icon icon={ArrowLeft} size={12} />
      Show on the wall
    </button>
  );
}
