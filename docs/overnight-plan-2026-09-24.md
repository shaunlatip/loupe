# Curio: overnight plan

Drafted 2026-09-24 in the `cape-town` workspace, branch `shaunlatip/run-local-agentation`.
This is a plan of attack for one unattended run. Nothing in it has been built yet.

---

## 0. What we are building toward

Curio started as a quick way to find Dutch Golden Age paintings for UI backdrops. What no public tool does, and what Curio can, is an agent that searches five museums, **looks** at the candidates, reviews its own picks and hangs a set with a personal note, the way someone would walk you through a museum. Backdrops stay supported. The headline is curation and looking at art.

The site should make that obvious the moment it opens.

Principles for every decision below:

1. **One input.** The user never picks a search mode. Curio decides, shows what it decided, and offers an override.
2. **One thread.** Searches, curator turns, attachments and selections are entries in one thread. The wall shows the current set.
3. **Visible work.** Every wait says what is happening, using one step vocabulary and one set of animations.
4. **Fast first impression.** Examples and presets resolve instantly.
5. **The museum register holds.** Flat, zero radius, ink on paper, one accent (`#2400ff`), Lunchtype, sentence case, no em dashes in UI copy, motion under 250ms except where noted.

---

## 1. Decide before the run (the default applies if unanswered)

| # | Decision | Default |
|---|---|---|
| D1 | Thread-first layout (§3) vs today's search bar plus drawer | Thread-first |
| D2 | Example set (§10) | The six in §10 |
| D3 | Hosted curator model on the AI Gateway | Stay on the current family (`google/gemini-2.5-flash-lite`) for cost; measure `gemini-2.5-flash` as an upgrade and report |
| D4 | Keys: `AI_GATEWAY_API_KEY` in `.env.local` (to test the hosted path locally) and Jev early access | Without them the hosted path is typechecked only and Jev stays off |
| D5 | Icon library | Lucide (already a dependency, unused), wrapped for square caps and 1.5 stroke |
| D6 | loading.dev **Morph** rounds a square into a circle, an exception to zero radius | Allowed, motion only |
| D7 | Recorded example runs: labelled or silent | Labelled: "Recorded run · Run it fresh" |
| D8 | Sort moves from the filter row into the wall label row | Yes |
| D9 | Filter button style (comment: "intermediate, not outlined, not black") | Wash fill, no border, ink text; active = ink fill |
| D10 | Permissions for an unattended run | Shaun runs the installs in §2 before leaving and keeps the session in bypass mode. `npm install` and `npx` prompt otherwise and would stall the run |
| D11 | Second colour tier (§8): wall colours derived from each set, as flat fields only | Yes: wall label band and detail surround; homepage example cards on hover only |
| D12 | "On the curator's table" band on the wall during a turn (§7.3) | Yes |
| D13 | Where the working status shows while the thread is closed (§7.1) | The Curator control becomes a status pill, plus the tab title |
| D15 | The result metaphor: "hung" / "hanging" / "on the wall" | **Replaced by curating an exhibit.** The step reads "Curating the exhibit"; the result is "the exhibit"; done reads "✓ Curated an exhibit of 12 works"; the kept/passed reveal becomes "made the exhibit"; phrases say "Arranging the exhibit" and "Writing the exhibit text". "Wall" stays an internal code term only. Applies to every place this plan says hung, hang, hanging or "on the wall" in UI copy |
| D14 | Naming: product and agent share one name | **Curio everywhere.** The agent *is* Curio: "Ask Curio", "Curio looked at 16 works". "Curator" survives only as a descriptor in the tagline ("A curator for five museums' open collections") and as a verb ("curated"). Wherever this plan shows "Curator" as a UI label (header control, thread header, status pill), read "Curio". The domain stays `curiosearch.art`, already bought and attached to the Vercel project. Internal code names (`curator` engine, `CURIO_CURATOR_MODEL`) can stay. **Acceptance:** a grep of user-facing strings finds no "Curator" used as a name, and no "the curator" |

---

## 2. Pre-flight (15 min)

1. **Merge `origin/main`.** It carries the Loupe → Curio rename (`84e2111`). A dry run (`git merge-tree`) reports no conflicts. After the merge, env vars are `CURIO_*` and the UI name is Curio. Use Curio everywhere below.
2. **Dependencies.** Shaun runs this before leaving:
   ```
   npm install ai@7 @ai-sdk/react ai-sdk-provider-claude-code use-stick-to-bottom loading-dev @anthropic-ai/claude-agent-sdk@0.3.278
   ```
   - `ai@7.0.113` bundles `@ai-sdk/gateway`.
   - `ai-sdk-provider-claude-code@4.3.2` pins the Agent SDK at `0.3.278`; we have `^0.3.259`. The bump dedupes them.
   - `loading-dev@0.3.4` is MIT and needs React 19; we're on 19.2.
   - `use-stick-to-bottom@1.1.6` is MIT.
3. **Dev server.** Start one on the workspace port and stop it (TaskStop) at the end of the run. Keep the agentation server on :4747 running; its comments live only in memory, so §13 keeps a condensed copy.
4. **Baseline screenshots** saved to `.context/overnight/before/`:
   - States: empty home, results (`nocturne`), detail, curator empty, curator mid-turn, curator done.
   - Widths: 375, 768, 1024, 1280, 1440, 1680.

---

## 3. Workstream A: Thread-first layout and homepage (D1)

The core change. Today the curator hides behind a header button and a drawer, and the search bar offers two modes. Target: **one composer, one thread, one wall.**

### Empty state, desktop (≥1024)

Keep the screen focused: one headline, one input, one set of examples. Keep what already works on today's page:
- the "Public-domain paintings…" headline;
- the "Every result is CC0…" line;
- blue on the one primary action only;
- Movements and Subjects as secondary suggestions;
- the cited sources;
- the links to Shaun's site and GitHub.

Drop the Keys section and any "how it works" line.

