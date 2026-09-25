import type { ModelMessage } from "ai";
import { isMuseumImageUrl } from "@/lib/image-hosts";
import type { Artwork, SourceId } from "@/lib/types";
import type { Attachment, CurioUIMessage, ExhibitData, WallContext } from "@/lib/thread/types";

/**
 * The conversation as the model sees it: plain text, engine-agnostic.
 *
 * Tool calls are dropped from history on purpose. Their results (search rows,
 * thumbnails) were for the turn that made them; what later turns need is what
 * the visitor saw: their words, Curio's prose, and each exhibit's ids. That
 * keeps follow-ups small, lets a turn begun on one engine continue on the
 * other, and lets a replayed example (which has no real tool calls) be
 * continued live.
 */

const WALL_LIMIT = 24;
const ARTWORK_ID = /^[a-z]+:[\w.-]+$/;

export function attachmentLine(attachments: Attachment[] | undefined): string | undefined {
  if (!attachments?.length) return undefined;
  const parts = attachments.map((a) => {
    if (a.kind === "artwork") return `work ${a.id} · "${a.title}" · ${a.artist}`;
    if (a.kind === "artist") return `artist ${a.name}`;
    return `movement ${a.name}`;
  });
  return `[Attached: ${parts.join("; ")}]`;
}

export function wallLine(wall: WallContext | undefined): string | undefined {
  if (!wall || wall.count === 0 || wall.works.length === 0) return undefined;
  const works = wall.works
    .slice(0, WALL_LIMIT)
    .filter((w) => ARTWORK_ID.test(w.id))
    .map((w) => `${w.id} · ${w.title} · ${w.artist}${w.date ? ` · ${w.date}` : ""}`)
    .join("; ");
  const more = wall.count > WALL_LIMIT ? ` (first ${WALL_LIMIT} of ${wall.count})` : "";
  const what = wall.exhibit ? `your exhibit "${wall.heading ?? "untitled"}"` : `"${wall.heading ?? "untitled"}"`;
  return `[On the wall now: ${what}, ${wall.count} works${more}: ${works}]`;
}

function commentsLine(comments: Record<string, string> | undefined): string {
  const entries = Object.entries(comments && typeof comments === "object" ? comments : {}).slice(0, 40);
  if (!entries.length) return "";
  const line = (id: string, c: unknown) => (c ? `${id.slice(0, 80)}: ${String(c).slice(0, 600)}` : `${id}: (removed)`);
  return ` Comments: ${entries.map(([id, c]) => line(id, c)).join(" | ")}.`;
}

/** A visitor's message, or one prose part of Curio's, as the model gets it:
 *  capped, since the history comes from the browser. */
const USER_TEXT_MAX = 2_000;
const ASSISTANT_TEXT_MAX = 4_000;

function userText(m: CurioUIMessage): string {
  return (Array.isArray(m.parts) ? m.parts : [])
    .map((p) => (p.type === "text" && typeof p.text === "string" ? p.text : ""))
    .join("\n")
    .trim()
    .slice(0, USER_TEXT_MAX);
}

function assistantText(m: CurioUIMessage): string {
  const out: string[] = [];
  for (const p of Array.isArray(m.parts) ? m.parts : []) {
    if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
      out.push(p.text.trim().slice(0, ASSISTANT_TEXT_MAX));
    } else if (p.type === "data-search") {
      const d = p.data;
      out.push(
        `[Searched the collections for "${d.query}": ${d.count} works from ${d.museums} museums${
          d.readAs?.length ? `, read as ${d.readAs.join(", ")}` : ""
        }]`,
      );
    } else if (p.type === "data-exhibit" && p.data) {
      const d = p.data;
      const works = (Array.isArray(d.artworks) ? d.artworks.slice(0, 40) : [])
        .map((a) => `${a?.id} · ${a?.title} · ${a?.artist}`)
        .join("; ");
      out.push(
        `[Exhibit curated: "${str(d.title, 200)}". Works: ${works}. Note: ${str(d.note, 2000) ?? ""}${commentsLine(d.comments)}]`,
      );
    } else if (p.type === "data-revision" && p.data) {
      const d = p.data;
      const note = str(d.note, 2000);
      out.push(
        `[Revised the exhibit on the wall, now "${str(d.title, 200)}".${note ? ` New note: ${note}` : ""}${commentsLine(d.comments)}]`,
      );
    }
  }
  return out.join("\n\n");
}

const SOURCES = new Set<SourceId>(["aic", "cma", "met", "rijks", "smk", "mia", "harvard"]);
const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" ? v.slice(0, max) : undefined;
const num = (v: unknown): number | undefined =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined;

/**
 * An artwork record as the browser sent it back (inside an earlier exhibit),
 * rebuilt field by field so nothing but a well-formed record survives: the id
 * must match its source, both image URLs must be on a museum image host (the
 * server fetches thumbnails from them), strings are capped. Only used when the
 * museum itself can't be asked again (see MuseumContext.known).
 */
