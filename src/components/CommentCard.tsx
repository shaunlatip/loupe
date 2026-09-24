import type { ReactNode } from "react";

/**
 * Curio's word on one work, as a card: ink on paper, a 1px ink border with
 * an accent top edge, the "Curio" label in the accent. The same card opens
 * beside a picture on the wall and sits in the detail view's side column.
 */
export default function CommentCard({
  children,
  className = "",
  style,
  label = "Curio",
  hidden = false,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
  /** hidden from assistive tech (the wall's copy, which is also read out
   *  through the card's own description) */
  hidden?: boolean;
}) {
  return (
    <div
      aria-hidden={hidden || undefined}
      className={`border border-t-[3px] border-ink border-t-accent bg-paper px-3.5 pt-2.5 pb-3 text-left ${className}`}
      style={style}
    >
      <p className="caption text-accent!">{label}</p>
      <p className="pretty mt-1 text-[14px] leading-[1.5] text-ink">{children}</p>
    </div>
  );
}
