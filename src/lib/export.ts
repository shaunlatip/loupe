import { Buffer } from "node:buffer";
import type { Artwork, SourceId } from "@/lib/types";
import { isMuseumImageUrl } from "@/lib/image-hosts";
import { fileBaseName, imageExtension, slugify } from "@/lib/slug";
import { createZip, type ZipEntry } from "@/lib/zip";

/**
 * Export builds the download IN MEMORY and hands it back to the route, which
 * streams it to the browser (Content-Disposition: attachment). Nothing touches
 * the server filesystem, so this works identically on localhost and on a
 * read-only serverless host like Vercel. A single work downloads as the bare
 * image; a collection downloads as a zip of images + per-work sidecar JSON + an
 * ATTRIBUTION.md.
 */

const MUSEUM_LABELS: Record<SourceId, string> = {
  aic: "Art Institute of Chicago",
  cma: "Cleveland Museum of Art",
  met: "The Met",
  rijks: "Rijksmuseum",
  smk: "Statens Museum for Kunst",
  mia: "Minneapolis Institute of Art",
  harvard: "Harvard Art Museums",
};

export interface ExportItemResult {
  id: string;
  ok: boolean;
  error?: string;
}

export interface ExportRequest {
  artworks?: Artwork[];
  /** folder name inside the zip + download filename (a collection's slug, say) */
  folderName?: string;
}

export interface DownloadResult {
  filename: string;
  contentType: string;
  body: Buffer;
  /** per-artwork fetch outcome — the route can surface partial failures */
  results: ExportItemResult[];
}

/** A collection export's works come from the browser, so they're capped. */
export const EXPORT_MAX_WORKS = 60;
/** One museum hi-res is a few MB; past this it isn't a museum image. */
const IMAGE_MAX_BYTES = 40_000_000;

async function fetchImage(artwork: Artwork): Promise<Uint8Array> {
  // The URL arrives in the request body: only museum image hosts, before and
  // after any redirect, or this route would be an open proxy.
  if (!isMuseumImageUrl(artwork.imageHires)) throw new Error("not a museum image");
  const res = await fetch(artwork.imageHires, {
    headers: {
      // Some IIIF servers (AIC) 403 requests without a browser-ish UA.
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) curio/1.0",
      accept: "image/*,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!isMuseumImageUrl(res.url)) throw new Error("redirected off the museum");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (Number(res.headers.get("content-length") ?? 0) > IMAGE_MAX_BYTES) throw new Error("image too large");
  const data = new Uint8Array(await res.arrayBuffer());
  if (data.byteLength > IMAGE_MAX_BYTES) throw new Error("image too large");
  return data;
}

function sidecarJson(artwork: Artwork, downloadedAt: string): string {
  return (
    JSON.stringify(
      {
        title: artwork.title,
        artist: artwork.artist,
        date: artwork.date,
        museum: MUSEUM_LABELS[artwork.source],
        accession: artwork.accession ?? null,
        license: artwork.license,
        sourceUrl: artwork.sourceUrl,
        imageUrl: artwork.imageHires,
        downloadedAt,
      },
      null,
      2,
    ) + "\n"
  );
}

function mdCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function attributionMarkdown(artworks: Artwork[], downloadedAt: string): string {
  const lines = [
    "# Attribution",
    "",
    "| Artist | Title | Date | Museum | Accession | License | Source link |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const a of artworks) {
    lines.push(
      `| ${mdCell(a.artist)} | ${mdCell(a.title)} | ${mdCell(a.date)} | ${
        MUSEUM_LABELS[a.source]
      } | ${mdCell(a.accession ?? "—")} | ${mdCell(a.license)} | [${
        MUSEUM_LABELS[a.source]
      }](${a.sourceUrl}) |`,
    );
  }
  lines.push("", `Downloaded ${downloadedAt}`, "");
  return lines.join("\n");
}

/** Build the browser download for a request — image for one work, zip for many. */
export async function buildDownload(request: ExportRequest): Promise<DownloadResult> {
  const artworks = (Array.isArray(request.artworks) ? request.artworks : []).slice(0, EXPORT_MAX_WORKS);
  const folderName = slugify(typeof request.folderName === "string" ? request.folderName : "") || "curio-export";
  if (artworks.length === 0) throw new Error("Nothing to export");
  const downloadedAt = new Date().toISOString();

  // Single work → the bare image, so it's a usable backdrop straight away.
  if (artworks.length === 1) {
    const art = artworks[0];
    const data = await fetchImage(art);
    const ext = imageExtension(art.imageHires);
    return {
      filename: `${fileBaseName(art)}.${ext}`,
      contentType: ext === "png" ? "image/png" : "image/jpeg",
      body: Buffer.from(data),
      results: [{ id: art.id, ok: true }],
    };
  }

  // Collection → a zip of images + sidecars + attribution. Failed fetches are
  // recorded and simply left out (a museum 403 shouldn't sink the whole zip).
  const entries: ZipEntry[] = [];
  const results: ExportItemResult[] = [];
  const included: Artwork[] = [];
  const CONCURRENCY = 4;
  for (let i = 0; i < artworks.length; i += CONCURRENCY) {
    const batch = artworks.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (art) => {
        try {
          const data = await fetchImage(art);
          const base = fileBaseName(art);
          entries.push({
            name: `${folderName}/${base}.${imageExtension(art.imageHires)}`,
            data,
          });
          entries.push({
            name: `${folderName}/${base}.json`,
            data: new TextEncoder().encode(sidecarJson(art, downloadedAt)),
          });
          included.push(art);
          results.push({ id: art.id, ok: true });
        } catch (err) {
          results.push({
            id: art.id,
            ok: false,
            error: err instanceof Error ? err.message : "download failed",
          });
        }
      }),
    );
  }

  if (included.length === 0) throw new Error("Every image failed to download");

  entries.push({
    name: `${folderName}/ATTRIBUTION.md`,
    data: new TextEncoder().encode(attributionMarkdown(included, downloadedAt)),
  });

  return {
    filename: `${folderName}.zip`,
    contentType: "application/zip",
    body: createZip(entries),
    results,
  };
}