export function artworkFromClient(raw: unknown): Artwork | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 120);
  if (!id || !ARTWORK_ID.test(id)) return null;
  const [source, nativeId] = id.split(":") as [SourceId, string];
  if (!SOURCES.has(source) || r.source !== source) return null;
  if (!isMuseumImageUrl(r.imageThumb) || !isMuseumImageUrl(r.imageHires)) return null;
  const dims = r.dims as Record<string, unknown> | undefined;
  const color = r.color as Record<string, unknown> | undefined;
  const h = num(color?.h);
  const s = num(color?.s);
  const l = num(color?.l);
  return {
    id,
    source,
    nativeId,
    title: str(r.title, 300) ?? "Untitled",
    artist: str(r.artist, 200) ?? "",
    date: str(r.date, 80) ?? "",
    imageThumb: r.imageThumb,
    imageHires: r.imageHires,
    license: str(r.license, 40) ?? "",
    sourceUrl: str(r.sourceUrl, 500) ?? "",
    accession: str(r.accession, 80),
    medium: str(r.medium, 300),
    dims: dims ? { width: num(dims.width), height: num(dims.height) } : undefined,
    color: h !== undefined && s !== undefined && l !== undefined ? { h, s, l } : undefined,
    movements: Array.isArray(r.movements)
      ? r.movements.filter((m): m is string => typeof m === "string").slice(0, 6).map((m) => m.slice(0, 60))
      : undefined,
  };
}

/** The works of every exhibit earlier in the thread, validated. */
export function exhibitArtworks(messages: CurioUIMessage[]): Artwork[] {
  const out: Artwork[] = [];
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const p of m.parts) {
      if (p.type !== "data-exhibit" || !Array.isArray(p.data?.artworks)) continue;
      for (const raw of p.data.artworks.slice(0, 40)) {
        const a = artworkFromClient(raw);
        if (a) out.push(a);
        if (out.length >= 200) return out;
      }
    }
  }
  return out;
}

/**
 * The exhibit on the wall, found by its data-part id among the thread's
 * exhibits (as the browser holds it, revisions applied), rebuilt from
 * validated records: what revise_exhibit edits.
 */
export function wallExhibitOf(
  messages: CurioUIMessage[],
  partId: string | undefined,
): { id: string; data: ExhibitData } | undefined {
  if (!partId) return undefined;
  for (const m of messages) {
    if (m.role !== "assistant") continue;
    for (const p of m.parts) {
      if (p.type !== "data-exhibit" || p.id !== partId || !Array.isArray(p.data?.artworks)) continue;
      const artworks = p.data.artworks
        .slice(0, 40)
        .map(artworkFromClient)
        .filter((a): a is Artwork => !!a);
      const ids = new Set(artworks.map((a) => a.id));
      const comments: Record<string, string> = {};
      for (const [id, c] of Object.entries(p.data.comments ?? {})) {
        if (ids.has(id) && typeof c === "string" && c) comments[id] = c.slice(0, 600);
      }
      return {
        id: partId,
        data: {
          title: str(p.data.title, 200) ?? "An exhibit",
          note: str(p.data.note, 2000) ?? "",
          artworks,
          followUps: [],
          comments: Object.keys(comments).length ? comments : undefined,
        },
      };
    }
  }
  return undefined;
}

/** Validated artwork ids attached to a message (the route looks them up). */
export function attachedArtworkIds(m: CurioUIMessage | undefined): string[] {
  return (m?.metadata?.attachments ?? [])
    .filter((a): a is Extract<Attachment, { kind: "artwork" }> => a.kind === "artwork")
    .map((a) => a.id)
    .filter((id) => ARTWORK_ID.test(id))
    .slice(0, 8);
}

export function toModelMessages(
  messages: CurioUIMessage[],
  wall: WallContext | undefined,
): ModelMessage[] {
  const out: ModelMessage[] = [];
  const lastUser = [...messages].reverse().find((m) => m.role === "user");

  for (const m of messages) {
    if (m.role === "user") {
      const lines = [
        m === lastUser ? wallLine(wall) : undefined,
        attachmentLine(m.metadata?.attachments),
        userText(m),
      ].filter(Boolean);
      const text = lines.join("\n\n");
      if (!text) continue;
      const prev = out[out.length - 1];
      if (prev?.role === "user" && typeof prev.content === "string") {
        prev.content = `${prev.content}\n\n${text}`;
      } else {
        out.push({ role: "user", content: text });
      }
    } else if (m.role === "assistant") {
      const text = assistantText(m);
      if (!text) continue;
      const prev = out[out.length - 1];
      if (prev?.role === "assistant" && typeof prev.content === "string") {
        prev.content = `${prev.content}\n\n${text}`;
      } else {
        out.push({ role: "assistant", content: text });
      }
    }
  }
  // Providers want the conversation to open with the visitor.
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}
