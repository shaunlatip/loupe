# Curio demo video

The silent product demo of Curio for the portfolio: a brief typed into the one input, Curio working (search, look, read, curate), the exhibit note, then the wall with two comments and a pull back to the whole gallery. 2560×1712 (3:2), 30fps, 27.9s.

It's a [HyperFrames](https://hyperframes.heygen.com) composition: HTML plus a seekable GSAP timeline, rendered to MP4 in headless Chrome. All copy, works and numbers come from the recorded example `public/examples/cats-with-opinions.json`.

## Files

- `index.html`: the composition (markup, CSS, and the timeline inlined as its last `<script>`).
- `scripts/timeline.js`: the timeline source. Every beat hangs off a named mark in `S`, so a beat is lengthened or shortened by moving the marks after it. The header comment logs each revision (v4 to v8).
- `scripts/splice-timeline.mjs`: copies `timeline.js` into `index.html`. Run it after every timeline edit.
- `assets/`: Lunchtype (OFL, from `src/app/fonts/lunchtype`) and the 21 artworks the video shows, all CC0 or public domain.
- `BRIEF.md`: intent, timing rules, and the feedback behind each version. `STORYBOARD.md` and `design.md`: the original beat plan and design notes.
- `AGENTS.md` / `CLAUDE.md`: HyperFrames' own instructions for agents working in this folder.

`renders/` and `snapshots/` are gitignored.

## Edit, check, render

```
cd demo
node scripts/splice-timeline.mjs    # after editing scripts/timeline.js
npm run check                       # lint, layout, motion, contrast
npx --yes hyperframes@0.8.75 snapshot --at 4.2,12.5,22.9 --no-end   # spot-check frames
npm run render                      # → renders/curio-demo.mp4
```

The composition's length is the root `data-duration` in `index.html` (and on `#scene`); keep it equal to `S.end` in the timeline.

## Portfolio exports

The portfolio uses a 1920-wide web encode and a poster frame, made from the master render:

```
ffmpeg -i renders/curio-demo.mp4 -vf scale=1920:-2:flags=lanczos -c:v libx264 -preset slow -crf 20 -pix_fmt yuv420p -movflags +faststart -an curio-demo-1920.mp4
ffmpeg -ss 27.4 -i renders/curio-demo.mp4 -frames:v 1 -vf scale=1920:-2:flags=lanczos -q:v 2 curio-demo-poster.jpg
```