```
 1    2    3    4    5    6    7    8    9  │ 10   11   12      ← 12-col grid, 24px gutters
┌──────────────────────────────────────────┼─────────────────────────┐
│ curio                                    │ Open-access museum art  │
│                                          │ · by Shaun Latip ·      │
│                                          │ GitHub       [Curator]  │
│══════════════════════════════════════════╪═════════════════════════│
│                                          │                         │
│ Public-domain paintings from five        │ Sources                 │
│ museums' open collections.   (1–7)       │ Art Institute of        │
│                                          │   Chicago               │
│ Ask for an artist, a mood, or something  │ Cleveland Museum of Art │
│ stranger. Every result is CC0 or public  │ The Met                 │
│ domain and downloads at full resolution  │ Statens Museum for      │
│ with attribution.            (1–6)       │   Kunst                 │
│                                          │ Minneapolis Institute   │
│ ┌──────────────────────────────────────┐ │   of Art                │
│ │ Hokusai, fog over water, cats with   │ │                         │
│ │ opinions…                  [■ Ask ■] │ │ Every work is CC0 or    │
│ └──────────────────────────────────────┘ │ public domain.          │
│   (1–9; Ask is the only accent fill)     │                         │
│                                          │                         │
│ Try                                      │                         │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐   │                         │
│ │ ▢ ▢ ▢    │ │ ▢ ▢ ▢    │ │ ▢ ▢ ▢    │   │                         │
│ │ Cats with│ │ The most │ │ Tiny     │   │                         │
│ │ opinions │ │ dramatic │ │ people,  │   │                         │
│ └──────────┘ └──────────┘ └──────────┘   │                         │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐   │                         │
│ │ …        │ │ …        │ │ …        │   │                         │
│ └──────────┘ └──────────┘ └──────────┘   │                         │
│   (3 cols each; 1px ink border, invert on hover)                   │
│                                          │                         │
│ Or browse                                │                         │
│ Movements  [Impressionism] [Post-impressionism] [Dutch Golden Age] │
│            [Baroque] [Romanticism] [Realism] [Ukiyo-e]             │
│ Subjects   [Landscape] [Seascape] [Still life] [Portrait] [Night]  │
│   (light chips: the D9 filter style, wash fill; tertiary weight)   │
└──────────────────────────────────────────┴─────────────────────────┘
```

**Hierarchy by weight:**
1. The Ask button is the only accent fill on the screen. It replaces the standalone "Ask the curator" button added in `8cb6ecc`.
2. Example cards: ink border.
3. Browse tags: wash chips.
4. Sources: caption text.

**Grid (the existing Swiss structure, made explicit).**
- Container: `max-w-[1440px] px-6`, as today.
- At 1024 and above, a 12-column CSS grid with 24px gutters, defined once as a utility (`.grid-12`) and used by the header, the empty state, the wall label and the toolbar, so their left edges line up.
- Content block: columns 1–9. The rule and sources rail: columns 10–12, with the 1px ink rule on the rail's left edge (as today's `md:border-l`).
- The header uses the same split: the wordmark over columns 1–9, then tagline, links and Curator over 10–12. The rule under the header runs the full width.
- Below 1024: one column. The rail moves under the browse tags as a caption paragraph. The example cards become a horizontal scroll row (snap, 260px cards).
- **Acceptance:** at 1440, the left edges of the wordmark, headline, composer, first card and "Or browse" line up to the pixel. Check computed `x` in `/browse`.

