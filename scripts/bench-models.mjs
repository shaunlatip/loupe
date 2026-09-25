#!/usr/bin/env node
/**
 * Benchmark hosted curator models on the real app, end to end.
 *
 *   npm run build
 *   node scripts/bench-models.mjs --env ~/path/.env.local model-a model-b …
 *
 * For each model: start the production build (`next start`) on the hosted
 * engine (CURIO_LLM_ENGINE=openrouter) with that model alone (no fallbacks),
 * run the same seven turns through /api/agent, then stop it. The key is read
 * from the env file and handed to the server's environment; it is never
 * printed. Spend per model comes from OpenRouter's credits endpoint, read
 * before and after (it can lag a few seconds, so there's a pause).
 *
 * Writes .context/bench/<timestamp>.json and prints a summary.
 */
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const envAt = args.indexOf("--env");
const envFile = envAt >= 0 ? args[envAt + 1] : join(root, ".env.local");
const models = args.filter((a, i) => a !== "--env" && i !== envAt + 1);
if (!models.length) throw new Error("name at least one model");

const key = readFileSync(envFile.replace(/^~/, process.env.HOME), "utf8")
  .split("\n")
  .map((l) => l.match(/^\s*OPENROUTER_API_KEY\s*=\s*"?([^"\s]+)"?/))
  .find(Boolean)?.[1];
if (!key) throw new Error(`no OPENROUTER_API_KEY in ${envFile}`);

