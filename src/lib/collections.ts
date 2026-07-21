import { promises as fs } from "fs";
import path from "path";
import type { Artwork } from "@/lib/types";

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

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "collections.json");

async function load(): Promise<CollectionsFile> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as CollectionsFile;
    if (Array.isArray(parsed.collections)) return parsed;
  } catch {
    // missing or corrupt → start fresh
  }
  return { version: 1, collections: [] };
}

async function save(data: CollectionsFile): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, `.collections-${Date.now()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  await fs.rename(tmp, FILE);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function listCollections(): Promise<Collection[]> {
  const data = await load();
  return data.collections;
}

export async function createCollection(name: string): Promise<Collection[]> {
  const data = await load();
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
  await save(data);
  return data.collections;
}

export async function renameCollection(
  id: string,
  name: string
): Promise<Collection[]> {
  const data = await load();
  const col = data.collections.find((c) => c.id === id);
  if (!col) throw new Error(`No collection with id "${id}"`);
  col.name = name;
  await save(data);
  return data.collections;
}

export async function deleteCollection(id: string): Promise<Collection[]> {
  const data = await load();
  data.collections = data.collections.filter((c) => c.id !== id);
  await save(data);
  return data.collections;
}

export async function addArtwork(
  collectionId: string,
  artwork: Artwork
): Promise<Collection[]> {
  const data = await load();
  const col = data.collections.find((c) => c.id === collectionId);
  if (!col) throw new Error(`No collection with id "${collectionId}"`);
  if (!col.artworks.some((a) => a.id === artwork.id)) {
    col.artworks.push(artwork);
    await save(data);
  }
  return data.collections;
}

export async function removeArtwork(
  collectionId: string,
  artworkId: string
): Promise<Collection[]> {
  const data = await load();
  const col = data.collections.find((c) => c.id === collectionId);
  if (!col) throw new Error(`No collection with id "${collectionId}"`);
  col.artworks = col.artworks.filter((a) => a.id !== artworkId);
  await save(data);
  return data.collections;
}

export async function getCollection(id: string): Promise<Collection | null> {
  const data = await load();
  return data.collections.find((c) => c.id === id) ?? null;
}