**Copy:**
- Tagline (header, rail column): "Open-access museum art, curated by an agent". It replaces "for design backdrops" (comment #3).
- The "by Shaun Latip · GitHub" links stay exactly as they are.

### After the first send, desktop (≥1280)

While the curator works (thread open):

```
┌──────────────────────────────────────────────╫─────────────────────┐
│ curio                                        ║ Curator  Sonnet · local ⟲ × │
│ [Filters ▾] [Sources · 5 ▾] [Color ▾]        ║ ◇ Looking at 8 works   0:14 │  ← status line (§7.1)
│──────────────────────────────────────────────║─────────────────────│
│ On the curator's table                  0:14 ║  you: cats with …   │
│ ▢  ▢  ▣  ▢  ▢  ▢  ▢  ▢   ← the 8 it is       ║  ▾ Working          │
│                            looking at now    ║    ⌕ Searched “cat” │
│                            (§7.3)            ║      [1700–1900]    │
│──────────────────────────────────────────────║      [86 works] ▫▫▫ │
│ (previous wall, dimmed)                      ║    ◇ Looking at 8   │
│ ▢ ▢ ▢ ▢                                      ║      ▢▢▣▢▢▢▢▢       │
│ ▢ ▢ ▢ ▢                                      ║                 (◇) │  ← jump button, Morph
│                                              ║ ┌─────────────────┐ │
│                                              ║ │ Refine…   [Stop]│ │
│                                              ║ └─────────────────┘ │
└──────────────────────────────────────────────╨─────────────────────┘
                                               ↑ drag handle (§7.4)
```

After the set is hung:

```
┌──────────────────────────────────────────────╫─────────────────────┐
│ curio                                        ║ Curator ✓ Hung 12 works · 38s │
│ [Filters ▾] [Sources · 5 ▾] [Color ▾]        ║─────────────────────│
│──────────────────────────────────────────────║  ▸ Worked for 38s   │
│ Cats with opinions                           ║    [4 searches]     │
│ "I went looking for cats that…"              ║    [16 looked at]   │
│ [12 works] [4 museums]            Sort ▾     ║    [12 kept]        │
│──────────────────────────────────────────────║  ▢▢▢▢▢▢▢▢ +4        │
│ ▢ ▢ ▢ ▢                                      ║  "I went looking…"  │
│ ▢ ▢ ▢ ▢           (the wall)                 ║  [warmer] [no dogs] │
│                                              ║ ┌─────────────────┐ │
│                                              ║ │ ▢ attached work │ │
│                                              ║ │ Refine…   [Ask] │ │
│                                              ║ └─────────────────┘ │
└──────────────────────────────────────────────╨─────────────────────┘
```

With the thread collapsed, the Curator control in the header carries the same status (§7.1):
- working: `[◇ Looking at 8 works · 0:14]`
- finished while you weren't watching: `[■ 12 works hung · Open]`

- The top search bar goes away. Its job moves into the composer plus the router (§4).
- A lookup ("Hokusai") still fills the wall instantly with no LLM call, and adds one compact thread line: `Searched “Hokusai” · 128 works`.
- Filters and Sort belong to the wall, not the header.
- **The curator always receives the wall state.** That means the heading, count and first 24 ids with titles, as text only. So "narrow these to landscapes" works after a plain search. This is what makes the thread one conversation rather than two tools.
- **Transition.** The empty-state column moves into the docked column (transform and opacity, 240ms, `--ease-in-out`). No layout jump for the wall.

### Mobile (<768)

The wall is the main view. The thread is a full-height sheet opened from a sticky composer bar at the bottom. The example cards scroll horizontally in the empty state.

### Copy

- **Headline:** keep "Public-domain paintings from five museums' open collections."
- **Body:** "Ask for an artist, a mood, or something stranger. Every result is CC0 or public domain and downloads at full resolution with attribution." The first sentence replaces the Keyword/Interpret instructions.
- **Placeholder:** "Hokusai, fog over water, cats with opinions…" (comment: make it broader and invite interpretive queries).

### Build order

1. Extract `HomeHero`, `Thread`, `Wall` and `WallToolbar` out of `page.tsx` (about 1,000 lines) with no visual change, and commit.
2. Then change the layout.

If the layout change breaks more than two flows, revert to the extraction commit and continue with the other workstreams.

### Acceptance

- At 1440×900 the composer and the first row of examples are above the fold, and there is one obvious primary action.
- The layout transition animates only transform and opacity.
- Screenshots at every width in §9.

---

## 4. Workstream B: Router and one input

Module `src/lib/router/`:

```ts
classify(query, ctx) → { route: "lookup" | "describe" | "curate" | "refine", confidence, source: "rules" | "jev" }
```

### Rules (ship first)

- **lookup:**
  - a match in `src/data/artist-movements.json` (11,308 name keys, both "claude monet" and "monet, claude"), or
  - an exact match on a category or vocabulary label, or
  - three words or fewer with no descriptive cue.
- **refine:** the thread already has a wall and the message opens with a refinement cue (warmer, cooler, more, less, only, without, just, swap, remove, these, this one), or has attachments.
- **curate:**
  - cue words or phrases: set of, pick, choose, best, most, rank, compare, sequence, in order, why, "like X but Y", "for a …"; or
  - seven or more words; or
  - a question.
- **describe:** everything else.

### Surface (the "elegant Auto" from the comments)

- The submit button's verb follows the route live, recalculated 150ms after typing stops: **Search** (lookup), **Find** (describe), **Ask** (curate or refine).
- A small caret beside it opens overrides: "Let Curio decide" (default), "Search exactly", "Interpret", "Ask the curator".
- The user never has to choose, but can always see and change what will happen.

### Routes

- **lookup** → the existing keyword fanout.
- **describe** → interpret compile via `generateObject` after §5, before that the current route.
  - Show the compiled facets as removable chips in the wall label.
  - Add a "Search exactly “…” instead" link.
- **curate / refine** → a curator turn in the thread, sending the wall state and attachments.

### Fix the vocabulary shortcut

Use the vocabulary fast path only when the matched aliases cover the whole phrase, stopwords aside.

Today "a lonely lighthouse on a stormy coast, cold palette" matches the `storm` entry, and the search becomes `storm` alone. "Lighthouse" and "cold palette" are silently dropped.

### Evaluation

- `src/lib/router/cases.json`: 60 labelled queries. Include traps: "Hammershøi" (lookup), "Hammershøi, but outside" (curate), "monet mist" (describe), "warmer" with a wall (refine).
- `scripts/eval-router.mjs` prints a confusion matrix and lists every miss.
- **Acceptance:** rules ≥ 85% accuracy.

---

## 5. Workstream C: AI SDK migration that keeps the local Agent SDK

### Why

Two engines and a bespoke protocol today:
- `openrouter-engine.ts` (169 lines) and `claude-engine.ts` (277 lines);
- a hand-rolled NDJSON stream, with about 150 lines of parsing in `ClaudePanel.tsx`;
- on Vercel, conversation history lives in an in-process `Map`, so a cold instance forgets the thread.

### Target

```
useChat  (UIMessage[] live on the client, so history survives cold starts and replays)
  │  POST /api/agent { messages, wall, attachments }
  ▼
createUIMessageStream ─ streamText({ model, system, messages, tools?, stopWhen, prepareStep, abortSignal })
  │
  ├─ local  (CURIO_LLM_ENGINE=claude, default off Vercel)
  │     claudeCode("sonnet", { mcpServers: { museum: museumMcpServer(ctx) } })   ← your `claude login` subscription
  │
  └─ hosted (default on Vercel)
        gateway(CURATOR_MODEL) + aiSdkTools(ctx)                                ← OIDC on Vercel, no key
  │
  ▼
tools.ts executors (shared) ── writer.write({ type: "data-step" | "data-selection", id, data }) ──▶ UI parts
```

`ai-sdk-provider-claude-code` **does not accept AI SDK tools** (zod tools passed to `streamText`), only MCP servers. The local engine already wraps our three tools in an in-process MCP server (`createSdkMcpServer` in `claude-engine.ts`), so we keep that and share the executors. The executors write their own `data-step` parts, so the tool rows look the same on both engines.

### C0 spike (timebox 60 min). Go or no-go on four questions

1. With the provider and an in-process MCP server, do our executors run in our process, so they can write data parts?
2. Does the provider take multi-turn `messages` (history held on the client)?
3. Does image content returned from the MCP tool reach the model (`view_artworks`)?
4. Does `abortSignal` stop the CLI subprocess?

**If 1 or 3 fails:** keep `claude-engine.ts` for local runs, wrapped so it emits UI message parts. Move the hosted path and the UI to the AI SDK anyway. The client protocol is unified either way.

### Steps (one commit each)

- **C1** `src/lib/ai/models.ts`: `curatorModel()` and `interpretModel()` per engine. Env: `CURIO_LLM_ENGINE`, `CURIO_CURATOR_MODEL`, `CURIO_INTERPRET_MODEL`.
- **C2** Tool adapters.
  - `aiSdkTools(ctx)`: `tool({ inputSchema: z…, execute })`, plus `toModelOutput` for `view_artworks` images. Verify the exact media part name in v7.
  - `museumMcpServer(ctx)`: moved out of `claude-engine.ts`.
- **C3** Route rewrite with `createUIMessageStream` / `createUIMessageStreamResponse`. Data parts:
  - `data-step {id, kind, phase, label, meta}`, updated in place by id;
  - `data-selection {artworks, note, followUps}`.
- **C4** `prepareStep` budget. At the last allowed step, or once elapsed time passes the budget (about 40s hosted), force `toolChoice: { type: "tool", toolName: "present_selection" }`. This replaces the hosted "safety net" selection.
- **C5** Client: `useChat` with `DefaultChatTransport`, using `prepareSendMessagesRequest` to add the wall state and attachments. The panel renders `message.parts` in the museum register (§7).
- **C6** Interpret via `generateObject` with the existing `searchQuerySchema`. This removes `extractJson` and parse failures.
- **C7** Delete `openrouter-engine.ts`, `claude-engine.ts` (if the spike passes), the NDJSON parser, and most of `llm.ts`. Update AGENTS.md.

### Hosted performance levers

- AI Gateway model plus fallbacks (D3). One vendor instead of OpenRouter, with spend and latency visible in the Vercel dashboard.
- When the model issues several searches in one step, they run concurrently.
- `view_artworks` thumbnails at 512px with a per-instance LRU cache. Drop AIC from the hosted shortlist at the tool level: Vercel's IPs are blocked by AIC, so the model can't see them there.
- `smoothStream()` so prose reveals evenly rather than in blocks.
- The search result cache (§10) is shared by the curator tool and `/api/search`.
- A time-based step budget (C4) rather than a count.

### Local performance

The provider still starts the Claude CLI per request. That took about 11.7s for interpret, measured 2026-09-23.

Option: `CURIO_LOCAL_FAST=1` sends local interpret and routing through the Gateway with an API key, while the curator stays on the subscription. Off by default.

### Verification

- **Local:** a full turn with attachments; a follow-up that refers to the previous turn; Stop mid-turn; a forced error.
- **Hosted path, locally:** with `CURIO_LLM_ENGINE=gateway`, if D4's key exists.
- **Production:** only after Shaun merges. Preview deployments are SSO-walled.

---

## 6. Workstream D: Jev

Jev is TypeSafe's "System One" model. It returns a choice (up to 255 options), a score or a yes/no answer, in about 100ms. It is text only and generates no text. It's available through the Vercel AI Gateway as `typesafe-ai/jev`, with a JS SDK and AI SDK integration, and it's in early access.

- **Adapter:** `src/lib/router/jev.ts` implements `classify`.
  - Enabled by `CURIO_ROUTER=jev`, and only when a key exists.
  - Falls back to the rules on a 300ms timeout or confidence below 0.6.
- **Questions, in one request:**
  - a Choice between the four routes;
  - a yes/no: "Does this refer to the works currently on the wall?" (refine detection).
  - The context sent to Jev is text only: the query, the wall heading, and the last curator note.
- **P2, re-ranking:** score each describe-route result's metadata against the phrase, as several questions in one request. Only if p95 stays under 300ms for 48 works.
- **Not for:**
  - compiling queries, which needs generated values like "lighthouse" or year ranges;
  - curator prose;
  - judging images.
- **Evaluation:** the same `cases.json`, reporting accuracy and p50/p95 latency for rules vs Jev.
- **Default on** only if Jev beats the rules by 5 points or more with p95 under 250ms.

---

## 7. Workstream E: The thread, rebuilt on AI Elements patterns

AI Elements (elements.ai-sdk.dev) is shadcn-style copy-in code: shadcn tokens, rounded and shadowed. The CLI (`npx ai-elements add`) prompts during an unattended run, so **copy source from github.com/vercel/ai-elements by hand**, strip the tokens, and restyle to the register. `@shadcn/react` and `radix-ui` are already installed but unused.

### Audit: what we hand-built vs the pattern that already exists

| Part | Ours today | AI Elements | Risk in ours | Plan |
|---|---|---|---|---|
| Scrolling | `scrollIntoView` on every turn change | Conversation: `use-stick-to-bottom` and a scroll button | Pulls readers down while they read earlier turns | Use `use-stick-to-bottom`; our own button (below) |
| Work in progress | Flat rows, each with a dot | Chain of Thought: steps with complete/active/pending status, result badges and images; Task | Two strings glued together ("Looking at 8 works · looked at 8"), repeated identical rows, misaligned dot (comment), dots everywhere (comment), no grouping | New step vocabulary (below) |
| Waiting line | "Working 0:12" pulses at the bottom, even while a step is also animating | Reasoning: "Thinking…" becomes "Thought for N seconds", opens while running and collapses when done | Two animated lines at once; detached from the work it describes | One live indicator with phase phrases (§7.2); timer in the status line (§7.1); "Worked for 38s" when done |
| Prose | Regex for `*` and `**`; each text block starts a new turn | Message plus Streamdown (streaming markdown, tolerates half-finished markdown) | Lists and links render as raw text; text arrives in lumps | `smoothStream` and a small markdown subset (Streamdown restyled if it stays lightweight) |
| Composer | Textarea, chip row outside it, fixed 2 rows, text "Send" | PromptInput: attachments in a header *inside* the box, auto-sizing textarea, one submit button whose icon shows the status | Chips outside the box (comment) | Copy the structure: header (attachments), textarea 2–8 rows, footer (submit/stop icon) |
| Attachments | Horizontal chips, truncated titles, no preview | Attachments, inline variant, with a hover preview card | Can't see what's attached; wide chips overflow | Stacked vertically inside the box (comment), 32px thumb plus title and artist, 160px hover preview, Backspace in an empty box removes the last one |
| Attachment types | Artworks only | n/a | Comment: "make the name, and tag, attachable" | Typed references: artwork, artist, movement tag, collection, current wall. Clicking an artist or tag in the detail view attaches it |
| Sent message attachments | Thumbnails above the message | Attachments, grid variant | Fine | Clicking a thumbnail opens the detail view |
| Selection | Thumbnail strip, note, "Show these on the wall" | No direct equivalent | Unclear which set is on the wall | Bespoke; add follow-up suggestions (below); label the current set "On the wall" |
| Suggestions | Empty-state list | Suggestion | Only at the start | Also after each selection: 2–3 refinements from the model |
| Errors | One red row with Try again | Tool: errors expand automatically | One treatment for every kind of failure | Error table below |
| Header | "Curator claude", misaligned (comment); text "New" (comment) | n/a | Doesn't name the model | Friendly model name ("Claude Sonnet · local") aligned on the baseline; reset icon button with a tooltip |
| Stop | A Stop text button replaces Send | PromptInputSubmit status icons | Fine | Square stop icon in the same slot |

**Not adopting:** Tool's JSON input/output view (developer-facing), branching, checkpoints, Image (generated images only).

**Later (P2):** Queue, to accept a message while the agent works.

### Step vocabulary

- **A turn's work is one group.**
  - Running: a static "Working" header, group expanded. No shimmer and no timer here: the one animated line is the running step or the thinking line (§7.2), and the timer lives in the status line (§7.1).
  - Done: collapses to "Worked for 38s" with quiet chips `[4 searches] [16 looked at] [12 kept]`.
  - Errors force the group open.
- **Anatomy of a step:** `[12px glyph] [label] [meta chips]`.
  - The glyph box is exactly one line high and centred, which fixes the optical-centring comment.
  - Glyph per kind: search = magnifier, look = eye, hang = frame.
  - While running, the glyph is replaced by that kind's loading.dev spinner at 12px, using the same mapping as the floating button.
- **One label that changes tense, never two strings joined:**

| Kind | Running | Done | Meta chips |
|---|---|---|---|
| search | Searching for “vanitas” | Searched “vanitas” | `[1600–1720] [27 works]`. `[The Met]` only when restricted; omit when all museums. Partial failure: `[Mia didn't answer]` in destructive outline. Zero: `[nothing matched]` in muted text |
| look | Looking at 8 works | Looked at 8 works | The thumbnails are the content. They fade in as each arrives; clicking one opens the detail view; a failed image is a hatched square with the tooltip "Couldn't load this image" |
| hang | Hanging 12 works | (no row) | The selection card appears in its place |
| thinking | Thinking (shimmer) | (gone) | Only shown while no text and no tool are running |

- **Merging:** consecutive steps of the same kind merge: "Looked at 16 works" with two strips.
- **Years:** en-dash ranges ("1600–1720"), "after 1850", "before 1700".

### Error vocabulary

| Kind | Example | Shown | Action |
|---|---|---|---|
| Partial source | SMK didn't answer | Chip on the search step | None; hover explains |
| Tool failed | Thumbnails didn't load | The step shows an error and the group opens | None; the turn continues |
| Turn failed | Network or model error | Error block after the steps | Retry (resends attachments) |
| Cut short | Step or time budget reached | "Stopped early, here's what I had" on the selection | Continue |
| Limited | Rate limit, not configured | Plain explanation | No retry button when unconfigured |
| Stopped | User pressed Stop | "Stopped." | Retry |

### Floating button (Shaun's spec)

- **Placement:** centred on the bottom edge of the transcript, just above the composer.
- **Visibility:** shown only when the reader isn't at the bottom (from `use-stick-to-bottom`'s state).
- **Idle:** arrow-down icon.
- **While the agent works:** the loading.dev spinner for what it's doing *right now*:
  - searching → **Flip** ("a square flipping over on one axis, then the other": flipping through the drawers);
  - looking → **Morph** ("a square rounding into a circle and back": the loupe coming into focus; see D6);
  - hanging → **Gather** ("four blocks pulling together, turning, and pushing apart": a set coming together);
  - thinking or writing → **Flip** at 1.5× duration.
