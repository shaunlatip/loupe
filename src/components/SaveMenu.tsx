"use client";

import { useEffect, useRef, useState } from "react";
import type { Artwork } from "@/lib/types";

export interface SaveMenuCollection {
  id: string;
  name: string;
  count: number;
  /** this artwork is already in the collection */
  has?: boolean;
}

export default function SaveMenu({
  artwork,
  collections,
  onSave,
  onCreate,
}: {
  artwork: Artwork;
  collections: SaveMenuCollection[];
  onSave: (collectionId: string) => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // First-run: with nothing to pick from, the only action is naming a new
  // collection, so put the caret there.
  useEffect(() => {
    if (collections.length === 0) input.current?.focus();
  }, [collections.length]);

  function submitNew() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setName("");
  }

  return (
    <div className="animate-pop w-full border border-ink bg-paper">
      <div className="caption border-b border-ink px-3 py-2">
        Save <span className="text-ink">{artwork.title}</span> to
      </div>
      {collections.length === 0 && (
        <div className="caption border-b border-ink px-3 py-2">
          No collections yet. Name one below.
        </div>
      )}
      {collections.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSave(c.id)}
          aria-pressed={c.has}
          className="invert-hover press-none flex w-full items-center gap-2 border-b border-ink px-3 py-2 text-left text-[12px] focus-visible:outline-offset-[-2px]"
        >
          <span
            aria-hidden
            className={`block h-3 w-3 shrink-0 border border-current ${
              c.has ? "bg-current" : "bg-transparent"
            }`}
          />
          <span className="min-w-0 flex-1 truncate">{c.name}</span>
          <span className="caption tabular">{c.has ? "saved" : c.count}</span>
        </button>
      ))}
      <form
        className="flex items-stretch"
        onSubmit={(e) => {
          e.preventDefault();
          submitNew();
        }}
      >
        <input
          ref={input}
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New collection"
          aria-label="New collection name"
          className="min-w-0 flex-1 bg-wash px-3 py-2 text-[12px] text-ink outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="invert-hover border-l border-ink px-3 py-2 text-[12px] disabled:pointer-events-none disabled:text-muted-foreground"
        >
          Create
        </button>
      </form>
    </div>
  );
}
