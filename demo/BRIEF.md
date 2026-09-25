---
workflow: general-video
flow: automation
storyboard: no
message: "Ask Curio for something odd; it searches five museums and hangs you an exhibit with opinions."
destination: portfolio
aspect: 2560x1712
language: en
length: 27.9s
angle: product-demo
---

## Intent

A short silent product demo of Curio in the style of the pokergpt UI clip
(Design Library: pokergpt.mp4): one continuous virtual camera, unhurried
in-out moves and slow drifts, the send button handing off to the working state. Approved in
Paper as the A + C mix: Option A's camera and pacing, with Option C's
full-frame loading glyphs (Flip, Morph, Gather) carrying real art.

## Assets

- assets/fonts/lunchtype22-*.woff2: Curio's typeface (OFL), from src/app/fonts.
- assets/art/ex-01..10.jpg: the ten works of the recorded "Cats with opinions" exhibit, in exhibit order.
- assets/art/look2-1..8.jpg: the second look strip from the recording (Kay = look2-6), carried through the lens beat.
- assets/art/search-1, 4, 5.jpg: the search previews the working beat flips through.

## Notes

- Paper storyboard: https://app.paper.design/file/01M3B0BPKKP1AB69MCMVZT8T0G/p-1-0
- All copy and numbers come from public/examples/cats-with-opinions.json.
- Brief wording: the recorded prompt, shortened. Silent. 3:2.
- Timing (v2, after feedback that v1 was too fast): camera moves 1.0–1.4s in-out with no whips (Material 3 extra-long tokens), glyph state changes 500–650ms (the glyphs' own 1200 / 1600ms cycles), entrances 300–500ms and exits 200–300ms (NN/g, Val Head), feedback 100–200ms, text held at about 2–3 words a second. Zooms capped at 3.2x. Each working step (search, look, read, curate) gets about 3s.
- v3 feedback: typing speeds up through the sentence; the last search photo rounds into the loupe instead of cutting to blue; Reading splits the blue square into the four works it read (no same-image 3x3 Blocks grid); the note streams in about 1s; only two comments, each framed close (2.1x) on the photo and its comment; no end card.
- v4 feedback (39.3s → 28.5s): typing starts at 0.35s and accelerates harder; Ask hands off to the square 0.2s after the press; the lens pan, the four reading squares and Gather at about 60% of their v3 length; the note holds briefly once written; the first wall card is now A White Cat Playing with a String (Kay moves to its old slot, column 3); comments are one sentence, fully open about 2s each, and the second is Bernhardt, the row below, so the camera travels down rather than across.
- v5 feedback (28.8s): the payoff ground is plain white, not the warm tint; the note holds 1.6s; from the note the camera goes straight into the first work (no wide stop); first to second work on a strong in-out (power4); then out to the whole three-column wall at 0.8x, held about 2s; no page scroll.
- v6 feedback (27.6s): 1.4s on each commented work (was ~2s), the comment opening as the camera lands; the second comment moves from Bernhardt to Steinlen's Winter: Cat on a Cushion, second in row two, so the move runs diagonally down and right ("He has claimed the good cushion and is waiting to see if you object.").
- v7 feedback (26.6s): the four reading blocks show each work's full crop (image fills the block at rest, per-work object-position; scales by |cos|+|sin| only mid-turn to cover the corners); 0.9s on each commented work (was 1.4s), comment fully open as the camera lands.
- v8 feedback (27.9s): the composer button reads "Ask Curio" (290px, same right edge; camera target, rings and the narrow-to-square follow); "Looking for cats with attitude." beat 2.2 → 3.0s (~50% longer on screen); the note beat 1.6 → 2.1s (~30% longer).
- Curio's design law applies: zero radius, no shadows, ink on paper, one accent #2400ff, sentence case, no em dashes in on-screen copy.
