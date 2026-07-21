import { NextRequest, NextResponse } from "next/server";
import { enabledSources, searchSources } from "@/lib/adapters";
import { getCategory } from "@/lib/presets";
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
