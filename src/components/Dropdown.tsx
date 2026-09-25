"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

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
 * Flat-register dropdown. The trigger is a 1px ink outline that inverts on
 * hover, and an ink fill once it holds a live selection, so a changed bar
 * reads at a glance. The panel is paper with a 1px ink rule and
 * pops in from the trigger edge (see .animate-pop in globals.css). Closes on outside
 * click, Escape (focus returns to the trigger), or when a child calls the
 * `close` render-prop. Arrow keys walk the option rows; Home/End jump. No
 * radius, no shadow: the panel reads as an extension of the trigger.
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
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Keep the panel on screen: a right-aligned menu whose trigger sits near
  // the left edge (the wall tools wrap to the left on a phone) would open
  // off the left of the window. Measured before paint and nudged sideways
  // with `translate`, which composes with the pop-in's transform.
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    if (!open || !panel.current) {
      setShift(0);
      return;
    }
    const r = panel.current.getBoundingClientRect();
    const edge = 16;
    const vw = document.documentElement.clientWidth;
    if (r.left < edge) setShift(edge - r.left);
    else if (r.right > vw - edge) setShift(Math.max(edge - r.left, vw - edge - r.right));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
        return;
      }
      if (!panel.current) return;
      const rows = Array.from(
        panel.current.querySelectorAll<HTMLElement>("[data-option]"),
      );
      if (rows.length === 0) return;
      const i = rows.indexOf(document.activeElement as HTMLElement);
      let next = -1;
      if (e.key === "ArrowDown") next = i < 0 ? 0 : (i + 1) % rows.length;
      else if (e.key === "ArrowUp") next = i < 0 ? rows.length - 1 : (i - 1 + rows.length) % rows.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = rows.length - 1;
      if (next >= 0) {
        e.preventDefault();
        rows[next].focus();
      }
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
        ref={trigger}
        type="button"
        title={title}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={`flex items-center gap-1.5 border border-ink px-3 py-1 text-[12px] pointer-coarse:py-1.5 max-sm:gap-1 max-sm:px-2.5 ${
          active ? "bg-ink text-paper" : "invert-hover"
        }`}
      >
        {label}
        <CaretDown
          className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div
          ref={panel}
          role="menu"
          className={`absolute z-30 mt-1 min-w-full max-w-[calc(100vw-32px)] border border-ink bg-paper ${
            align === "right" ? "animate-pop-right right-0" : "animate-pop left-0"
          } ${panelClassName}`}
          style={shift ? { translate: `${shift}px 0` } : undefined}
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
      role="menuitemcheckbox"
      data-option
      onClick={onClick}
      aria-checked={selected}
      className="invert-hover press-none flex w-full items-center gap-2 whitespace-nowrap px-3 py-1.5 text-left text-[12px] focus-visible:outline-offset-[-2px] pointer-coarse:py-2.5"
    >
      <span
        aria-hidden
        className={`block h-3 w-3 shrink-0 border border-current transition-colors duration-100 ${
          selected ? "bg-current" : "bg-transparent"
        }`}
      />
      {children}
    </button>
  );
}
