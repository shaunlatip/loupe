"use client";

import { ArrowLeft } from "lucide-react";
import Icon from "../Icon";

/**
 * The corner of an exhibit in the thread: "On the wall" while it's the one
 * showing, otherwise a small button that hangs it again (the wall sits to the
 * thread's left, hence the arrow).
 */
export default function WallButton({ onWall, onShow }: { onWall: boolean; onShow: () => void }) {
  if (onWall) return <span className="caption shrink-0 text-ink">On the wall</span>;
  return (
    <button
      type="button"
      onClick={onShow}
      title="Put this exhibit back on the wall"
      className="invert-hover press-none flex shrink-0 items-center gap-1 border border-ink px-2 py-0.5 text-[12px] leading-[18px]"
    >
      <Icon icon={ArrowLeft} size={12} />
      Show on the wall
    </button>
  );
}
