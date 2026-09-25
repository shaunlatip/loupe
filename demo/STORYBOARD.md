---
format: 2560x1712
message: "Ask for something odd; Curio searches five museums and hangs you an exhibit with opinions."
arc: Brief → Ask → Working (every glyph state) → Exhibit → Wall with comments
audience: portfolio visitors, people who saw the pokergpt-style UI demos
mode: collaborative
reference: /Users/shaunlatip/Documents/Design Library.library/images/MREGYPDP740EJ.info/pokergpt.mp4
paper: https://app.paper.design/file/01M3B0BPKKP1AB69MCMVZT8T0G/p-1-0
data: public/examples/cats-with-opinions.json
art: assets/art/ (ex-01..10 = exhibit order, look2-1..8 = the look strip; the other strips were cut in v3)
variant: A + C (recommended mix, see Paper board D)
---

<!--
Global rules (Paper board 00):
- One virtual camera: a single wrapper transform. Sizes: extreme close-up, medium, wide. No cuts.
- Moves take 6 to 9 frames on Curio's --ease-in-out (0.77, 0, 0.175, 1). Holds keep a 2% --ease-out (0.23, 1, 0.32, 1) drift.
- Stage is wash #F2F2F2 with paper panels and 1px ink borders. Zero radius, no shadows.
- Blue #2400FF only on the element in focus. The payoff glow is tintOf() over the exhibit, never purple.
- Type is Lunchtype (src/app/fonts/lunchtype). Glyph CSS is copied from loading-dev (flip/morph/blocks/gather) with Curio's radius-0 override.
-->

## Frame 1 — Cold open on the caret

- scene: The composer placeholder at 5×, the caret blinks, the first key lands
- duration: 0.5s
- transition_in: cut
- camera: 5.0× → 4.9×
- reuse: HomeHero composer, placeholder "Hokusai, fog over water, cats with opinions…"

The first key lands at 0.40s. The placeholder fades out over 4 frames.

## Frame 2 — Snap out, type the brief

- scene: The camera snaps back to the composer while the brief types
- duration: 2.5s
- transition_in: zoom (6f snap, 5.0× → 1.3×)
- camera: 1.30× → 1.36×, following the caret

"Cats with opinions. Smug, plotting, deeply unimpressed." About 23 chars a second, with 40–70ms per-key jitter and a pause after the full stop. Each character fades in over 80ms.

## Frame 3 — Whip to Ask, press

- scene: Whip into the Ask button, the real press, square focus rings step out
- duration: 1.3s
- transition_in: zoom (9f whip, 1.36× → 4.5×)
- reuse: button:active scale 0.97 / 120ms; :focus-visible ring

## Frame 4 — Ask becomes the glyph

- scene: The blue rectangle narrows to a square and flips edge-on; the composer dissolves
- duration: 0.5s
- transition_in: morph
- reuse: loading-dev Flip keyframes, .ld-flip-face radius 0

## Frame 5 — Got it

- scene: The glyph slides left; "Looking for cats with attitude." streams; the status line reads "Reading your brief"
- duration: 0.8s
- camera: 4.8× → 2.2×

## Frame 6 — Searching (glyph grows full frame)

- scene: The glyph grows to fill the frame and flips 4× through real search results; the counter rolls 0 → 138
- duration: 1.1s
- transition_in: scale up from the status-line glyph
- art: search previews (pearl cat, cat coffin, springing-cat bank, Winter: Cat on a Cushion)

## Frame 7 — Looking (Morph as a loupe)

- scene: The square rounds to a circle lens that sweeps the 8 candidates at 30%, settling on Kay
- duration: 1.1s
- art: look2-1..8 (Kay = look2-6)

## Frame 8 — Reading (Blocks)

- scene: A 3×3 row sweep; each row turns from blue into a slice of the Kay etching; the medium line types beneath
- duration: 1.0s

## Frame 9 — Curating (Gather)

- scene: Four blocks carrying Kay, Steinlen, Jourdain and Rochegrosse pull together and turn 90°, then shrink back into the status line
- duration: 1.5s
- note: pull 30–60%, turn 60–100% of the cycle (ld-gather keyframes)

## Frame 10 — Done

- scene: The status rolls up to "Curated an exhibit of 10 works"; the counter stops at 44s; the check
- duration: 0.4s
- copy: curatedLine() in status.ts

## Frame 11 — Here's your exhibit

- scene: Title plus the note streaming under the accent rule; the wash warms to the exhibit tint
- duration: 1.0s
- tint: oklch(0.95 0.018 60) (compute with tintOf over the ten works)

## Frame 12 — The wall hangs itself

- scene: Pull back; the ten works land in reading order, 40ms apart, into reserved boxes
- duration: 0.4s
- transition_in: zoom (12f, 2.5× → 1.15×)
- reuse: ResultGrid, ArtworkCard, animate-fade

## Frame 13 — Comments pop in and out

- scene: Hover mat, 350ms, the comment opens; Kay, then Steinlen; one open at a time
- duration: 2.2s
- reuse: CommentCard, COMMENT_INTENT_MS 350, placeComment()

## Frame 14 — Down the gallery, hold

- scene: Scroll one screen, a last comment on Rochegrosse, the wordmark fades in, hold
- duration: 2.2s
