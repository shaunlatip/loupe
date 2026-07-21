import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { enabledSources, getArtworkById, searchSources } from "@/lib/adapters";
import type { Artwork, SourceId } from "@/lib/types";

export interface AgentStreamEvent {
  type: "text" | "status" | "selection" | "done" | "error";
  [key: string]: unknown;
}

export interface MuseumToolContext {
  /** full Artwork records stashed per search so present_selection can resolve ids */
  cache: Map<string, Artwork>;
  /** pushes an NDJSON event onto the route's response stream */
  emit: (event: AgentStreamEvent) => void;
}

/**
 * In-process MCP server exposing the curator's two tools. Created per request
 * so handlers close over the response stream controller.
 */
export function createMuseumServer(ctx: MuseumToolContext) {
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
          const sources: SourceId[] = args.source
            ? [args.source]
            : enabledSources();
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
            // follow-up turns after resume have a fresh cache — refetch by id
            const fetched = await getArtworkById(id).catch(() => null);
            if (fetched) resolved.push(fetched);
          }
          ctx.emit({ type: "selection", artworks: resolved, note: args.note });
          return {
            content: [
              {
                type: "text" as const,
                text: `presented ${resolved.length} artworks to the user`,
              },
            ],
          };
        },
      ),
    ],
  });
}
