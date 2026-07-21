# Loupe

Read **[AGENTS.md](./AGENTS.md)** first — it's the full handoff (what Loupe is, how to run it, architecture, the single-`SearchQuery` fanout seam, adapters, the category taxonomy, the Claude curator, collections/export, known issues, the backlog, and the non-goals that keep it small).

Quick start: `npm run dev` → http://localhost:4050 · `npx tsc --noEmit`. npm, not pnpm. `rm -rf .next` after a move/dep change.

Design law: flat museum register — zero radius, no shadows, ink-on-paper, one accent `#2400ff`, Instrument Sans, sentence case. Don't add image editing (that's shader-lab). Don't add a second page without removing something.
