import type { ModelMessage } from "ai";
import type { Attachment, CurioUIMessage, WallContext } from "@/lib/thread/types";

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
  return `[On the wall now: "${wall.heading ?? "untitled"}", ${wall.count} works${more}: ${works}]`;
}

function userText(m: CurioUIMessage): string {
  return m.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("\n")
    .trim();
}

function assistantText(m: CurioUIMessage): string {
  const out: string[] = [];
  for (const p of m.parts) {
    if (p.type === "text" && p.text.trim()) out.push(p.text.trim());
    else if (p.type === "data-search") {
      const d = p.data;
      out.push(
        `[Searched the collections for "${d.query}": ${d.count} works from ${d.museums} museums${
          d.readAs?.length ? `, read as ${d.readAs.join(", ")}` : ""
        }]`,
      );
    } else if (p.type === "data-exhibit") {
      const d = p.data;
      const works = d.artworks.map((a) => `${a.id} · ${a.title} · ${a.artist}`).join("; ");
      out.push(`[Exhibit curated: "${d.title}". Works: ${works}. Note: ${d.note}]`);
    }
  }
  return out.join("\n\n");
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
