# Loupe — agent handoff

**Loupe** is a small local tool for a product designer (Shaun Latip) to **search, browse, save, and export open-access (CC0 / public-domain) museum art** for use as design backdrops behind portfolio case studies — the Shopify-Editions / Notion-Mail-hero pattern (an atmospheric painting as a full-bleed ground with crisp UI floating on top). It is deliberately small: **one page, one grid, one panel, one bar.** Density is the enemy — see § Non-goals before adding anything.

Sibling project: **shader-lab** (`~/Documents/Projects/shader-lab`) *generates/edits* textures; Loupe *finds real art*. Don't add image editing here — that's shader-lab's job. Loupe export is bytes-in-bytes-out.

## Run it

```
cd ~/Documents/Projects/loupe
npm run dev      # → http://localhost:4050 (port pinned in package.json)
npx tsc --noEmit # typecheck
```

Node 22, **npm** (not pnpm — pnpm isn't on PATH on this machine). After a dep change or a directory move, `rm -rf .next` before restarting (stale Turbopack manifest → "module is not a function" errors).

Auth: nothing required for manual search or browse categories. The **Claude curator panel** needs Anthropic auth, resolved automatically from `ANTHROPIC_API_KEY` or an `ant auth login` profile (the app never reads a key from code). No `.env` needed to run; see `.env.example`.

## Stack & conventions

Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 (CSS `@theme` in `src/app/globals.css`, no config file) · `@anthropic-ai/claude-agent-sdk` · a few shadcn chat components (`src/components/ui/`, used only by the curator panel) · `zod`.

**Design register — American art museums (Whitney / MFA / Guggenheim): flat, Swiss grid, ZERO border-radius, NO shadows, ink `#0a0a0a` on paper `#fff`, one accent `#2400ff` (active states only), Instrument Sans + Geist Mono, sentence case (never all-caps).** `globals.css` zeroes every `--radius-*` and `--shadow-*` token, so stray `rounded-*`/`shadow-*` utilities render flat — but `rounded-full` bypasses that (watch the shadcn components). Elevation = a 1px ink border, never a shadow. Hover = invert (`.invert-hover`). Labels use `.caption`. `font-mono` only for technical values (accession, license, dims). The shadcn `ui/` components read shadcn semantic tokens (`--color-primary`, `--color-muted-foreground`, etc.) which are mapped to this palette in `globals.css` — if a placeholder/border looks near-white, it's a `text-muted` (surface) vs `text-muted-foreground` (secondary text) mixup.

## Architecture — the one seam that matters

Everything flows through **one `SearchQuery`** (`src/lib/types.ts`) into **`searchSources(sources, query)`** (`src/lib/adapters/index.ts`), a `Promise.allSettled` fanout that round-robin-interleaves and dedupes by id, returning `{ artworks, errors }`. This single function backs **all three** input paths:

1. **Manual search** — free-text `q` + optional `artist` + source checkboxes → `GET /api/search?q=…&artist=…&sources=…`. Raw keyword/artist passthrough to each museum's own index. No interpretation. An **interpret toggle** on the search bar routes the phrase through `POST /api/interpret` (vocab fast path from `src/lib/vocab.ts`, else a one-shot Claude compile, else fallback-as-is) and runs the compiled `SearchQuery` via `POST /api/search` (zod-validated body, same `searchSources` fanout); the compiled facets render as removable chips.
2. **Category chips** (the non-LLM taxonomy) — `GET /api/search?category=<id>` runs one pre-authored `SearchQuery` whose `.facets` carry per-source filter recipes.
3. **Claude curator** — `POST /api/agent` (see below) calls the same `searchSources` via an in-process tool.

### Adapters (`src/lib/adapters/`)

Each implements `SourceAdapter { id, label, enabled(), search(q), getById(id) }` and maps the shared `SearchQuery` to that museum's real params. **CC0/public-domain + has-image is baked into every adapter and is never user-facing.**

- **`aic.ts`** — Art Institute of Chicago (keyless, richest). The **only** source with a queryable art-movement vocabulary. `facets.aic.styleName/subjectName/classificationName/departmentName` are resolved name→id at runtime via `/category-terms/search` (⚠ **must** pass `fields=id,title,subtype` or `subtype` comes back null and everything silently fails to resolve), cached module-level, then applied as extra `query[bool][filter][N][term][<field>_id]` entries (the array form composes; two `query[term]` params collide/400). "Impressionism" → `style_id=TM-7543`.
- **`cma.ts`** — Cleveland (keyless). `facets.cma` → `type`/`technique`/`department`/`culture` (free-text, substring-y) / `created_after`/`created_before`; `facets.cma.q` merges into CMA's `q` param (CMA has no subject facet — the per-source keyword stands in for one).
- **`met.ts`** — The Met (keyless, two-step: `/search` returns objectIDs → hydrate each `/objects/{id}`, capped at 50, concurrency 8, filter `isPublicDomain` post-hydration). `facets.met` → `departmentId`/`medium` (pipe-delim)/`geoLocation`/`dateBegin`+`dateEnd` (pair)/`tags`; `facets.met.q` merges into the query. **Met's public API intermittently 403s (Cloudflare/rate-limit) — non-fatal, lands in `errors[]`.**
- **`rijks.ts`** — Rijksmuseum. **Dormant.** `enabled()` returns false without `RIJKSMUSEUM_API_KEY`, and the classic keyed API's key issuance has been retired (the keyless replacement returns only Linked-Art IRIs needing multi-hop dereferencing — see § Known issues). Removed from the UI source list; adapter kept registered so it re-lights if a key ever returns.
- **`smk.ts`** — Statens Museum for Kunst, Denmark (keyless). CC0/public-domain + has-image baked into the `filters` param. Native hi-res over IIIF (`image_native`), pixel dims, and a `colors[]` hex palette → `Artwork.color` (via `hexToHsl` in `color.ts`), so SMK joins AIC in the color sort. Filter *values* are Danish: `facets.smk` → `objectName` (`object_names:maleri` = painting) / `nationality` (`creator_nationality:hollandsk` = Dutch) / `technique` / `q` (merged into the `keys` search). Date range is filtered client-side (SMK's `range_filters` syntax is unreliable). `getById` via `?object_number=`.
- **`mia.ts`** — Minneapolis Institute of Art (keyless, **unofficial** ES endpoint `search.artsmia.org`). The path segment is a Lucene query; `image:valid AND public_access:1 AND rights_type:"Public Domain"` are ANDed in server-side. `facets.mia` → `classification` (`"Paintings"`) / `department` / `country` / `q`; artist becomes a scoped `artist:"…"` term. Records carry **no** image URL — thumb (`_800`) and hi-res (`_full`) are constructed from `Cache_Location` + `Primary_RenditionNumber` against the live CDN `img.artsmia.org` (the documented `api.artsmia.org` / `iiif.dx.artsmia.org` hosts are dead).
- **`harvard.ts`** — Harvard Art Museums. **Dormant** like rijks — `enabled()` returns false without `HARVARD_API_KEY` (free, form-issued; see `.env.example`). Per-record rights via `imagepermissionlevel=0` (freely reusable). `people` → artist, `colors[0]` → `Artwork.color`, images over IIIF (`images[].iiifbaseuri`). `facets.harvard` → `classification` / `century` / `culture` / `medium` / `q`. 2,500 req/day. Registered but omitted from the UI list until a key lands (add `"harvard"` to `ALL_SOURCES` in `page.tsx`).

### Category taxonomy (`src/lib/presets.ts`)

`CATEGORIES: Category[]` — data only. Each `{ id, label, group, query }` where `group ∈ Movements | Periods | Cultures | Subjects | Media` and `query.facets` sets recipes for the sources it can serve. 20 categories today (`impressionism`, `dutch-golden-age`, `ukiyo-e`, `still-life`, `oil-painting`, …). Rendered grouped by `PresetChips.tsx`. **AIC carries movements/subjects via its real vocabulary; Met/CMA get era+place+media proxies** (museums don't tag movement — only AIC does).

### Claude curator (`src/lib/agent/` + `src/app/api/agent/route.ts`)

`POST /api/agent {sessionId?, message}` streams NDJSON. Uses the Agent SDK `query()` with `resume: sessionId` for cross-turn refinement, an in-process MCP server (`createSdkMcpServer` + `tool`) exposing **`search_artworks`** (→ `searchSources`, returns compact rows, caches full records) and **`present_selection`** (→ pushes a `selection` event to the grid). `allowedTools` restricted to `mcp__museum__*`, built-in `tools: []`. System prompt (`prompt.ts`) carries the art-historical vocabulary. Stream events: `text` / `status` / `selection` / `done{sessionId}` / `error`. The panel (`ClaudePanel.tsx`) is bottom-sticking (a plain scroll container + `scrollIntoView`, **not** the shadcn `MessageScroller` — its "anchored turns" pinned content to the top, which was the streaming-scroll bug).

### Collections & export (`src/lib/collections.ts`, `export.ts` + routes)

JSON-on-disk in gitignored `data/` (`collections.json` stores **full Artwork records**; `settings.json` holds `exportDir`, default `~/Downloads/loupe-exports`). `POST /api/export {artworks?|collectionId?, destDir?}` downloads `imageHires` + a per-work sidecar JSON + a batch `ATTRIBUTION.md`. ⚠ AIC's IIIF server 403s bare Node fetch → `export.ts` sends a browser User-Agent.

## File map

```
src/app/
  page.tsx                  single page — owns all state, wires every component
  layout.tsx globals.css    fonts + @theme design tokens
  api/{search,agent,interpret,collections,export,settings}/route.ts
src/lib/
  types.ts                  Artwork · SearchQuery · SearchFacets · SourceAdapter
  adapters/{index,aic,cma,met,rijks,smk,mia,harvard}.ts
  color.ts                  HSL/HSV/OKLab math + hexToHsl (color sort + picker)
  presets.ts                CATEGORIES taxonomy (misnamed file — it's categories now)
  vocab.ts                  shared vibe vocabulary (curator prompt + /api/interpret fast path)
  search-schema.ts          strict zod mirror of SearchQuery (POST /api/search + interpret)
  agent/{tools,session? ,prompt}.ts   curator MCP tools + system prompt (vocab section rendered from vocab.ts)
  collections.ts settings.ts export.ts
src/components/
  SearchBar FilterRow Dropdown ColorPicker ResultGrid ArtworkCard SourceBadge
  DetailView SaveMenu CollectionsBar ClaudePanel
  ui/                       shadcn chat bits (Bubble, Marker, …) — curator only
```

## Known issues / gotchas

- **Met 403s intermittently** (upstream Cloudflare). Non-fatal. If it worsens, consider caching hydrated objects or a UA header on Met fetches (unverified fix — raw curl also 403s, so it's IP/rate-based).
- **Met `tags=true` search intermittently returns 0 for everything** (observed 2026-07-21: `q=Landscapes&tags=true` → 0 upstream while plain `q` works). Categories using `met.tags` silently lose their Met slice while it lasts. Non-fatal, upstream.
- **AIC's "night" subject terms are empty of public-domain works** (TM-12702 / TM-13355 / TM-8868 all ~0) — a `subjectName:"Night"` facet intersects AIC to nothing regardless of `q`. `nocturne-night` therefore uses full-text `q:"nocturne"` (fixed 2026-07-21; it returns the Whistler nocturnes). The old theory ("top-level q intersects the subject filter") was only half the story.
- **Rijks is dormant** (see adapter note). Re-enabling means either a key (issuance retired) or rewiring to the keyless Linked-Art API — a real mini-project: search returns bare IRIs → dereference each object IRI → its `shows` is *another* IRI → dereference again for the IIIF image; artist/date are nested `produced_by` Linked-Art. Scope separately.
- `presets.ts` is named for the old "presets" concept but now holds `CATEGORIES`. Rename if it bugs you.

## Next steps (the backlog)

1. **Wikidata artist→movement join (the big lever, deferred).** Ships true movement precision to Met/CMA/Rijks (which lack a movement field) by joining results on artist name against a static JSON built once from Wikidata property P135 (CC0). Plan: WDQS SPARQL export (painters with `wdt:P135`) → ~1–3 MB `artist→movements.json` → normalize names (strip accents/parentheticals, "Last, First" ↔ "First Last") → tag/filter hydrated results client-side. Research detail is in the plan file (below).
2. **Wire exports into the actual portfolio** (`~/Documents/Projects/portfolio`) — it has no backdrop-image system yet; putting a chosen ground behind a real case study is fresh work.
3. Rijks keyless rewrite (if Dutch depth is wanted).
4. Rijks color facet was the one native palette-based selection — only on the deprecated keyed API; note if palette-browse is ever desired.

## Non-goals (scope armor)

No auth · no deploy (`npm run dev` is the product) · no database (two JSON files) · **no image editing** (shader-lab's job) · no infinite scroll (one page of ≤50 results = curation, not browsing) · no boards/tags/drag-drop · no portfolio integration inside this repo · no dark mode · no test framework. **Density tripwire: any new feature that adds a second page or third panel must remove something first.**

## Provenance

Origin brief: `~/Downloads/shopify-editions-teardown/` §08 (art sourcing). Plan: `~/.claude/plans/i-want-to-focus-immutable-sky.md`. Built 2026-07-20/21. Verified live: Impressionism→Caillebotte/Monet/Renoir, Ukiyo-e→Hokusai/Hiroshige, Still-life→Chardin/Claesz; curator multi-turn resume working; export produces real hi-res + sidecar + ATTRIBUTION.md.
