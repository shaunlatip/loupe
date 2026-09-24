import type { LucideIcon, LucideProps } from "lucide-react";

/**
 * Lucide, drawn in the museum register: a fixed 1.5px stroke at every size,
 * square caps and mitred joins so glyphs share the zero-radius geometry of
 * the rest of the UI. Decorative by default; pass `aria-label` (and drop
 * aria-hidden) only where the icon is the whole label.
 */
export default function Icon({
  icon: Glyph,
  size = 16,
  ...rest
}: { icon: LucideIcon; size?: number } & Omit<LucideProps, "ref" | "size">) {
  return (
    <Glyph
      size={size}
      strokeWidth={1.5}
      absoluteStrokeWidth
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden
      {...rest}
    />
  );
}
