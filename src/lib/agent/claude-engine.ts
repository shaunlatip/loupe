import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { enabledSources, getArtworkById, searchSources } from "@/lib/adapters";
import { CURATOR_PROMPT } from "@/lib/agent/prompt";
import {
  VIEW_LIMIT,
  fetchThumbBase64,
  type MuseumToolContext,
} from "@/lib/agent/tools";
import type { Artwork, SourceId } from "@/lib/types";

/**
 * Local curator engine: the Claude Agent SDK. `query()` spawns the `claude`
 * CLI, which resolves auth from the logged-in profile / ANTHROPIC_API_KEY —
 * the cost-effective path when running on your own machine. This module is
 * imported dynamically and only when useClaudeSdk() is true, so the SDK and
 * its subprocess never load on Vercel. Tools mirror the OpenRouter engine's,
 * as an in-process MCP server so the SDK can call them.
 */

/** In-process MCP server exposing the curator's three tools; created per
 *  request so handlers close over this turn's cache + response stream. */
function createMuseumServer(ctx: MuseumToolContext) {
  return createSdkMcpServer({
    name: "museum",
    version: "1.0.0",
    tools: [
      tool(
        "search_artworks",
        "Search museum open-access APIs (CC0/public-domain, has-image only). Returns compact rows: id, title, artist, date, source. Run several variations before presenting.",
        {
          q: z.string().optional().describe("keyword query, e.g. 'nocturne', 'mist', 'still life'"),
          artist: z.string().optional().describe("artist name, e.g. 'Monet'"),
          source: z
            .enum(["aic", "cma", "met", "rijks"])
            .optional()
            .describe("restrict to one museum; omit to search all"),
          yearFrom: z.number().optional(),
          yearTo: z.number().optional(),
          limit: z.number().optional().describe("per-source, default 24"),
        },
        async (args) => {
          const sources: SourceId[] = args.source ? [args.source] : enabledSources();
          const { artworks, errors } = await searchSources(sources, {
            q: args.q,
            artist: args.artist,
            dateRange:
              args.yearFrom !== undefined && args.yearTo !== undefined
                ? [args.yearFrom, args.yearTo]
                : undefined,
            limit: args.limit,
          });
          for (const a of artworks) ctx.cache.set(a.id, a);
          const rows = artworks.map((a) => ({
            id: a.id,
            title: a.title,
            artist: a.artist,
            date: a.date,
            source: a.source,
          }));
          const errNote = errors.length
            ? ` (unavailable: ${errors.map((e) => e.source).join(", ")})`
            : "";
          return {
            content: [
              {
                type: "text" as const,
                text: `${rows.length} results${errNote}\n${JSON.stringify(rows)}`,
              },
            ],
          };
        },
      ),

      tool(
        "view_artworks",
        "Look at actual thumbnail images for up to 8 candidate artwork ids from your search results — use this before present_selection whenever composition matters (calm areas for UI, atmosphere, busyness). Returns each artwork's id/title/artist/date alongside its downsized image.",
        {
          ids: z
            .array(z.string())
            .describe('artwork ids ("source:nativeId") from search_artworks results'),
        },
        async (args): Promise<CallToolResult> => {
          const capped = args.ids.length > VIEW_LIMIT;
          const ids = args.ids.slice(0, VIEW_LIMIT);
          const content: CallToolResult["content"] = [];
          if (capped) {
            content.push({
              type: "text" as const,
              text: `capped to the first ${VIEW_LIMIT} of ${args.ids.length} requested ids`,
            });
          }

          for (const id of ids) {
            let artwork = ctx.cache.get(id);
            if (!artwork) {
              const fetched = await getArtworkById(id).catch(() => null);
              if (fetched) {
                artwork = fetched;
                ctx.cache.set(fetched.id, fetched);
              }
            }
            if (!artwork) {
              content.push({
                type: "text" as const,
                text: `${id}: not found (not from a search result this conversation)`,
              });
              continue;
            }

            const thumb = await fetchThumbBase64(artwork);
            if ("error" in thumb) {
              content.push({
                type: "text" as const,
                text: `${artwork.id} · ${artwork.title} · ${artwork.artist} · ${artwork.date} — image unavailable: ${thumb.error}`,
              });
              continue;
            }

            content.push({
              type: "text" as const,
              text: `${artwork.id} · ${artwork.title} · ${artwork.artist} · ${artwork.date}`,
            });
            content.push({
              type: "image" as const,
              data: thumb.data,
              mimeType: thumb.mimeType,
            });
          }

          return { content };
        },
      ),

      tool(
        "present_selection",
        "Present a curated selection to the user's grid. Call exactly once at the end of every turn with 6-12 artwork ids from your search results and a short curatorial note.",
        {
          artworkIds: z.array(z.string()).describe("ids from search_artworks results"),
          note: z.string().describe("one or two sentences on the selection's through-line"),
        },
        async (args) => {
          const resolved: Artwork[] = [];
          for (const id of args.artworkIds) {
            const cached = ctx.cache.get(id);
            if (cached) {
              resolved.push(cached);
              continue;
            }
            const fetched = await getArtworkById(id).catch(() => null);
            if (fetched) resolved.push(fetched);
          }
          ctx.emit({ type: "selection", artworks: resolved, note: args.note });
          return {
            content: [
              { type: "text" as const, text: `presented ${resolved.length} artworks to the user` },
            ],
          };
        },
      ),
    ],
  });
}

/** Run one curator turn through the Agent SDK, emitting the shared NDJSON
 *  events. Emits its own `done` / `error`; the route owns closing the stream. */
export async function runClaudeCurator(
  message: string,
  sessionId: string | undefined,
  ctx: MuseumToolContext,
): Promise<void> {
  const museum = createMuseumServer(ctx);
  let sid = sessionId;
  try {
    const conversation = query({
      prompt: message,
      options: {
        resume: sessionId,
        systemPrompt: CURATOR_PROMPT,
        mcpServers: { museum },
        allowedTools: [
          "mcp__museum__search_artworks",
          "mcp__museum__view_artworks",
          "mcp__museum__present_selection",
        ],
        tools: [],
        maxTurns: 12,
      },
    });

    for await (const msg of conversation) {
      if (msg.type === "system" && msg.subtype === "init") {
        sid = msg.session_id;
      } else if (msg.type === "assistant") {
        for (const block of msg.message.content) {
          if (block.type === "text" && block.text.trim()) {
            ctx.emit({ type: "text", text: block.text });
          } else if (block.type === "tool_use") {
            ctx.emit({
              type: "status",
              tool: block.name.replace("mcp__museum__", ""),
              input: block.input,
            });
          }
        }
      } else if (msg.type === "result") {
        ctx.emit({
          type: "done",
          sessionId: msg.session_id ?? sid,
          ...(msg.subtype !== "success" ? { error: msg.subtype } : {}),
        });
      }
    }
  } catch (err) {
    ctx.emit({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
}

/** One-shot interpret compile through the Agent SDK — returns the raw model
 *  text; the route extracts + validates the JSON (same as the OpenRouter path). */
export async function interpretRawWithClaudeSdk(
  q: string,
  systemPrompt: string,
): Promise<string> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 45_000);
  try {
    const conversation = query({
      prompt: q,
      options: {
        systemPrompt,
        abortController: abort,
        tools: [],
        allowedTools: [],
        maxTurns: 1,
      },
    });
    let text = "";
    for await (const msg of conversation) {
      if (msg.type === "result") {
        if (msg.subtype !== "success") throw new Error(`agent result: ${msg.subtype}`);
        text = msg.result;
      }
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}
