# Curio

Read **[AGENTS.md](./AGENTS.md)** first — it's the full handoff (what Curio is, how to run it, the one input and its four routes, the fanout seam, adapters, Curio the agent on the AI SDK with a locked-down local Claude engine, recorded examples, the detail view, collections/export, known issues, the backlog, and the non-goals that keep it small).

Quick start: `npm run dev` · `npx tsc --noEmit` · `npm run eval:router`. npm, not pnpm. `rm -rf .next` after a move/dep change.

Design law: flat museum register — zero radius, no shadows, ink-on-paper, one accent `#2400ff`, Lunchtype, sentence case, no em dashes in UI copy. Colour from the art only as a whisper (`src/lib/tint.ts`). Don't add image editing (that's shader-lab). Don't add a second page without removing something. Keep the local Claude session locked to Curio's own tools.
