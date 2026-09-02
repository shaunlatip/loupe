import type { Artwork } from "@/lib/types";

/** URL/filename-safe slug — shared by the client collections store and the
 *  server-side export builder, so it lives in its own dependency-free module. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** `artist--title--source-id`, capped — the download filename for one work.
 *  Used by the server zip builder and by browser-side downloads alike. */
export function fileBaseName(artwork: Artwork): string {
  const parts = [
    slugify(artwork.artist) || "unknown-artist",
    slugify(artwork.title) || "untitled",
    `${artwork.source}-${slugify(artwork.nativeId)}`,
  ];
  let base = parts.join("--");
  if (base.length > 120) base = base.slice(0, 120).replace(/-+$/, "");
  return base;
}

export function imageExtension(url: string): "png" | "jpg" {
  return url.split("?")[0].toLowerCase().endsWith(".png") ? "png" : "jpg";
}
