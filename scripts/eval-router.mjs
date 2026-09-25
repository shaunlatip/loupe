#!/usr/bin/env node
/**
 * Score the one input's router against labelled cases.
 *
 *   node scripts/eval-router.mjs            # the rules (src/lib/router/rules.ts)
 *   node scripts/eval-router.mjs --jev      # also Jev, when CURIO_ROUTER=jev and a
 *                                           # Gateway key are set (src/lib/router/jev.ts)
 *
 * Prints accuracy, a confusion matrix (rows: expected, columns: routed) and
 * every miss. Cases live in src/lib/router/cases.json; add one for every
 * misroute you meet. The acceptance bar for the rules is 85%. Jev only goes
 * on by default if it beats the rules by 5 points with p95 under 250ms.
 *
 * Loads the TypeScript through jiti (already in node_modules via Tailwind),
 * with the @/ alias mapped to src/.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const jiti = createJiti(import.meta.url, { alias: { "@": join(root, "src") } });
const cases = JSON.parse(readFileSync(join(root, "src/lib/router/cases.json"), "utf8"));
const ROUTES = ["lookup", "describe", "curate", "refine"];

async function score(name, classify) {
  const matrix = Object.fromEntries(ROUTES.map((r) => [r, Object.fromEntries(ROUTES.map((c) => [c, 0]))]));
  const misses = [];
  const times = [];
  for (const c of cases) {
    const ctx = { hasWall: Boolean(c.hasWall), attachments: c.attachments ?? 0 };
    const t = performance.now();
    const d = await classify(c.q, ctx);
    times.push(performance.now() - t);
    matrix[c.route][d.route]++;
    if (d.route !== c.route) misses.push({ ...c, got: d.route, reason: d.reason, source: d.source });
  }
  const right = cases.length - misses.length;
  times.sort((a, b) => a - b);
  const pct = (p) => times[Math.min(times.length - 1, Math.floor(p * times.length))].toFixed(1);
  console.log(`\n${name}: ${right}/${cases.length} = ${((100 * right) / cases.length).toFixed(1)}%   p50 ${pct(0.5)}ms  p95 ${pct(0.95)}ms`);
  const w = 10;
  console.log(" ".repeat(w) + ROUTES.map((r) => r.padStart(w)).join(""));
  for (const r of ROUTES) console.log(r.padEnd(w) + ROUTES.map((c) => String(matrix[r][c]).padStart(w)).join(""));
  if (misses.length) {
    console.log("\nmisses:");
    for (const m of misses) {
      const ctx = [m.hasWall ? "wall" : "", m.attachments ? `${m.attachments} attached` : ""].filter(Boolean).join(", ");
      console.log(`  ${m.route} → ${m.got}  "${m.q.length > 70 ? m.q.slice(0, 67) + "…" : m.q}"${ctx ? ` (${ctx})` : ""}  [${m.source}: ${m.reason}]`);
    }
  }
  return right / cases.length;
}

const { classifyRules } = await jiti.import(join(root, "src/lib/router/rules.ts"));
await score("rules", (q, ctx) => classifyRules(q, ctx));

if (process.argv.includes("--jev")) {
  const { classifyJev, jevEnabled } = await jiti.import(join(root, "src/lib/router/jev.ts"));
  if (!jevEnabled()) console.log("\njev: off (set CURIO_ROUTER=jev and AI_GATEWAY_API_KEY)");
  else await score("jev", (q, ctx) => classifyJev(q, ctx));
}
