"use client";

import { useState } from "react";
import type { Artwork } from "@/lib/types";

export interface SaveMenuCollection {
  id: string;
  name: string;
  count: number;
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

  function submitNew() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onCreate(trimmed);
    setName("");
  }

  return (
    <div className="w-64 border border-ink bg-paper">
      <div className="caption border-b border-ink px-3 py-2">
        Save &ldquo;{artwork.title}&rdquo; to
      </div>
      {collections.length === 0 && (
        <div className="caption border-b border-ink px-3 py-2">
          No collections yet
        </div>
      )}
      {collections.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onSave(c.id)}
          className="invert-hover flex w-full items-baseline justify-between border-b border-ink px-3 py-2 text-left text-[12px]"
        >
          <span>{c.name}</span>
          <span className="caption">{c.count}</span>
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
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New collection"
          className="min-w-0 flex-1 bg-wash px-3 py-2 text-[12px] text-ink outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!name.trim()}
          className="invert-hover border-l border-ink px-3 py-2 text-[12px] disabled:pointer-events-none disabled:text-muted-foreground"
        >
          Add
        </button>
      </form>
    </div>
  );
}
