import type { Artwork } from "@/lib/types";
import { slugify } from "@/lib/slug";

/**
 * Collections live in the browser's localStorage — Loupe deploys to a
 * read-only serverless host (Vercel), so there's no server filesystem to
 * persist to. Same shape and CRUD semantics as the old server store; every
 * mutation returns the full list so callers can setState in one line.
 */

export interface Collection {
  id: string;
  name: string;
  createdAt: string;
  artworks: Artwork[];
}

interface CollectionsFile {
  version: 1;
  collections: Collection[];
}

const KEY = "loupe.collections.v1";

function load(): CollectionsFile {
  if (typeof window === "undefined") return { version: 1, collections: [] };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as CollectionsFile;
      if (Array.isArray(parsed.collections)) return parsed;
    }
  } catch {
    // missing or corrupt → start fresh
  }
  return { version: 1, collections: [] };
}

function save(data: CollectionsFile): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(data));
}

export function listCollections(): Collection[] {
  return load().collections;
}

export function createCollection(name: string): Collection[] {
  const data = load();
  const base = slugify(name) || "collection";
  let id = base;
  let n = 2;
  while (data.collections.some((c) => c.id === id)) {
    id = `${base}-${n++}`;
  }
  data.collections.push({
    id,
    name,
    createdAt: new Date().toISOString(),
    artworks: [],
  });
  save(data);
  return data.collections;
}

export function renameCollection(id: string, name: string): Collection[] {
  const data = load();
  const col = data.collections.find((c) => c.id === id);
  if (col) {
    col.name = name;
    save(data);
  }
  return data.collections;
}

export function deleteCollection(id: string): Collection[] {
  const data = load();
  data.collections = data.collections.filter((c) => c.id !== id);
  save(data);
  return data.collections;
}

export function addArtwork(collectionId: string, artwork: Artwork): Collection[] {
  const data = load();
  const col = data.collections.find((c) => c.id === collectionId);
  if (col && !col.artworks.some((a) => a.id === artwork.id)) {
    col.artworks.push(artwork);
    save(data);
  }
  return data.collections;
}

export function removeArtwork(collectionId: string, artworkId: string): Collection[] {
  const data = load();
  const col = data.collections.find((c) => c.id === collectionId);
  if (col) {
    col.artworks = col.artworks.filter((a) => a.id !== artworkId);
    save(data);
  }
  return data.collections;
}

export function getCollection(id: string): Collection | undefined {
  return load().collections.find((c) => c.id === id);
}
