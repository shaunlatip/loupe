#!/usr/bin/env node
/**
 * The timeline is edited in scripts/timeline.js and runs inline in index.html
 * (the last <script> block). Run this after editing timeline.js to copy it in:
 *
 *   node scripts/splice-timeline.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(dir, "index.html"), "utf8");
const js = readFileSync(join(dir, "scripts/timeline.js"), "utf8");
const open = "    <script>\n";
const start = html.lastIndexOf(open);
const end = html.indexOf("    </script>", start);
if (start < 0 || end < 0) throw new Error("inline timeline <script> not found in index.html");
writeFileSync(join(dir, "index.html"), html.slice(0, start + open.length) + js + html.slice(end));
console.log(`spliced ${js.split("\n").length} lines into index.html`);
