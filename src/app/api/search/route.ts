import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enabledSources, searchSources } from "@/lib/adapters";
import { getCategory } from "@/lib/presets";
import { searchQuerySchema } from "@/lib/search-schema";
import type { SourceId } from "@/lib/types";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? undefined;
  const artist = sp.get("artist") ?? undefined;
  const categoryId = sp.get("category") ?? undefined;
  const sourcesParam = sp.get("sources");
  const sources = (
    sourcesParam ? (sourcesParam.split(",") as SourceId[]) : enabledSources()
  ).filter(Boolean);

  if (categoryId) {
    const category = getCategory(categoryId);
    if (!category) {
      return NextResponse.json(
        { artworks: [], errors: [], message: `Unknown category: ${categoryId}` },
        { status: 400 },
      );
    }
    // One SearchQuery — its facets fan out per source inside searchSources.
    const result = await searchSources(sources, category.query);
    return NextResponse.json(result);
  }

  if (!q && !artist) {
    return NextResponse.json({ artworks: [], errors: [] });
  }

  const result = await searchSources(sources, { q, artist });
  return NextResponse.json(result);
}

const postBodySchema = z
  .object({
    query: searchQuerySchema,
    sources: z.array(z.enum(["aic", "cma", "met", "rijks"])).optional(),
  })
  .strict();

/** POST — a full SearchQuery as JSON (interpret mode, chip edits). Same
 *  searchSources fanout as GET; the body is just a richer way in. */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { artworks: [], errors: [], message: "Invalid JSON body" },
      { status: 400 },
    );
  }
  const parsed = postBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { artworks: [], errors: [], message: parsed.error.message },
      { status: 400 },
    );
  }
  const sources = (parsed.data.sources as SourceId[] | undefined) ?? enabledSources();
  const result = await searchSources(sources, parsed.data.query);
  return NextResponse.json(result);
}