- **Look:** 36px square, paper fill, 1px ink border, crossfade 150ms between spinners.
- **Accessibility:** `aria-label` "Jump to latest", or "Jump to latest, looking at 8 works" while working.
- **Reduced motion:** a static icon.
- **Click:** smooth scroll to the bottom and re-attach to it.

### 7.1 One status, shown in three places

A single hook, `useCuratorStatus(messages, chatStatus)`, derives what the agent is doing from the stream: the running `data-step` parts, whether text is streaming, and the chat status. Every surface reads from it, so they can never disagree.

```ts
type CuratorStatus =
  | { phase: "idle" }
  | { phase: "thinking" | "searching" | "looking" | "hanging";
      label: string;          // "Looking at 8 works", or the current phrase (§7.2)
      turnStartedAt: number;  // drives the elapsed timer
      counts: { searches: number; lookedAt: number } }
  | { phase: "done"; summary: string; seconds: number; unseen: boolean }  // "Hung 12 works"
  | { phase: "error"; label: string }
  | { phase: "stopped" };
```

**1. Status line under the thread header.**
- Shows the phase glyph or spinner, the label, and the elapsed time (mono, right-aligned).
- Done: "✓ Hung 12 works · 38s". Error: destructive text. Idle: hidden, so the header stays one line.
- The elapsed timer lives here and nowhere else.

