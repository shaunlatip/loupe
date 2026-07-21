import { NextRequest, NextResponse } from "next/server";
import {
  addArtwork,
  createCollection,
  deleteCollection,
  listCollections,
  removeArtwork,
  renameCollection,
} from "@/lib/collections";
import type { Artwork } from "@/lib/types";

export async function GET() {
  const collections = await listCollections();
  return NextResponse.json({ collections });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const collections = await createCollection(name);
  return NextResponse.json({ collections });
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as {
    id?: string;
    name?: string;
    add?: Artwork;
    remove?: string;
  };
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  try {
    let collections;
    if (body.add) {
      collections = await addArtwork(body.id, body.add);
    } else if (body.remove) {
      collections = await removeArtwork(body.id, body.remove);
    } else if (body.name?.trim()) {
      collections = await renameCollection(body.id, body.name.trim());
    } else {
      return NextResponse.json(
        { error: "nothing to do — pass name, add, or remove" },
        { status: 400 }
      );
    }
    return NextResponse.json({ collections });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 404 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = (await req.json()) as { id?: string };
  if (!body.id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const collections = await deleteCollection(body.id);
  return NextResponse.json({ collections });
}
