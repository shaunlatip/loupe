# Curio

Read **[AGENTS.md](./AGENTS.md)** first — it's the full handoff (what Curio is, how to run it, architecture, the single-`SearchQuery` fanout seam, adapters, the category taxonomy, the Claude curator, collections/export, known issues, the backlog, and the non-goals that keep it small).

Quick start: `npm run dev` → http://localhost:4050 · `npx tsc --noEmit`. npm, not pnpm. `rm -rf .next` after a move/dep change.

Design law: flat museum register — zero radius, no shadows, ink-on-paper, one accent `#2400ff`, Instrument Sans, sentence case. Don't add image editing (that's shader-lab). Don't add a second page without removing something.

## Wiki

This project has a synthesis page in Shaun's personal wiki: **`~/Dropbox/wiki/projects/loupe.md`** (the wiki page still uses the old name "Loupe"; the product is now **Curio**). Read it at the start of a session that touches product direction, design rationale, or how this fits Shaun's portfolio / design-engineering arc — it holds the synthesized "why" the code doesn't (and notes that the real work lives in Conductor worktrees + the Vercel deploy, not `main`).

- Treat it as **synthesis, not live truth**: for current repo state, trust `git log` and the files.
- New synthesis-grade insight → update `~/Dropbox/wiki/projects/loupe.md` and append a line to `~/Dropbox/wiki/log.md`, per the schema at `~/Dropbox/wiki/CLAUDE.md` (and consider renaming the page to Curio).
- The global rule at `~/.claude/rules/wiki.md` governs load-on-demand and the personal/work firewall.
