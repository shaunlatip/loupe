#!/usr/bin/env node
/**
 * Record the homepage examples as real curator runs, so clicking one replays
 * instantly (and still hands over to a live thread).
 *
 *   npm run dev                      # the local engine answers
 *   node scripts/record-examples.mjs [baseUrl] [slug …]
 *
 * For each example in src/lib/examples.ts this POSTs the brief to /api/agent,
 * reads the UI message stream, and writes:
 *   public/examples/<slug>.json      the finished assistant message (parts in
 *                                    order, each stamped with when it first
 *                                    appeared) + the prompt and metadata
 *   src/data/examples-index.json     three preview thumbnails per example
 *
 * Re-record whenever the prompt, the tools or the examples change.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const base = process.argv[2]?.startsWith("http") ? process.argv[2] : "http://localhost:4050";
const only = process.argv.slice(2).filter((a) => !a.startsWith("http"));

// Read EXAMPLES out of the TS module without a TS toolchain.
const src = readFileSync(join(root, "src/lib/examples.ts"), "utf8");
const examples = [...src.matchAll(/slug: "([^"]+)",\s*label: "([^"]+)",\s*prompt:\s*"((?:[^"\\]|\\.)*)"/g)].map(
  (m) => ({ slug: m[1], label: m[2], prompt: m[3].replace(/\\"/g, '"') }),
);
if (examples.length === 0) throw new Error("no examples parsed from src/lib/examples.ts");

// mirrors src/lib/thumb.ts
const smallThumb = (a) =>
  a.source === "aic" || a.source === "smk"
    ? a.imageThumb.replace(/\/full\/[^/]+\//, "/full/!240,240/")
    : a.imageThumb;

async function record(ex) {
  const started = Date.now();
  const res = await fetch(`${base}/api/agent`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: ex.prompt }], metadata: { route: "curate" } }],
      wall: { count: 0, works: [] },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`${ex.slug}: HTTP ${res.status}`);

  /** parts in first-appearance order; text accumulates, data parts replace by id */
  const parts = [];
  const byId = new Map();
  let metadata = {};
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
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
      const at = Date.now() - started;
      if (c.type === "start" || c.type === "finish" || c.type === "message-metadata") {
        metadata = { ...metadata, ...(c.messageMetadata ?? {}) };
      } else if (c.type === "text-start") {
        const p = { type: "text", text: "", at };
        byId.set(`t:${c.id}`, p);
        parts.push(p);
      } else if (c.type === "text-delta") {
        const p = byId.get(`t:${c.id}`);
        if (p) p.text += c.delta;
      } else if (c.type.startsWith("data-")) {
        const key = `${c.type}:${c.id}`;
        const existing = byId.get(key);
        if (existing) {
          existing.data = c.data;
          existing.doneAt = at;
        } else {
          const p = { type: c.type, id: c.id, data: c.data, at, doneAt: at };
          byId.set(key, p);
          parts.push(p);
        }
      } else if (c.type === "error") {
        throw new Error(`${ex.slug}: ${c.errorText}`);
      }
    }
  }
  const kept = parts.filter((p) => p.type !== "text" || p.text.trim());
  const exhibit = kept.find((p) => p.type === "data-exhibit");
  if (!exhibit) throw new Error(`${ex.slug}: no exhibit`);
  const recording = {
    slug: ex.slug,
    prompt: ex.prompt,
    recordedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    metadata: { ...metadata, claudeSessionId: undefined },
    parts: kept,
  };
  mkdirSync(join(root, "public/examples"), { recursive: true });
  writeFileSync(join(root, "public/examples", `${ex.slug}.json`), JSON.stringify(recording));
  return exhibit.data.artworks.slice(0, 3).map(smallThumb);
}

const indexPath = join(root, "src/data/examples-index.json");
let index = {};
try {
  index = JSON.parse(readFileSync(indexPath, "utf8"));
} catch {
  /* first run */
}
for (const ex of examples) {
  if (only.length && !only.includes(ex.slug)) continue;
  process.stdout.write(`recording ${ex.slug} … `);
  try {
    const t = Date.now();
    index[ex.slug] = await record(ex);
    console.log(`ok (${Math.round((Date.now() - t) / 1000)}s)`);
  } catch (err) {
    console.log(`FAILED: ${err instanceof Error ? err.message : err}`);
  }
}
writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
console.log(`wrote ${indexPath}`);
