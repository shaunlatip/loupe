import { NextRequest, NextResponse } from "next/server";
import { getCalm } from "@/lib/calm-server";

// Only the museum image hosts Loupe's adapters actually emit — this route
// fetches whatever URL it's given server-side, so pin it to known thumbnail
// hosts rather than acting as an open image-fetch proxy.
const ALLOWED_HOSTS = new Set([
  "www.artic.edu",
  "openaccess-cdn.clevelandart.org",
  "images.metmuseum.org",
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
