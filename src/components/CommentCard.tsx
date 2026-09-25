import type { ReactNode } from "react";

/**
 * Curio's word on one work, as a card in the accent: white on the deep blue.
 * Tuned to read rather than shout: regular weight at 14px with open leading
 * and room around it (the earlier tag was small semibold and felt harsh),
 * greyscale antialiasing so light-on-colour text doesn't thicken, and the
 * "Curio" label quieter than the text. The same card opens beside a picture
 * on the wall and sits in the detail view's side column.
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
      className={`bg-accent px-4 pt-3 pb-3.5 text-left text-paper antialiased ${className}`}
      style={style}
    >
      <p className="text-[11px] leading-[1.5] tracking-[0.04em] text-paper/70">{label}</p>
      <p className="pretty mt-1 text-[14px] leading-[1.55] tracking-[0.005em]">{children}</p>
    </div>
  );
}
