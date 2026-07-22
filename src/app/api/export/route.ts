import { NextRequest, NextResponse } from "next/server";
import { buildDownload, type ExportRequest } from "@/lib/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// a collection export fetches every hi-res image server-side
export const maxDuration = 120;

/**
 * POST /api/export { artworks?|collectionId? } → the download itself, streamed
 * with Content-Disposition so the browser saves it. One work comes back as the
 * image; many come back as a zip. No server filesystem is touched, so this
 * works on a read-only host (Vercel) exactly as it does locally.
 */
export async function POST(req: NextRequest) {
  let body: ExportRequest;
  try {
    body = (await req.json()) as ExportRequest;
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!body.collectionId && !(body.artworks && body.artworks.length > 0)) {
    return NextResponse.json(
      { error: "pass artworks or a collectionId" },
      { status: 400 },
    );
  }

  try {
    const { filename, contentType, body: bytes, results } = await buildDownload(body);
    const failed = results.filter((r) => !r.ok).length;
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": contentType,
        "content-disposition": `attachment; filename="${filename}"`,
        "content-length": String(bytes.length),
        "cache-control": "no-store",
        // let the client show a partial-failure note without parsing the body
        "x-export-failed": String(failed),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "export failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
