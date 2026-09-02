import { NextRequest, NextResponse } from "next/server";
import { getCalm, getCalmFromBytes } from "@/lib/calm-server";

// Cap on bytes the browser may hand us for decode (see POST) — a thumb is
// well under this; the limit just keeps the route from being a free decoder.
const MAX_UPLOAD_BYTES = 3_000_000;

// Only the museum image hosts Loupe's adapters actually emit — this route
// fetches whatever URL it's given server-side, so pin it to known thumbnail
// hosts rather than acting as an open image-fetch proxy.
const ALLOWED_HOSTS = new Set([
  "www.artic.edu",
  "openaccess-cdn.clevelandart.org",
  "images.metmuseum.org",
  "iip-thumb.smk.dk", // SMK thumbnails
  "img.artsmia.org", // Mia thumbnails
  "ids.lib.harvard.edu", // Harvard IIIF thumbnails (dormant until key)
]);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  const url = sp.get("url");
  if (!id || !url) {
    return NextResponse.json({ error: "id and url are required" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }
  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    return NextResponse.json({ error: "url host not allowed" }, { status: 400 });
  }

  try {
    const result = await getCalm(id, url);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "calm analysis failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

/** POST /api/calm?id=… with the image bytes as the body — the browser fetched
 *  them itself because the host blocks datacenter IPs (AIC on Vercel; see
 *  source-egress.ts). Analysis and cache are identical to GET. */
export async function POST(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const bytes = Buffer.from(await req.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: "image body missing or too large" },
      { status: 400 },
    );
  }

  try {
    return NextResponse.json(await getCalmFromBytes(id, bytes));
  } catch (err) {
    const message = err instanceof Error ? err.message : "calm analysis failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
