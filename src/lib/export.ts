import { promises as fs } from "fs";
import path from "path";
import type { Artwork, SourceId } from "@/lib/types";
import { getCollection, slugify } from "@/lib/collections";
import { getSettings } from "@/lib/settings";

const MUSEUM_LABELS: Record<SourceId, string> = {
  aic: "Art Institute of Chicago",
  cma: "Cleveland Museum of Art",
  met: "The Met",
  rijks: "Rijksmuseum",
};

export interface ExportItemResult {
  id: string;
  ok: boolean;
  file?: string;
  error?: string;
}

export interface ExportResult {
  dir: string;
  results: ExportItemResult[];
}

export interface ExportRequest {
  artworks?: Artwork[];
  collectionId?: string;
  destDir?: string;
}

function fileBaseName(artwork: Artwork): string {
  const parts = [
    slugify(artwork.artist) || "unknown-artist",
    slugify(artwork.title) || "untitled",
    `${artwork.source}-${slugify(artwork.nativeId)}`,
  ];
  let base = parts.join("--");
  if (base.length > 120) {
    base = base.slice(0, 120).replace(/-+$/, "");
  }
  return base;
}

function imageExtension(url: string): string {
  const pathname = url.split("?")[0].toLowerCase();
  return pathname.endsWith(".png") ? "png" : "jpg";
}

async function downloadArtwork(
  artwork: Artwork,
  dir: string,
  downloadedAt: string
): Promise<ExportItemResult> {
  try {
    const res = await fetch(artwork.imageHires, {
      headers: {
        // Some IIIF servers (AIC) 403 requests without a browser-ish UA.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) loupe/1.0",
        accept: "image/*,*/*;q=0.8",
      },
    });
    if (!res.ok) {
      return { id: artwork.id, ok: false, error: `HTTP ${res.status}` };
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const base = fileBaseName(artwork);
    const file = `${base}.${imageExtension(artwork.imageHires)}`;
    await fs.writeFile(path.join(dir, file), buffer);

    const sidecar = {
      title: artwork.title,
      artist: artwork.artist,
      date: artwork.date,
      museum: MUSEUM_LABELS[artwork.source],
      accession: artwork.accession ?? null,
      license: artwork.license,
      sourceUrl: artwork.sourceUrl,
      imageUrl: artwork.imageHires,
      downloadedAt,
    };
    await fs.writeFile(
      path.join(dir, `${base}.json`),
      JSON.stringify(sidecar, null, 2) + "\n",
      "utf8"
    );
    return { id: artwork.id, ok: true, file };
  } catch (err) {
    const message = err instanceof Error ? err.message : "download failed";
    return { id: artwork.id, ok: false, error: message };
  }
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
      }](${a.sourceUrl}) |`
    );
  }
  lines.push("", `Downloaded ${downloadedAt}`, "");
  return lines.join("\n");
}

export async function exportArtworks(
  request: ExportRequest
): Promise<ExportResult> {
  let artworks = request.artworks ?? [];
  let folderName = "export";

  if (request.collectionId) {
    const collection = await getCollection(request.collectionId);
    if (!collection) {
      throw new Error(`No collection with id "${request.collectionId}"`);
    }
    artworks = collection.artworks;
    folderName = slugify(collection.name) || collection.id;
  }

  if (artworks.length === 0) {
    throw new Error("Nothing to export");
  }

  const destDir = request.destDir ?? (await getSettings()).exportDir;
  const dir = path.join(destDir, folderName);
  await fs.mkdir(dir, { recursive: true });

  const downloadedAt = new Date().toISOString();
  const results: ExportItemResult[] = [];
  const CONCURRENCY = 3;
  for (let i = 0; i < artworks.length; i += CONCURRENCY) {
    const batch = artworks.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map((a) => downloadArtwork(a, dir, downloadedAt))
    );
    results.push(...settled);
  }

  await fs.writeFile(
    path.join(dir, "ATTRIBUTION.md"),
    attributionMarkdown(artworks, downloadedAt),
    "utf8"
  );

  return { dir, results };
}
