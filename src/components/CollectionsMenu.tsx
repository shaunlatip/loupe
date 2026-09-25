"use client";

import { useEffect, useRef, useState } from "react";
import { Bookmark, Download, Trash2 } from "lucide-react";
import Icon from "./Icon";

export interface CollectionSummary {
  id: string;
  name: string;
  count: number;
}

/**
 * Saved collections, behind one square button in the header beside Curio
 * (only once something has been saved). The menu lists each collection:
 * its name opens it on the wall; Download zips it; the bin deletes it (the
 * page confirms first when it holds works). A download's outcome shows at
 * the foot of the menu, which stays open while it zips.
 */
export default function CollectionsMenu({
  collections,
  active,
  exporting,
  note,
  onOpen,
  onExport,
  onDelete,
}: {
  collections: CollectionSummary[];
  /** the collection on the wall, if any */
  active?: string;
  /** the collection being zipped, if any */
  exporting?: string;
  /** the last download's outcome */
  note?: string;
  onOpen: (id: string) => void;
  onExport: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (collections.length === 0) return null;
  const total = collections.length;

  // No positioning context of its own: the menu anchors to the header's
  // button group (see SiteHeader), so it lines up with the page's right edge
  // and stays on screen at phone width.
  return (
    <div ref={wrap} className="flex">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Collections (${total})`}
        title="Collections"
        className={`animate-fade flex items-center justify-center border border-ink px-2.5 ${
          open || active ? "bg-ink text-paper" : "invert-hover"
        }`}
      >
        <Icon icon={Bookmark} size={16} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label="Collections"
          className="animate-pop-right absolute top-full right-0 z-30 mt-1 w-72 border border-ink bg-paper"
        >
          <p className="caption px-3 pt-2 pb-1">Collections</p>
          <ul className="flex flex-col pb-1">
            {collections.map((c) => {
              const isActive = active === c.id;
              const isExporting = exporting === c.id;
              return (
                <li key={c.id} className="group/row flex items-stretch">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onOpen(c.id);
                      setOpen(false);
                    }}
                    aria-current={isActive || undefined}
                    className={`press-none flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-[13px] pointer-coarse:py-2.5 ${
                      isActive ? "bg-ink text-paper" : "invert-hover"
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="tabular shrink-0 text-[12px] opacity-60">{c.count}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onExport(c.id)}
                    disabled={isExporting || c.count === 0}
                    aria-busy={isExporting}
                    aria-label={`Download ${c.name} as a zip`}
                    title={c.count === 0 ? "Nothing to download yet" : isExporting ? "Zipping" : "Download as zip"}
                    className="invert-hover press-none flex w-8 shrink-0 items-center justify-center pointer-coarse:w-10 disabled:pointer-events-none disabled:opacity-30"
                  >
                    <Icon icon={Download} size={14} className={isExporting ? "blink" : undefined} />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(c.id)}
                    aria-label={`Delete ${c.name}`}
                    title="Delete collection"
                    className="invert-hover press-none flex w-8 shrink-0 items-center justify-center pointer-coarse:w-10"
                  >
                    <Icon icon={Trash2} size={14} />
                  </button>
                </li>
              );
            })}
          </ul>
          {note && (
            <p className="caption animate-rise border-t border-ink/15 px-3 py-2" role="status">
              {note}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