**2. Collapsed state.** The Curator control in the header becomes a status pill when the thread is closed or scrolled out of view on mobile:

| Phase | Pill | Behaviour |
|---|---|---|
| Working | `[spinner] Looking at 8 works · 0:14` | Same spinner mapping as the floating button |
| Done, unseen | `[■] 12 works hung · Open` | The square is accent; the pill pulses once (opacity, 600ms) |
| Error | `[□] Turn failed · Open` | Destructive outline |
| Idle | "Curator" | As today |

- Clicking the pill opens the thread scrolled to the latest turn.
- **Background tabs:** while a turn runs, `document.title` becomes "Looking at 8 works · Curio"; when it finishes unseen, "✓ 12 works hung · Curio". Restore it on focus.

**3. Floating jump button:** the same phase mapping as specified above.

### 7.2 One live indicator at a time, and better loading phrases

Today "Working" pulses at the bottom while "Looking at 8 works" also animates (screenshot). **Rule: the transcript never shows more than one animated line.**

| Condition | The one live indicator |
|---|---|
| A step is running | That step's label and spinner glyph |
| Text is streaming | The text itself; no extra line |
| Neither (the model is thinking before its first output or between steps) | A single thinking line, with phrases chosen by phase |

**Thinking phrases** rotate every 2.4s with a 150ms crossfade, fill in real numbers, and are chosen by what just happened:

