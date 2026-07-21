import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { exportArtworks, type ExportRequest } from "@/lib/export";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ExportRequest;

  if (!body.collectionId && !(body.artworks && body.artworks.length > 0)) {
    return NextResponse.json(
      { error: "pass artworks or a collectionId" },
      { status: 400 }
    );
  }
  if (body.destDir && !path.isAbsolute(body.destDir)) {
    return NextResponse.json(
      { error: "destDir must be an absolute path" },
      { status: 400 }
    );
  }

  try {
    const result = await exportArtworks(body);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "export failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
