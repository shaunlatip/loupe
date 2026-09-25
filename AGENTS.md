# Curio — agent handoff

**Curio** is agent-first search and curation over **open-access (CC0 / public-domain) museum art** from five museums, by a product designer (Shaun Latip), run locally or hosted at **https://loupe-xi.vercel.app** (domain to come: curiosearch.art). One input takes anything, a name, a description or a brief, and the answer lands on one wall: a museum search for a name, a read-and-search for a description, or a small **exhibit** that **Curio** (the agent) curates by searching, actually looking at the works and choosing. Every work downloads at full resolution with attribution. It is deliberately small: **one page, one input, one wall, one thread.** Density is the enemy — see § Non-goals before adding anything.

Sibling project: **shader-lab** (`~/Documents/Projects/shader-lab`) *generates/edits* textures; Curio *finds real art*. Don't add image editing here. Export is bytes-in-bytes-out.

## Run it

```
npm run dev              # the Conductor Run button, or next dev (prints its port)
npx tsc --noEmit         # typecheck
npm run build            # what Vercel runs — do this before pushing to main
npm run eval:router      # score the input router on src/lib/router/cases.json
npm run record:examples  # re-record the homepage examples (needs the dev server + local Claude)
npm run bench:models -- --env <path/.env.local> <model …>   # hosted models end to end (needs npm run build + OPENROUTER_API_KEY; spends real credit)
```

Node 22, **npm** (not pnpm). After a dep change or a directory move, `rm -rf .next` before restarting (stale Turbopack manifest → "module is not a function" errors).

Auth: nothing for search, categories, calm scoring, collections, export or the recorded examples. **Curio** (the agent) and the **describe** route call a model through one of three engines (`src/lib/ai/models.ts`, `curatorEngine()`):

- **`claude`** (default off Vercel): a local Claude Code session on your `claude login`, through `ai-sdk-provider-claude-code`. Locked down to Curio's own tools: no built-in Claude Code tools, no user settings/hooks/CLAUDE.md, `strictMcpConfig` + `ENABLE_CLAUDEAI_MCP_SERVERS=false` so the account's connectors (Gmail, Todoist…) are invisible. Don't loosen that.
- **`openrouter`** (default on Vercel): the AI SDK tool loop over OpenRouter; needs `OPENROUTER_API_KEY`.
- **`gateway`** (opt-in): the same loop over the Vercel AI Gateway (`AI_GATEWAY_API_KEY` or OIDC on Vercel).

`CURIO_LLM_ENGINE=claude|openrouter|gateway` overrides. Models: `CURIO_CURATOR_MODEL` / `CURIO_INTERPRET_MODEL` (comma lists, first is primary), `CURIO_LOCAL_MODEL` / `CURIO_LOCAL_INTERPRET_MODEL` (Claude aliases, default sonnet / haiku). Without a hosted key Curio says it isn't set up and describe searches the words as typed. See `.env.example` and § Deploy.