| After | Phrases |
|---|---|
| Nothing yet | Reading your brief · Deciding where to look · Picking search terms |
| Searches | Sorting through 146 results · Choosing what to look at · Pulling the promising ones |
| Looking | Comparing what I saw · Deciding what makes the cut · Weighing 16 candidates |
| Several looks | Arranging the wall · Writing the wall label |
| Same set for more than 20s | Still looking, this collection is deep · Taking a second pass |

- Copy rules: sentence case, no ellipses, no em dashes.
- Reduced motion: no rotation; show the first phrase for the phase.

### 7.3 Seeing what the curator sees

The wait should be something to watch. Show the raw material the agent works with, kept small and curated, and let people act on it.

1. **Search steps show what came back.** A 5-thumbnail micro strip (20px) of the top results sits beside the count chip. It's dimmed, since the agent hasn't looked at them yet. Hovering shows the title.
2. **Look steps are the main view.**
   - The 8 works appear one by one as the executor fetches each thumbnail (per-item `data-step` updates: `items: [{ id, title, artist, thumb, state: "loading" | "seen" | "failed" }]`), at 40px.
   - While the model is judging, a 1px accent outline steps slowly from thumbnail to thumbnail (400ms each). This says "looking" without claiming which one it's on.
   - It belongs to the same live indicator as the thinking line ("Comparing what I saw"). It runs only while that phrase set is showing, so the one-indicator rule in §7.2 holds.
3. **Show which works made it.** When `present_selection` lands, every look strip in the turn updates: kept works get full opacity and a small accent square in the corner; passed works dim to 40% with a "Passed over" tooltip.
   - The done summary gains `[12 kept]`.
   - People see the agent's choices ("16 looked at, 12 made it") at no extra model cost.
4. **Short curator's asides.** The prompt (§12) asks for one short aside after each look, such as "The Redon balloon is the one; the Ensor is too busy." It streams as prose between steps, which gives the agent a voice while it works.
5. **The brief.** The prompt asks the curator to open each turn with one sentence naming what it's looking for ("Looking for smug cats, prints and paintings, any period"). It renders as the first line inside the Working group.
6. **"On the curator's table" on the wall.** During a turn, a band above the wall shows the works from the latest look step at 120px, with the same kept/passed reveal. Then it collapses as the new set is hung.
   - This keeps the process visible even with the thread closed.
   - Clicking a work opens the detail view.
   - The previous wall stays below, dimmed, until the new set lands.

**Data needed:**
- `search_artworks` emits its top-5 preview items.
- `view_artworks` emits an update per item as each thumbnail resolves.
- `present_selection` emits the kept ids; the client works out kept and passed.
- Thumbnails load in the browser straight from museum image servers (`referrerPolicy="no-referrer"`, as the wall already does), so there's no server cost.

### 7.4 Drag to resize the thread

- **Handle:** the 1px ink rule on the thread's left edge, with an 8px invisible hit area and `cursor: col-resize`. On hover or drag the rule turns accent, the one active-state use of blue here.
- **Width:**
  - minimum 320px; maximum `min(720px, 60vw)`; default 420px;
  - double-click resets to the default;
  - persisted in `localStorage` as `curio.threadWidth`.
- **Live reflow:**
  - The wall's right margin reads `var(--thread-w)`.
  - During the drag, disable the margin transition, capture the pointer, throttle updates with `requestAnimationFrame`, and set `user-select: none` on the body.
  - The masonry column count must follow the *container* width: check that `ResultGrid` measures its container (ResizeObserver) and not the window.
- **Keyboard:**
  - The handle is `role="separator"` with `aria-orientation="vertical"`, `aria-valuemin`, `aria-valuemax` and `aria-valuenow`, and is focusable.
  - ←/→ step 16px, Shift steps 64px, Home and End jump to min and max.
- **Where:** in the docked (≥1280) and overlay (768–1279) modes only; not on mobile.

---

## 8. Workstream F: The wall

### Wall label

- The heading is plain text, not outlined (comment).
- The curator's note keeps the accent rule.
- Meta becomes light chips instead of dot-joined text (comment): `[12 works] [4 museums]`, plus interpreted facets as removable chips.
- **Sort sits at the right end of the same row (D8).**

### States

| State | Label | Grid |
|---|---|---|
| Searching | "Searching the collections" with shimmer (comment); previous facets fade | Previous wall dims (exists) |
| Done | Heading, note, chips | Cards fade in with stagger (exists) |
| Partial | A `[Mia didn't answer]` chip with hover detail | As done |
| Empty | Existing cause-specific hints | n/a |

### Toolbar

- Drop **Periods** and **Artist** (comments).
- Rename the post-search "Movement" dropdown to "In these results" so it stops clashing with "Movements".
- New intermediate filter style (D9).

### Colour: a second tier that comes from the art (D11)

**What MFA Boston does** (mfa.org, computed styles, 2026-09-24):
- Black text and 1px black rules on white, zero radius.
- One filled call to action: "Get Tickets", bright yellow `#FFFF5A` with a black border. Everything else is outlined.
- Colour appears as **large flat fields behind black text, one per section, never as text or control colour**:
  - a mint `#4BFFC3` full-bleed feature block;
  - a yellow `#EBBE19` title band laid over the hero image;
  - a sky-blue `#7AD1EF` ticker;
  - a neutral grey `#EDEEEE` utility bar and footer.
- The images carry the rest of the colour.

**What Curio borrows:** the discipline, not the hues.

