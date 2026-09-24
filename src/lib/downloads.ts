import type { Artwork } from "@/lib/types";
import { fileBaseName, imageExtension } from "@/lib/slug";

/** Hand a Blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Single-work download fetched by the browser itself. For sources whose image
 * host blocks datacenter IPs (AIC — see source-egress.ts) the server route
 * can't fetch the file on a deployed build, but the viewer's own browser can:
 * no Referer, and AIC sends CORS `*`. Returns a status line for the note.
 */
export async function downloadDirect(artwork: Artwork): Promise<string> {
  try {
    const res = await fetch(artwork.imageHires, { referrerPolicy: "no-referrer" });
    if (!res.ok) return "The museum didn't serve the file. Try again, or open it at the source.";
    const filename = `${fileBaseName(artwork)}.${imageExtension(artwork.imageHires)}`;
    saveBlob(await res.blob(), filename);
    return `Saved ${filename}`;
  } catch {
    return "The download didn't go through. Check the connection and try again.";
  }
}

/**
 * POST an export request and save the streamed response as a file — the
 * server fetches the images and hands back an image (one work) or a zip
 * (many). Returns a status line for the export note.
 */
export async function triggerDownload(body: {
  artworks?: Artwork[];
  folderName?: string;
}): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return "The download didn't go through. Check the connection and try again.";
  }
  if (!res.ok) {
    try {
      const j = (await res.json()) as { error?: string };
      return j.error ?? "The download didn't go through.";
    } catch {
      return "The download didn't go through.";
    }
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const filename = /filename="(.+?)"/.exec(cd)?.[1] ?? "curio-export";
  const failed = Number(res.headers.get("x-export-failed") ?? "0");
  saveBlob(await res.blob(), filename);
  return failed > 0
    ? `Saved ${filename}. ${failed} ${failed === 1 ? "image was" : "images were"} unavailable and skipped.`
    : `Saved ${filename}`;
}
