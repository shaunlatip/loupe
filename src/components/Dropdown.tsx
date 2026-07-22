"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Phosphor CaretDown (regular weight, MIT) — inlined to avoid a dep for one
 * glyph. More legible than a unicode ▾. Rotates 180° when its menu is open. */
export function CaretDown({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      fill="currentColor"
      aria-hidden
      className={className}
    >
      <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
    </svg>
  );
}

/**
 * Flat-register dropdown — a 1px-ink trigger and a paper panel that pops in
 * from the trigger edge (see .animate-pop in globals.css). Closes on outside
 * click, Escape, or when a child calls the `close` render-prop. No radius, no
 * shadow: the panel reads as an extension of the trigger, elevation via border.
 */
export default function Dropdown({
  label,
  active = false,
  title,
  align = "left",
  className = "",
  panelClassName = "",
  children,
}: {
  /** trigger content (a group name, or the active selection's label) */
  label: ReactNode;
  /** accent the trigger when a selection is live inside this menu */
  active?: boolean;
  title?: string;
  align?: "left" | "right";
  /** applied to the positioning root — e.g. `ml-auto` to push the trigger right */
  className?: string;
  panelClassName?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrap} className={`relative ${className}`}>
      <button
        type="button"
        title={title}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-1.5 border border-ink px-3 py-1 text-[12px] ${
          active ? "bg-accent text-paper" : "invert-hover"
        }`}
      >
        {label}
        <CaretDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-120 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div
          className={`animate-pop absolute z-30 mt-1 min-w-full border border-ink bg-paper ${
            align === "right" ? "right-0" : "left-0"
          } ${panelClassName}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

/**
 * A single menu row. The selection marker is always a visible bordered box —
 * empty when unselected, filled when selected — so every row reads as a
 * checkbox affordance (an invisible marker made it unclear rows were even
 * pickable). `bg-current` fills with the row's text color, which flips to
 * paper under invert-hover so the box stays visible on the ink hover fill.
 */
export function DropdownOption({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="invert-hover flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px]"
    >
      <span
        aria-hidden
        className={`block h-3 w-3 shrink-0 border border-current ${
          selected ? "bg-current" : "bg-transparent"
        }`}
      />
      {children}
    </button>
  );
}
