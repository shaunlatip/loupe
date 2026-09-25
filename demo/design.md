# Curio: design truth for the demo

Brand values are taken from Curio's own `src/app/globals.css`. Do not invent others.

## Colour

| Role | Value | Notes |
| --- | --- | --- |
| Stage | `#f2f2f2` (wash) | the neutral ground the camera moves over |
| Paper | `#ffffff` | the composer, cards |
| Ink | `#0a0a0a` | text, 1px structural rules (2–3px at video scale) |
| Accent | `#2400ff` | one blue at a time: Ask, the glyph, comment cards, markers |
| Muted text | `#6b6b6b` | placeholders, status, captions |
| Wash pressed | `#e6e6e6` | skeleton frames |
| Payoff tint | `oklch(0.95 0.018 60)` | tintOf() over the exhibit; only as a whisper |

## Type

Lunchtype only (300 / 400 / 500; 500 covers bold). Sentence case. No em dashes in copy.
Video scale is about 2.6× the web sizes: body 40–44px, captions 26–30px, title 88px.

## Shape and depth

Zero radius everywhere (the Morph lens is the only round shape, on purpose). No shadows:
elevation is an ink border on paper. The wordmark is outlined Lunchtype Medium, lowercase.

## Motion

Two curves: ease-out `cubic-bezier(0.23, 1, 0.32, 1)` for arrivals and feedback,
in-out `cubic-bezier(0.77, 0, 0.175, 1)` for camera moves. Whips take 6–9 frames; holds drift about 2%.
Glyph keyframes are loading-dev's: Flip = rotateX -180 then rotateY -180; Morph = radius to 50% + 45° turn;
Blocks = rows scale 1 → 0 → 1 in turn; Gather = pull in (30–60%), turn 90° (60–100%).