## Stack & conventions

Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 (CSS `@theme` in `src/app/globals.css`, no config file) · **AI SDK v7** (`ai`, `@ai-sdk/react` `useChat`) with `@openrouter/ai-sdk-provider`, the built-in Gateway and `ai-sdk-provider-claude-code` (+ `@anthropic-ai/claude-agent-sdk` for the in-process MCP server) · `use-stick-to-bottom` (the thread's scroll) · `loading-dev` (Flip / Morph / Gather spinners) · `lucide-react` through `components/Icon.tsx` (1.5 stroke, square caps, miter joins) · `sharp` (via Next, calm analysis) · `zod`. No component library: every control is hand-set in the register below.

**Design register — American art museums (Whitney / MFA / Guggenheim): flat, Swiss 12-column grid, ZERO border-radius, NO shadows, ink `#0a0a0a` on paper `#fff`, one accent `#2400ff` (the primary action, live activity, keyboard focus), Lunchtype + Geist Mono, sentence case (never all-caps), no em dashes in UI copy.** `globals.css` zeroes every `--radius-*` and `--shadow-*` token. Elevation = a 1px ink border. Hover = invert (`.invert-hover`) or the wash stepping to `--color-wash-strong`; cards get a 3px inner ink "mat". Labels use `.caption`; `font-mono` only for technical values; `.tabular` on numbers that update in place.

- **Colour from the art** (`src/lib/tint.ts`): a work's own dominant hue at OKLCH L 0.95–0.96, chroma ≤ 0.018, on the two surfaces a single piece gets: the detail view's wall, and a card's frame before its image lands. Not on the wall label (tried, read as a separate fill). Contrast was checked at the extremes: ink ≥ 16.8:1, `#6b6b6b` ≥ 4.53:1.
- **Motion**: two curves, opacity/transform/filter only, all off under `prefers-reduced-motion`. `.animate-fade` / `.animate-rise` (with `--stagger`), `.animate-pop`, `.skeleton`, `.text-sweep` (shimmering status text), `.animate-focus-pull` (the full-size image arriving), `.register-mark` + `.after-a-beat` (crop marks and loading captions that only a slow load shows). Curio's activity has one vocabulary (`thread/Glyph.tsx`): searching = Flip, looking = Morph, reading = Blocks (rows), curating = Gather.
- **Empty states are content**: the empty wall (`HomeHero`) is the headline, the input, six recorded examples with their works, and Movements/Subjects to browse; the no-results state names the cause with a one-click fix; the empty thread offers the examples.

## Architecture

### One input, four routes (`src/lib/router/`)

Every composer (the hero, the top bar, the thread) submits through `ThreadProvider.submit`, which routes with `classifyRules` (instant, client-side; the button's verb previews it: **Search / Find / Ask**, with a caret for overrides):

- **lookup** — a name, title or plain keyword → the museums' own search (`GET /api/search`), no model.
- **describe** — a short description → literal results first, then `POST /api/interpret` (vocabulary fast path when it covers the whole phrase, else `generateText` + `Output.object`) → the compiled `SearchQuery`, shown as removable chips on the wall label (`src/lib/query-chips.ts`: the reading, deduped, ≤ 6).
- **curate** — a brief that needs judgment → a Curio turn in the thread.
- **refine** — a change to what's on the wall → a Curio turn that knows the wall.

`npm run eval:router` scores the rules on 72 labelled cases (98.6% at last count; the bar is 85%). A question ("who was Hammershøi", "tell me about these", with or without a "?") always goes to Curio, never to a keyword search. `jev.ts` is a Jev (`typesafe-ai/jev` via `experimental_evaluate`) router behind `CURIO_ROUTER=jev`, off by default and untested against the live model; it only goes on if it beats the rules by 5 points with p95 < 250ms.

### The fanout seam

Every search, whoever asks, is **one `SearchQuery`** (`src/lib/types.ts`) into **`searchSources(sources, query)`** (`src/lib/adapters/index.ts`), a `Promise.allSettled` fanout that interleaves and dedupes, returning `{ artworks, errors }`. Each museum gets **10s** to answer; one that misses it is reported as not answering and skipped for 2 minutes (SMK has gone silent for minutes at a time, which used to stall every search and every Curio turn). Lookups by id give up after 8s. **`cachedSearch`** (`src/lib/search-cache.ts`) sits in front for both `/api/search` and Curio's `search_artworks`: in-memory LRU, 6h TTL (2 min for partial results), in-flight dedupe, and a recent-works index by id (`recentArtwork`) so later turns resolve works without asking the museum again.

### Adapters (`src/lib/adapters/`)

Each implements `SourceAdapter { id, label, enabled(), search(q), getById(id) }` and maps the shared `SearchQuery` to that museum's real params. **CC0/public-domain + has-image is baked into every adapter and is never user-facing.**

- **`aic.ts`** — Art Institute of Chicago (keyless, richest). The **only** source with a queryable art-movement vocabulary. `facets.aic.styleName/subjectName/classificationName/departmentName` are resolved name→id at runtime via `/category-terms/search` (⚠ **must** pass `fields=id,title,subtype` or `subtype` comes back null and everything silently fails to resolve), cached module-level, then applied as extra `query[bool][filter][N][term][<field>_id]` entries (the array form composes; two `query[term]` params collide/400). "Impressionism" → `style_id=TM-7543`.
- **`cma.ts`** — Cleveland (keyless). `facets.cma` → `type`/`technique`/`department`/`culture` (free-text, substring-y) / `created_after`/`created_before`; `facets.cma.q` merges into CMA's `q` param.
- **`met.ts`** — The Met (keyless, two-step: `/search` returns objectIDs → hydrate each `/objects/{id}`, capped at 50, concurrency 8, filter `isPublicDomain` post-hydration). `facets.met` → `departmentId`/`medium` (pipe-delim)/`geoLocation`/`dateBegin`+`dateEnd` (pair)/`tags`; `facets.met.q` merges into the query. **Met's API 403s under load (seen for long stretches after bursts of runs) — non-fatal, lands in `errors[]`.**
- **`rijks.ts`** — Rijksmuseum. **Dormant.** `enabled()` is false without `RIJKSMUSEUM_API_KEY`, and key issuance has been retired (see § Known issues).
- **`smk.ts`** — Statens Museum for Kunst (keyless). Native hi-res over IIIF, pixel dims, and a `colors[]` palette → `Artwork.color`. Danish filter values: `facets.smk` → `objectName` / `nationality` / `technique` / `q`. Date range filtered client-side. `getById` via `?object_number=`.
- **`mia.ts`** — Minneapolis Institute of Art (keyless, **unofficial** ES endpoint `search.artsmia.org`). Thumb (`_800`) and hi-res (`_full`) are constructed from `Cache_Location` + `Primary_RenditionNumber` against `img.artsmia.org`.
- **`harvard.ts`** — Harvard Art Museums. **Dormant** without `HARVARD_API_KEY` (free, form-issued). Add `"harvard"` to `ALL_SOURCES` in `page.tsx` once a key lands.

### Category taxonomy (`src/lib/presets.ts`)

`CATEGORIES: Category[]` — data only, `{ id, label, group, query }`. The bar under the input (`FilterRow.tsx`) holds what starts a new query: Movements / Cultures / Subjects / Media as dropdowns at wide widths, folded into one Filters menu as it narrows (container queries), plus Sources. What acts on the works already shown (In these results, Color, Sort) sits at the right of the wall label (`WallTools`). The empty wall offers Movements and Subjects. **AIC carries movements/subjects via its real vocabulary; Met/CMA get era + place + media proxies.** Movements on every record come from the Wikidata join (`src/data/artist-movements.json`, `src/lib/movements.ts`).

### Curio, the agent (`src/lib/agent/`, `src/app/api/agent/route.ts`, `src/components/thread/`)

**Client.** `ThreadProvider` owns `useChat<CurioUIMessage>` (`DefaultChatTransport` → `/api/agent`, sending only text / exhibit / revision / search parts plus the wall and, when the wall is one of Curio's exhibits, that exhibit's part id) so the page never re-renders on a token. Message parts: text, `data-step` (search / look / read / exhibit / revise, updated in place by id), `data-exhibit` (title, note, works, optional per-work `comments`, follow-ups), `data-revision` (an edit to an earlier exhibit, which `onData` applies to that exhibit part in place, and to the wall if it's up; `RevisionCard` shows what changed), `data-search` (a lookup or describe entry). A turn ends in one of three ways: a new exhibit, a revision, or an answer in prose (`Message.tsx` moves the text after the last step out of the folded work group). `status.ts` derives one `CuratorStatus` that every surface reads: the thread's status line, the header pill (`StatusPill`, visible when the thread is closed), "On Curio's table" (`CuratorTable`, the works being looked at, when the thread isn't docked or the wall is empty) and the tab title. The line's text is held ≥ 450ms per change so fast bursts don't blank it. The thread docks at ≥ 80rem (drag to resize, arrow keys, double-click resets; width persists), overlays at ≥ 48rem, and is a sheet below. The sheet sizes to the visual viewport so its input stays above the phone keyboard, and locks the page scroll behind it. When the thread covers the wall (sheet or overlay), "Show on the wall" also closes it, and "On the wall" becomes "See the wall".

**Server.** One route, the engine chosen per request. The five tools are written once in `museum.ts` and narrate themselves as `data-step` parts: **`search_artworks`** (through `cachedSearch`), **`view_artworks`** (≤ 8 thumbnails, per-item states), **`read_about`** (≤ 4 works: the museum's own label text and the artist's note, from `src/lib/about.ts`), **`present_selection`** (the exhibit, with optional comments on a few works), **`revise_exhibit`** (edits the exhibit on the wall in place: comments, title, note). `tools.ts` wraps them as AI SDK tools (hosted) and as an in-process MCP server with image results (local). History goes to the model as text (`history.ts`): exhibits as ids + titles + note + comments, revisions likewise, the wall and attachments as bracketed lines.

**Comments** are optional, one or two short sentences on a single work (under 30 words in the prompt; capped at 220 characters, cut at a sentence). The prompt asks for them on the two to four works Curio wants to point at, leading with the point. At rest a commented work shows a small accent square with a 2px paper rim (so it reads on dark pictures too) in the top right corner of its frame (`ArtworkCard`). On hover (350ms intent, so passing over the wall doesn't set comments off) or keyboard focus the comment opens outside the frame: beside it where the wall has room (right, else left, measured against the grid), else above it (below when the picture is near the top of the window). It's a `CommentCard`: white on the accent, regular weight at 14px with 1.55 leading and generous padding, greyscale antialiasing, the "Curio" label at 70% white (the first version, small semibold on the blue, read as harsh). It floats over the neighbouring cards (`pointer-events: none`, the figure raised while open), so the masonry never moves. The detail view shows the same card under the title, labelled "Curio on this work"; the thread's exhibit strip marks commented works with an accent square. A past exhibit in the thread has a "Show on the wall" button (`WallButton`).

**Museum text** (`about.ts`): AIC `description` / `short_description` (+ style, origin, inscriptions), Cleveland `wall_description` / `description` / `fun_fact` + the creator's biography, Mia's gallery `text`, SMK `labels` (unverified: the API was down when this was written). The Met publishes none. Every work also gets its artist's Wikipedia summary (search fallback for full names Wikipedia doesn't redirect, accepted only with the same surname and a maker's description). Cached 6h. The step's strip shows works with museum text at full strength, the rest dimmed. Earlier exhibits' records are sent back, validated (`artworkFromClient`: ids match their source, image URLs on `MUSEUM_IMAGE_HOSTS`), and consulted before re-fetching, so a follow-up keeps works whose museum won't answer; `present_selection` hands back ids it can't load once, so the note never describes a work that isn't there.

- **Hosted** (`runHosted`): `streamText` with the tools, stopping once an exhibit exists; `prepareStep` feeds viewed thumbnails back as images, and after 38s or step 7 (Hobby's 60s cap) forces `present_selection` if the turn searched and looked, or `toolChoice: "none"` (wrap up in words) if it was working with what's on the wall. A fallback exhibit from what was seen only if the turn ends with no exhibit, no revision and no prose after its last tool call (`ctx.textAfterTool`, noted by the stream filters).
- **Local** (`runLocal`): the Claude Code session (new sessions named up front, resumed by id on follow-ups). It can't be stopped at a tool, so `endAtExhibit` ends the turn once `present_selection`'s result is in the transcript: no recap reaches the visitor, and resume still works.

**Recorded examples.** The six homepage examples (`src/lib/examples.ts`) replay from `public/examples/<slug>.json` through the same components at about a third of real pace (7–10s: prose written out word by word, every step visible for at least 350ms), with zero museum calls; `src/data/examples-index.json` holds three preview thumbnails each. Hover/focus warms the recording and its images. A replayed message is marked recorded; in development builds only it shows "Recorded run · Run it fresh" (a clean live rerun, blind to the wall). Follow-ups go live. Re-record after changing the prompt, tools or examples.

### Detail view (`DetailView.tsx`)

A dialog with ← / → through the wall. The frame reserves the picture's box from the museum's dims or the thumbnail's ratio; the blurred thumbnail holds it while crop marks and "Loading full size W × H" wait (held back 180ms), then the full image pulls into focus once decoded; a failed full image leaves the sharp preview with a caption. Neighbours preload once the current work is sharp. The artist and movement tags attach to the next message; **Ask Curio about this** attaches the work and opens the thread. Below `md` the dialog scrolls as one column: the picture's wall sized to the work at full width (≤ 68svh), then title, comment, the actions, and the catalogue data; a sideways swipe on the picture steps like ← / → (not while pinch-zoomed).

**Phones and touch.** Gutters are 16px below `sm`. Narrow cards (under 15rem, a container query on the caption) drop the swatch and calm score and move the museum beside the artist. Touch-only sizing uses Tailwind's `pointer-coarse:` (taller menu rows and chips, 16px text in inputs so iOS doesn't zoom); `.invert-hover` inverts on hover only where the device can hover, and while pressed on touch. `Dropdown` panels nudge themselves back on screen.

### Collections & export (`src/lib/collections-client.ts`, `export.ts` + route)

Collections are reached from a square Bookmark button beside Curio in the header (`CollectionsMenu`, shown once something is saved): open one on the wall, download it, or delete it. They live in the **browser's localStorage** (full Artwork records) — no server state, which is what lets the app run on a read-only host. `POST /api/export {artworks, folderName?}` streams back one image or a zip of `imageHires` + per-work sidecar JSON + `ATTRIBUTION.md`. Single-work **Download** for AIC is fetched by the browser itself (see § Deploy — AIC egress).

### Calm scoring (`src/lib/calm.ts`, `calm-server.ts`, `calm-client.ts`, `/api/calm`)

Server-side `sharp` decode + a "largest calm rectangle" analysis per work, requested lazily from the grid and cached by id; failures back off for 10 minutes. `GET /api/calm?id&url` fetches server-side (pinned to `MUSEUM_IMAGE_HOSTS`, `src/lib/image-hosts.ts`); `POST /api/calm?id` takes the bytes from the browser for hosts that block datacenter IPs.

## File map

```
src/app/
  page.tsx                  the page: wall state, the four routes' handlers, detail panel
  layout.tsx globals.css    fonts (Lunchtype, Geist Mono) + @theme tokens + motion
  api/{search,agent,interpret,export,calm}/route.ts
src/lib/
  types.ts                  Artwork · SearchQuery · SearchFacets · SourceAdapter
  adapters/*.ts             one per museum + the fanout
  search-cache.ts           cached fanout + recent-works index
  about.ts                  read_about: museum label text + the artist's note
  router/{rules,jev}.ts cases.json   the input router, its eval cases, the Jev candidate
  ai/models.ts              engines, models, labels, LLM error text
  agent/{museum,tools,history,prompt}.ts   Curio's tools, adapters, history, system prompt
  thread/types.ts           CurioUIMessage, data parts, attachments, wall context
  examples.ts example-recordings.ts   homepage examples + recording loader/warmer
  query-chips.ts            a description's reading as removable chips
  tint.ts color.ts          colour from the art; HSL/OKLab math
  image-hosts.ts thumb.ts   museum image host allowlist; small IIIF thumbnails
  presets.ts vocab.ts movements.ts search-schema.ts sort.ts downloads.ts
  collections-client.ts export.ts zip.ts slug.ts calm*.ts source-egress.ts rate-limit.ts
src/components/
  HomeHero FilterRow Dropdown ColorPicker ResultGrid ArtworkCard SourceBadge
  DetailView SaveMenu CollectionsMenu ScrollTopButton Icon
  thread/  ThreadProvider Thread Composer Message Steps ExhibitCard RevisionCard StatusPill
           CuratorTable Glyph Live status phrases
scripts/
  record-examples.mjs eval-router.mjs
```

Interaction notes: `/` focuses the input from anywhere; Backspace in an empty composer removes the last attachment; the wordmark returns to the empty wall; the detail view is a real dialog (focus returns to the opener); **Save** toggles membership; `Dropdown` menus take arrow keys / Home / End; a back-to-top button appears after 1.5 screens of scroll.

## Deploy (Vercel)

The app was called Loupe until September 2026. The Vercel project, production domain, and GitHub repo (`shaunlatip/loupe`) still use the old name; collections saved under `loupe.collections.v1` move to `curio.collections.v1` on first load.

Production is **https://loupe-xi.vercel.app** — project `loupe` in team "Shaun's projects" (Hobby), GitHub-linked: **every push to `main` builds and deploys.** Preview deployments are SSO-protected, so verify on production. Env vars (then redeploy): `OPENROUTER_API_KEY` for Curio/describe (default curator Claude Haiku 4.5 with Gemini 3.1 Flash-Lite as fallback, about $0.03 a turn; chosen with `npm run bench:models`, which runs seven turns per model through the real route on a production build and reports pass/fail, time, comments and spend; `:free` models are rate-limited upstream and unusable for public traffic). **If `CURIO_CURATOR_MODEL` is set on Vercel it overrides the default: remove it or set it to the default.** optional model overrides above; optional `CURIO_LLM_ENGINE=gateway`; optional `HARVARD_API_KEY`. Hobby caps functions at **60s** — raise `maxDuration` only on Pro.

**AIC egress rules** (Cloudflare in front of `www.artic.edu/iiif`): it 403s **any cross-origin Referer** and **any datacenter IP**. So every museum `<img>` carries `referrerPolicy="no-referrer"`; `source-egress.ts` names such hosts and the browser fetches their bytes (calm POST, single-work Download). On Vercel, collection zips skip AIC works, and Curio can't view AIC thumbnails (it still searches and presents them by metadata; the prompt tells it so).

## Known issues / gotchas

- **Met 403s** (upstream Cloudflare, IP/rate based) — for long stretches after bursts. Non-fatal for search; follow-ups keep earlier Met works via the thread's records.
- **Local describe is slow** (12–30s: the Claude CLI starts per request). The wall shows literal results first and swaps in the reading. `CURIO_LLM_ENGINE=openrouter` locally is faster if you have a key.
- **The describe reading can over-constrain** (invented dates or a movement, dropped nouns). The chips make it visible and removable; the interpret prompt is the lever.
- **Met `tags=true` search intermittently returns 0** — categories using `met.tags` lose their Met slice while it lasts.
- **AIC's "night" subject terms are empty of public-domain works** — `nocturne-night` uses full-text `q:"nocturne"`.
- **Rijks is dormant**: re-enabling means a key (issuance retired) or the keyless Linked-Art API (multi-hop IRIs). Scope separately.
- `presets.ts` holds `CATEGORIES` (named for the old "presets" concept).

## Next steps (the backlog)

1. Jev routing once early access and a Gateway key exist (`npm run eval:router -- --jev`).
2. Re-ranking describe results against the phrase (Jev scores, if p95 holds).
3. Wire exports into the portfolio (`~/Documents/Projects/portfolio`).
4. Rijks keyless rewrite, if Dutch depth is wanted.

## Non-goals (scope armor)

No auth · no database (collections are localStorage; the server keeps no state beyond caches) · **no image editing** (shader-lab's job) · no infinite scroll · no boards/tags/drag-drop · no portfolio integration inside this repo · no dark mode · no test framework (the router eval is the one measured check). **Density tripwire: any new feature that adds a second page or third panel must remove something first.**

## Provenance

Origin brief: `~/Downloads/shopify-editions-teardown/` §08 (art sourcing). Built 2026-07-20/21; the agent-first rebuild (one input, the thread, Curio, AI SDK) 2026-09-23/24, planned in `docs/overnight-plan-2026-09-24.md`.