- Blue `#2400ff` stays the only colour that means **"you can act"** (primary button, active and focus states) and **"the curator"** (status, the note rule).
- The second tier is **derived from the works themselves**, the way a museum paints an exhibition wall to suit the show.

**Derived wall colour:**
- Take the median hue of the set's dominant colours. AIC, SMK and Harvard provide them; for the others, sample it from the thumbnail with the calm-score pass.
- Map it into a narrow OKLCH band: L 0.93–0.95, C ≤ 0.035, the set's hue.
- Black text on it stays above 12:1 contrast. Verify with a contrast check in the run.
- No usable colour data → fall back to the existing wash `#f2f2f2`.

**Where it appears, and only there:**
1. **The wall label band** when a curator set is hung: a full-width flat field behind the heading, note and chips, like MFA's title band.
2. **The detail view's image surround** (today `bg-wash`): the work's own dominant colour in the same band, like the wall behind a painting.
3. **Example cards on the homepage, on hover only:** the card's label area fills with its recorded set's wall colour. At rest the cards stay ink on paper, so the empty state stays calm.

**Limits:**
- At most one derived field in any region of the screen.
- Never on text, borders or controls.
- Transitions: background colour only, 200ms.
- Reduced motion: no transition.

**Rejected:** a fixed secondary brand colour (a yellow or mint of our own). It would compete with the blue and with the paintings.

### Scroll to top (comment)

MFA uses the same pattern: a square black-bordered button with an up arrow, fixed at the bottom right.

- A square 36px button with an up arrow.
- Appears once the wall is scrolled past 1.5 viewports; hides near the top.
- Bottom right of the wall, never under the thread column.

---

## 9. Workstream G: Responsive states

**The bug in the screenshot:** the filter row is a wrapping flex, and Sort has `md:ml-auto`. Between roughly 1024 and 1600px it wraps onto its own line against the right edge.

- **Sort leaves the toolbar (D8)**, so the orphan can't happen.
- **Toolbar by width:**

| Width | Toolbar |
|---|---|
| ≥1280 | One row: Movements, Cultures, Subjects, Media, Sources, Color, In these results |
| 768–1279 | Taxonomy groups collapse into a "Filters" menu; Sources and Color stay visible; still one row |
| <768 | "Filters" and "Color" |

  Rule: the toolbar is never more than one line at 768 and above.
- **Thread by width:**

| Width | Thread |
|---|---|
| ≥1280 | Docked column, 400px |
| 768–1279 | Overlay drawer, 420px, with a scrim |
| <768 | Full-screen sheet with a sticky composer |

- **Home:** two columns at 1024 and above, one column below.
- **Detail:** 360px side panel at 768 and above; stacked below, image at most 60vh; navigation arrows as icons.
- **Acceptance**, at 375, 390, 768, 1024, 1280, 1440, 1680 and 1920:
  - no control alone on its own row;
  - `scrollWidth <= clientWidth` on the page and on the toolbar;
  - screenshots in `.context/overnight/after/`.

---

## 10. Workstream H: Instant examples and presets

### Examples (D2): short label, longer prompt, a different skill each

| Label | Prompt sent | Shows |
|---|---|---|
| Cats with opinions | "Cats in paintings and prints that clearly have opinions: smug, plotting, deeply unimpressed. Personality over pedigree. Hang the ten most judgmental." | Humour, judging each image, ranking |
| The most dramatic sky | "Find the single most over-the-top sky in the collections, then five runners-up. Tell me why the winner wins." | Comparing and explaining a choice |
| Tiny people, huge landscapes | "Landscapes where the people are almost too small to find. Big weather, big mountains, one tiny figure." | Judging scale by looking |
| Monsters and marvels | "Floating eyes, polite demons, fish with legs. The strangest creatures in the collections, weird but beautiful." | Discovery; a run for "very absurd" already turned up Redon and Ensor |
| Snacks through history | "Food in art across four centuries, from feasts to one suspicious oyster. Hang them in date order." | Putting a set in order, with wit |
| Hammershøi, but outside | "The stillness of Hammershøi's interiors, the muted greys and the sense of someone just out of frame, but outdoors." | Carrying a painter's style into a new subject (Hammershøi is at SMK) |

Alternates: A blue room · Dawn to dusk · Everyone's reading.

### Recorded runs

- `scripts/record-examples.mjs` runs each prompt through the real curator locally.
- It saves the UIMessage parts (including `data-step` and `data-selection`), relative timings, and the **full artwork records** to `src/data/examples/<slug>.json`, committed.
- The wall renders from the file with no museum calls.

### Replay

- Clicking an example plays the recording into the thread with compressed timing, about 2.5s in total.
- The steps pass through their real states, the thumbnails fill in, and the set lands on the wall. It's the same components fed recorded parts, so nothing about the interaction changes.
- Caption: "Recorded run · Run it fresh" (D7).
- Follow-ups continue live, because history is client-side (§5).

### Preloading

- On idle after first paint, preload the 3 preview thumbnails per example card.
- On hover or focus of a card, preload the first 12 thumbnails of that set.
- Skip both when `navigator.connection.saveData` is set.

### Browse-by presets

- Server cache for the search fanout: `unstable_cache` keyed by the normalised SearchQuery, revalidated every 6 hours, shared with the curator's `search_artworks`.
- Client prefetch on hover into a small in-memory map, plus thumbnail preload.

### Refresh

Re-record when the prompt or tools change. Document this in AGENTS.md.

### Acceptance

- Clicking an example fills the wall in under 3s with **zero** requests to museum APIs (check the network log).
- A follow-up typed after a replay continues the same thread.

---

## 11. Workstream I: Detail view

### Loading the full-size image (screenshot)

Today: a blurred thumbnail with the caption "loading full size…". Replace it with:

1. **Focus pull on arrival.** The full-size image fades in while the thumbnail's blur goes from 16px to 0 and scale from 1.02 to 1, over 320ms ease-out. Like a loupe focusing. This is the main improvement.
2. **While waiting.** Four ink corner marks draw in around the frame, like registration marks. A caption chip at the bottom right shows the Morph spinner, "6614 × 4256 px", and a percentage when progress is available.
3. **Real progress where CORS allows.** Fetch with a `ReadableStream` and `content-length`, then an object URL. AIC sends `Access-Control-Allow-Origin: *`; other museums fall back to an indeterminate state without complaint.
4. **Preload neighbours.** After the current image settles, fetch the previous and next full-size images at low priority, aborted on navigation, so ← and → are instant.
5. **Reduced motion:** no scale and no drawing marks; the caption only.