const PORT = 4987;
const BASE = `http://localhost:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function usage() {
  const res = await fetch("https://openrouter.ai/api/v1/credits", { headers: { authorization: `Bearer ${key}` } });
  if (!res.ok) return undefined;
  const j = await res.json();
  return j?.data?.total_usage;
}

function startServer(model) {
  const child = spawn(join(root, "node_modules/.bin/next"), ["start", "-p", String(PORT)], {
    cwd: root,
    env: { ...process.env, CURIO_LLM_ENGINE: "openrouter", CURIO_CURATOR_MODEL: model, OPENROUTER_API_KEY: key },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  return { child, log: () => log };
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(BASE);
      if (r.ok) return;
    } catch {
      /* not yet */
    }
    await sleep(500);
  }
  throw new Error("server didn't start");
}

/** POST a turn and read the UI message stream into a summary. */
async function turn(messages, wall) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages, wall: wall ?? { count: 0, works: [] } }),
  });
  const out = { ms: 0, http: res.status, texts: [], steps: [], exhibit: undefined, exhibitId: undefined, revision: undefined, error: undefined, model: undefined, afterExhibitText: "" };
  if (!res.ok || !res.body) {
    out.error = await res.text();
    out.ms = Date.now() - t0;
    return out;
  }
  const textById = new Map();
  const stepById = new Map();
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let sawExhibit = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === "[DONE]") continue;
      let c;
      try {
        c = JSON.parse(raw);
      } catch {
        continue;
      }
      if (c.type === "text-delta") {
        textById.set(c.id, (textById.get(c.id) ?? "") + c.delta);
        if (sawExhibit) out.afterExhibitText += c.delta;
      } else if (c.type === "data-step") stepById.set(c.id, c.data);
      else if (c.type === "data-exhibit") {
        out.exhibit = c.data;
        out.exhibitId = c.id;
        sawExhibit = true;
      } else if (c.type === "data-revision") out.revision = c.data;
      else if (c.type === "error") out.error = c.errorText;
      else if (c.type === "finish") out.model = c.messageMetadata?.model;
    }
  }
  out.ms = Date.now() - t0;
  out.texts = [...textById.values()].map((t) => t.trim()).filter(Boolean);
  out.steps = [...stepById.values()].map((s) => ({ kind: s.kind, phase: s.phase, count: s.count, found: s.found }));
  return out;
}

const user = (id, text, metadata = {}) => ({ id, role: "user", parts: [{ type: "text", text }], metadata: { route: "curate", ...metadata } });
const wallOf = (exhibitId, e) => ({
  heading: e.title,
  exhibit: true,
  exhibitId,
  count: e.artworks.length,
  works: e.artworks.map((a) => ({ id: a.id, title: a.title, artist: a.artist, date: a.date })),
});

const CATS =
  "Cats in paintings and prints that clearly have opinions: smug, plotting, deeply unimpressed. Personality over pedigree. Pick the most judgmental ones.";
const SKY =
  "Find the single most over-the-top sky in the collections, then five runners-up. Put the winner first and tell me why it wins.";
const SNACKS = "Food in art across four centuries, from feasts to one suspicious oyster. Put them in date order.";

function outcome(r) {
  if (r.error) return "error";
  if (r.exhibit?.fallback) return "fallback";
  if (r.exhibit) return "exhibit";
  if (r.revision) return "revision";
  if (r.texts.length) return "answer";
  return "empty";
}

function commentStats(e) {
  const cs = Object.values(e?.comments ?? {});
  const words = cs.map((c) => c.split(/\s+/).length);
  return { comments: cs.length, maxWords: words.length ? Math.max(...words) : 0, meta: cs.filter((c) => /publish(es)? no|no (museum )?text|label (says|notes)/i.test(c.slice(0, 60))).length };
}

async function runModel(model) {
  const server = startServer(model);
  const cases = [];
  try {
    await waitUp();
    const before = await usage();

    // A: curate from scratch
    const a = await turn([user("u1", CATS)]);
    cases.push({ id: "A curate", expect: ["exhibit"], r: a });

    if (a.exhibit) {
      const history = [user("u1", CATS), { id: "a1", role: "assistant", parts: [{ type: "text", text: a.texts[0] ?? "" }, { type: "data-exhibit", id: a.exhibitId, data: a.exhibit }], metadata: {} }];
      const wall = wallOf(a.exhibitId, a.exhibit);
      // B: about what's up → revise or answer, not a new exhibit
      cases.push({ id: "B about the wall", expect: ["revision", "answer"], r: await turn([...history, user("u2", "tell me more about the first three")], wall) });
      // C: a refinement → a new exhibit
      cases.push({ id: "C refine", expect: ["exhibit"], r: await turn([...history, user("u3", "only prints", { route: "refine" })], wall) });
    } else {
      cases.push({ id: "B about the wall", expect: ["revision", "answer"], r: { skipped: true } });
      cases.push({ id: "C refine", expect: ["exhibit"], r: { skipped: true } });
    }

    // D: an exact count, ordered
    const d = await turn([user("d1", SKY)]);
    cases.push({ id: "D exactly six", expect: ["exhibit"], r: d, check: d.exhibit ? d.exhibit.artworks.length === 6 : false });
    // E: a sequence
    cases.push({ id: "E date order", expect: ["exhibit"], r: await turn([user("e1", SNACKS)]) });
    // F: a question that needs no works
    cases.push({ id: "F question", expect: ["answer"], r: await turn([user("f1", "who was Hammershøi")]) });
    // G: a question about an attached work (AIC, rich label text)
    const g = await turn([
      user("g1", "tell me about this painting", {
        attachments: [{ kind: "artwork", id: "aic:27992", title: "A Sunday on La Grande Jatte — 1884", artist: "Georges Seurat", thumb: "" }],
      }),
    ]);
    cases.push({ id: "G attached question", expect: ["answer"], r: g, check: g.steps.some((s) => s.kind === "read") });

    await sleep(15_000);
    const after = await usage();
    return { model, spend: before !== undefined && after !== undefined ? after - before : undefined, cases };
  } finally {
    server.child.kill("SIGTERM");
    await sleep(1500);
  }
}

mkdirSync(join(root, ".context/bench"), { recursive: true });
const all = [];
for (const model of models) {
  process.stdout.write(`\n${model}\n`);
  const res = await runModel(model);
  all.push(res);
  for (const c of res.cases) {
    if (c.r.skipped) {
      console.log(`  ${c.id.padEnd(20)} skipped (A had no exhibit)`);
      continue;
    }
    const o = outcome(c.r);
    const ok = c.expect.includes(o) && c.check !== false;
    const e = c.r.exhibit ?? c.r.revision;
    const cs = commentStats(c.r.exhibit ?? (c.r.revision ? { comments: c.r.revision.comments } : undefined));
    const steps = c.r.steps.reduce((m, s) => ({ ...m, [s.kind]: (m[s.kind] ?? 0) + 1 }), {});
    console.log(
      `  ${c.id.padEnd(20)} ${ok ? "PASS" : "FAIL"}  ${o.padEnd(8)} ${String(Math.round(c.r.ms / 1000)).padStart(3)}s` +
        `  steps ${JSON.stringify(steps)}` +
        (c.r.exhibit ? `  works ${c.r.exhibit.artworks.length}` : "") +
        (e ? `  comments ${cs.comments} (max ${cs.maxWords}w${cs.meta ? `, ${cs.meta} meta` : ""})` : "") +
        (c.r.afterExhibitText.trim() ? "  +text after exhibit" : "") +
        (c.r.error ? `  error: ${String(c.r.error).slice(0, 120)}` : ""),
    );
  }
  console.log(`  spend $${res.spend?.toFixed(4) ?? "?"}`);
}
const file = join(root, ".context/bench", `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, JSON.stringify(all, null, 2));
console.log(`\nwrote ${file}`);
