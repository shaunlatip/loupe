import { tool } from "ai";
import { createSdkMcpServer, tool as sdkTool } from "@anthropic-ai/claude-agent-sdk";
import {
  TOOL_DESCRIPTIONS,
  exhibitInput,
  presentExhibit,
  readAboutWorks,
  readInput,
  reviseExhibit,
  reviseInput,
  searchArtworks,
  searchInput,
  viewArtworks,
  viewInput,
  type MuseumContext,
} from "@/lib/agent/museum";

/**
 * The same five executors (museum.ts), exposed two ways.
 */

/** Hosted engine: AI SDK tools. view_artworks queues its thumbnails on the
 *  context; the route's prepareStep hands them to the model as a follow-up
 *  user message (OpenAI-format tool messages can't carry images reliably). */
export function museumTools(ctx: MuseumContext) {
  return {
    search_artworks: tool({
      description: TOOL_DESCRIPTIONS.search_artworks,
      inputSchema: searchInput,
      execute: (args) => searchArtworks(args, ctx),
    }),
    view_artworks: tool({
      description: TOOL_DESCRIPTIONS.view_artworks,
      inputSchema: viewInput,
      execute: async (args) => {
        const { text, images } = await viewArtworks(args, ctx);
        ctx.pendingImages.push(...images);
        return images.length
          ? `${text}\n(The images follow in the next message, in this order.)`
          : text;
      },
    }),
    read_about: tool({
      description: TOOL_DESCRIPTIONS.read_about,
      inputSchema: readInput,
      execute: (args) => readAboutWorks(args, ctx),
    }),
    present_selection: tool({
      description: TOOL_DESCRIPTIONS.present_selection,
      inputSchema: exhibitInput,
      execute: (args) => presentExhibit(args, ctx),
    }),
    revise_exhibit: tool({
      description: TOOL_DESCRIPTIONS.revise_exhibit,
      inputSchema: reviseInput,
      execute: (args) => reviseExhibit(args, ctx),
    }),
  };
}

export const MCP_TOOL_NAMES = [
  "mcp__museum__search_artworks",
  "mcp__museum__view_artworks",
  "mcp__museum__read_about",
  "mcp__museum__present_selection",
  "mcp__museum__revise_exhibit",
];

/** Local engine: an in-process MCP server for the Claude Code session. Built
 *  on the Agent SDK's own tool() (not the provider's AI-SDK bridge, which
 *  flattens results to text) so view_artworks can return real image blocks. */
export function museumMcpServer(ctx: MuseumContext) {
  return createSdkMcpServer({
    name: "museum",
    version: "1.0.0",
    tools: [
      sdkTool(
        "search_artworks",
        TOOL_DESCRIPTIONS.search_artworks,
        searchInput.shape,
        async (args) => ({
          content: [{ type: "text" as const, text: await searchArtworks(args, ctx) }],
        }),
      ),
      sdkTool("view_artworks", TOOL_DESCRIPTIONS.view_artworks, viewInput.shape, async (args) => {
        const { text, images } = await viewArtworks(args, ctx);
        return {
          content: [
            { type: "text" as const, text },
            ...images.flatMap((img) => [
              { type: "text" as const, text: img.label },
              { type: "image" as const, data: img.data, mimeType: img.mimeType },
            ]),
          ],
        };
      }),
      sdkTool("read_about", TOOL_DESCRIPTIONS.read_about, readInput.shape, async (args) => ({
        content: [{ type: "text" as const, text: await readAboutWorks(args, ctx) }],
      })),
      sdkTool(
        "present_selection",
        TOOL_DESCRIPTIONS.present_selection,
        exhibitInput.shape,
        async (args) => ({
          content: [{ type: "text" as const, text: await presentExhibit(args, ctx) }],
        }),
      ),
      sdkTool("revise_exhibit", TOOL_DESCRIPTIONS.revise_exhibit, reviseInput.shape, async (args) => ({
        content: [{ type: "text" as const, text: await reviseExhibit(args, ctx) }],
      })),
    ],
  });
}