### Comments on the detail view

- **Tall images don't fit** on first view ("Musk Cat"). Reproduce first. Likely cause: missing or wrong dims, so the full-size image sizes the box in normal flow. Constrain the frame in both paths.
- **Dominant colour:** `hsl(80.76923076923077, 51.99…%, …)`. Round to whole numbers inside `hexToHsl` in `src/lib/color.ts`.
- **Calm score:** one text size; colour distinguishes the parts.
- **Icons** on Save, Download and Add to chat, and on the ← → buttons (D5).
- **Artist name and movement tags** attach to the chat when clicked (typed attachments, §7).

---

## 12. Workstream J: The curator's voice

- **The agent is Curio (D14).** The prompt opens "You are Curio…" and speaks in the first person. It never calls itself "the curator".
- **Rewrite `src/lib/agent/prompt.ts` to be art-first.** Today it says "judge as backdrops, not as artworks" and "reject portraits on sight", and every note explains "why it suits a UI backdrop". Apply those criteria only when the brief mentions layout, text, a hero image or a background.
- **Note voice: first person and specific, like a docent.** For example: "I went looking for skies that overdo it. These twelve share a low horizon and a lot of weather. Start with the Turner."
- **`present_selection` gains `followUps: string[]`:** 2–3 short refinements, shown as suggestion chips.
- **Open each turn with the brief:** one sentence naming what the curator is looking for. It renders as the first line of the Working group (§7.3).
- **After each `view_artworks`:** one short aside on what caught its eye or what it's passing over. Keep it to a clause.
- **The selection note** says what the kept works share, and is honest about what it passed over.
- **Copy:** meta description, OG text and tagline, per §3.

---

## 13. Agentation comments (20 pending on 2026-09-24, condensed)

| # | Comment | Where | Workstream |
|---|---|---|---|
| 1 | Heading not outlined, plain text | Wall label "Curator's selection" | F |
| 2 | Filters: intermediate style, not outlined, not black | Filter row | F, D9 |
| 3 | Reword "for design backdrops": agent-first CC0 search and curation | Header tagline | A, J |
| 4 | Step dot optically centred with the text | Curator tool row | E |
| 5 | Attachment chip inside the text box, on top, within its width; several stack vertically | Composer | E |
| 6 | "Curator" and "claude" not aligned; show the model, not "claude" | Panel header | E |
| 7 | "New" → reset icon button; pick an icon library that fits | Panel header | E, D5 |
| 8 | Calm score: one text size, colour distinguishes | Detail | I |
| 9 | Icons on the action buttons | Detail | I, D5 |
| 10 | Drop Artist | Filter row | F |
| 11 | Drop Periods | Filter row | F |
| 12 | Round the hsl values | Detail | I |
| 13 | Artist name and tag attachable to the chat | Detail | E, I |
| 14 | Once the router exists, default mode reads like "Auto" in nicer words | Search mode | B |
| 15 | Placeholder broader; invite interpretive queries | Search input | A, B |
| 16 | "Searching" text shimmers (see AI Elements Shimmer) | Wall label | F |
| 17 | Not dots for everything; light chips | "12 works · 4 museums" | F |
| 18 | Tall images don't fit on first view | Detail ("Musk Cat") | I |
| 19 | Floating scroll-to-top when results exist and scrolled | Page | F |
| 20 | Icons, not ASCII arrows | Detail ← → | I, D5 |

The full JSON is at `http://localhost:4747/pending` while that server runs. Resolve each on the server once it's fixed and verified (`PATCH /annotations/<id>` with `{"status":"resolved"}`).

---

## 14. Order of work, checks and stop conditions

### Priority

- **P0 (must land)**
  - Pre-flight (§2).
  - Responsive toolbar and Sort move (G).
  - Quick comment fixes: F items and I items.
  - Thread UI: step vocabulary, stick-to-bottom, floating button, composer and attachments (E).
  - One status in three places (§7.1).
  - One live indicator with phase phrases (§7.2).
  - Seeing what the curator sees, items 1–3 (§7.3).
  - Rules router and one input (B), inside the current layout if A slips.
  - AI SDK spike and migration, or the hosted-only fallback (C).
- **P1**
  - Thread-first layout and the new empty state on the 12-column grid (A).
  - Drag to resize the thread (§7.4).
  - Seeing what the curator sees, items 4–6: asides, brief line, the table band (§7.3; needs J).
  - Derived wall colour (§8, D11).
  - Examples with recorded runs (H; needs C).
  - Preset caching (H).
  - Detail loading and neighbour preload (I).
  - Prompt rewrite (J).
- **P2**
  - Jev adapter and evaluation (D; needs access).
  - Re-ranking.
  - Queue.

### Suggested sequence

1. Pre-flight
2. G
3. F and I quick fixes
4. C0 spike
5. C1–C7
6. E
7. B
8. J
9. A
10. H
11. I (loading)
12. D
13. Final sweep

### After every workstream

- `tsc --noEmit` clean.
- Screenshot set via `/browse`, and Read every screenshot.
- Zero console errors after the interactions.
- Overflow probe.
- Hover and focus computed-style checks on touched controls.
- One commit per step, with a clear message.

### Stop conditions

- If the AI SDK spike fails on questions 1 and 3, take the hosted-only path.
- If the layout rebuild breaks more than two flows, revert to the extraction commit and move on.
- **Never push, never merge.** Leave the dev server stopped.

### End-of-run report

- What's done and verified, with before/after screenshots.
- Decisions taken on defaults.
- What's blocked, and why.
- **Needs your eyes:** spinner and focus-pull feel, the layout transition, filter style, headline copy, the quality of the example sets, the phrase rotation, the resize feel, and whether the derived wall colours read as calm.
