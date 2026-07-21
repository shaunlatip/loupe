#!/usr/bin/env node
// scripts/build-movements.mjs
//
// Builds src/data/artist-movements.json — a static, committed CC0 lookup
// mapping normalized artist names to the art movement(s) Wikidata records
// for them via property P135 ("movement"). Run manually:
//
//   node scripts/build-movements.mjs
//
// This is NOT part of the app runtime — Loupe never fetches Wikidata live.
// It's backlog item #1 from AGENTS.md ("the big lever"): Met/CMA/Rijks have
// no art-movement field, only AIC does. This lookup lets the app join any
// museum's artist string against Wikidata's movement data client-side (see
// src/lib/movements.ts).
//
// MOVEMENT_QIDS below is a hardcoded, curated table — bounded to ~38
// movements relevant to design-backdrop/portfolio art rather than scraping
// all ~1M P135 statements on Wikidata (per the backlog note). Every QID in
// it was verified LIVE against WDQS during development, not recalled from
// memory: each was either (a) resolved via an exact-label match confirmed
// unique by usage count, or (b) discovered directly from a real exemplar
// painter's own P135 statement (e.g. Rembrandt/Vermeer -> Q2352880 "Dutch
// Golden Age painting", Fragonard -> Q122960 "Rococo", Monet -> Q40415
// "Impressionism"). This mattered in practice: a naive CONTAINS-text-search
// approach silently resolved "Realism" to Q4291635 "Metarealism" and
// "Rococo" to Q7356060 "Rococo Revival" because an unordered SPARQL LIMIT
// window can miss the exact match among many similarly-named entities —
// hardcoding the verified QID sidesteps that failure mode entirely. Some
// buckets carry more than one QID (aliases Wikidata itself splits, e.g.
// generic "realism" vs "French Realism" vs "American realism") so the join
// catches artists tagged under any of them.
//
// If you want to add a movement: find 2-3 canonical painters for it, look
// up their Wikidata item, read off their wdt:P135 value(s), and confirm the
// QID's English label + that it has a non-trivial P135 usage count before
// adding it here — don't paste in a remembered/guessed QID.
//
// NOTE: normalizeName()/nameKeys() below MUST stay byte-for-byte identical
// to the copies in src/lib/movements.ts — a build-time key only matches a
// runtime lookup if both sides normalize artist names the same way. This
// script is standalone ESM (no bundler, no shared-module wiring) so the ~15
// lines are duplicated on purpose; keep the two in sync by hand.

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SPARQL_ENDPOINT = "https://query.wikidata.org/sparql";
// WDQS blocks requests with no / generic User-Agent — this must stay descriptive.
const USER_AGENT =
  "loupe-movement-builder/1.0 (personal local design tool; single manual run, not a bot)";

const OUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "data",
  "artist-movements.json",
);

// display label -> Wikidata QID(s) for that movement (see provenance note
// above; every QID here was checked live, not recalled from memory).
const MOVEMENT_QIDS = [
  { display: "Impressionism", qids: ["Q40415"] },
  { display: "Post-Impressionism", qids: ["Q166713"] },
  { display: "Neo-Impressionism", qids: ["Q150091"] },
  // Baroque / Baroque painting / Flemish Baroque painting — Wikidata splits
  // the generic movement from region-specific painting-school variants;
  // fold them into one bucket so the join isn't overly narrow.
  { display: "Baroque", qids: ["Q37853", "Q808561", "Q1994273"] },
  { display: "Romanticism", qids: ["Q37068"] },
  // Realism — generic "realism" is by far the dominant tag (560 P135 uses
  // at verification time), but Courbet/Millet specifically carry "French
  // Realism" and Bellows carries "American realism"; all three fold here.
  { display: "Realism", qids: ["Q10857409", "Q2642826", "Q4745527"] },
  { display: "Dutch Golden Age", qids: ["Q2352880"] },
  { display: "Ukiyo-e", qids: ["Q185905"] },
  { display: "Tonalism", qids: ["Q1786363"] },
  { display: "Symbolism", qids: ["Q164800"] },
  { display: "Expressionism", qids: ["Q80113"] },
  { display: "Fauvism", qids: ["Q166593"] },
  { display: "Cubism", qids: ["Q42934"] },
  { display: "Surrealism", qids: ["Q39427"] },
  { display: "Rococo", qids: ["Q122960"] },
  { display: "Neoclassicism", qids: ["Q14378"] },
  { display: "Academic Art", qids: ["Q189458"] },
  { display: "Naturalism", qids: ["Q55995"] },
  { display: "Pre-Raphaelite", qids: ["Q184814"] },
  { display: "Hudson River School", qids: ["Q943853"] },
  { display: "Barbizon School", qids: ["Q143357"] },
  { display: "Art Nouveau", qids: ["Q34636"] },
  { display: "Pointillism", qids: ["Q200034"] },
  { display: "Divisionism", qids: ["Q2487023"] },
  { display: "Abstract Expressionism", qids: ["Q177725"] },
  { display: "Precisionism", qids: ["Q1578378"] },
  { display: "Luminism", qids: ["Q1159870"] },
  { display: "Mannerism", qids: ["Q131808"] },
  { display: "American Impressionism", qids: ["Q2477787"] },
  { display: "Ashcan School", qids: ["Q724976"] },
  { display: "De Stijl", qids: ["Q207445"] },
  { display: "Bauhaus", qids: ["Q124354"] },
  { display: "Vienna Secession", qids: ["Q208208"] },
  { display: "Les Nabis", qids: ["Q503708"] },
  { display: "Social Realism", qids: ["Q837024"] },
  { display: "Photorealism", qids: ["Q939559"] },
  { display: "Regionalism", qids: ["Q15838173"] },
  // Not in the original brief's list, but added deliberately: Whistler (the
  // app's own canonical "nocturne" example — see AGENTS.md/presets.ts
  // nocturne-night) is tagged by Wikidata as Aestheticism, not Tonalism or
  // Realism — verified directly from his P135 statement. Without this
  // bucket the join would silently miss him despite having real data.
  { display: "Aestheticism", qids: ["Q256922"] },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sparql(query, { retries = 4 } = {}) {
  const body = new URLSearchParams({ query, format: "json" });
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(SPARQL_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/sparql-results+json",
          "user-agent": USER_AGENT,
        },
        body,
      });
      if (!res.ok) {
        throw new Error(`WDQS ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      return json.results.bindings;
    } catch (err) {
      if (attempt === retries) throw err;
      const backoff = 1000 * attempt * attempt;
      console.warn(
        `    retry ${attempt}/${retries} after error: ${err.message} (waiting ${backoff}ms)`,
      );
      await sleep(backoff);
    }
  }
  return [];
}

// --- normalization (KEEP IN SYNC with src/lib/movements.ts) ---
function normalizeName(raw) {
  if (!raw) return "";
  const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");
  let s = raw.normalize("NFD").replace(COMBINING_MARKS, ""); // strip diacritics
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9,\s.'-]/g, ""); // drop punctuation noise, keep name-shape chars
  return s.trim().replace(/\s+/g, " ");
}

function nameKeys(raw) {
  const norm = normalizeName(raw);
  if (!norm) return [];
  const keys = new Set([norm]);
  if (norm.includes(",")) {
    // "last, first" -> also index "first last"
    const [last, first] = norm.split(",").map((p) => p.trim());
    if (last && first) keys.add(`${first} ${last}`);
  } else {
    // "first last" -> also index "last, first" (defensive; museum artist
    // strings observed so far are all "First Last", but Wikidata labels or
    // future sources could differ)
    const parts = norm.split(" ").filter(Boolean);
    if (parts.length >= 2) {
      const first = parts.slice(0, -1).join(" ");
      const last = parts[parts.length - 1];
      keys.add(`${last}, ${first}`);
    }
  }
  return Array.from(keys);
}
// --- end shared normalization ---

async function fetchArtistsForQid(qid) {
  const query = `
    SELECT ?person ?personLabel WHERE {
      ?person wdt:P135 wd:${qid} .
      ?person wdt:P31 wd:Q5 .
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 20000
  `;
  const rows = await sparql(query);
  return rows
    .map((r) => r.personLabel?.value)
    .filter((name) => !!name && !/^Q\d+$/.test(name)); // drop unlabeled QID fallbacks
}

async function main() {
  console.log(`Fetching artists for ${MOVEMENT_QIDS.length} movements…`);
  const map = new Map(); // normalized key -> Set<movement display>
  let totalArtistRows = 0;
  const uniqueArtistNames = new Set();

  for (const m of MOVEMENT_QIDS) {
    let movementTotal = 0;
    for (const qid of m.qids) {
      try {
        const names = await fetchArtistsForQid(qid);
        movementTotal += names.length;
        totalArtistRows += names.length;
        for (const name of names) {
          uniqueArtistNames.add(name);
          for (const key of nameKeys(name)) {
            if (!map.has(key)) map.set(key, new Set());
            map.get(key).add(m.display);
          }
        }
      } catch (err) {
        console.warn(`  ${m.display} (${qid}) -> failed: ${err.message}`);
      }
      await sleep(400);
    }
    console.log(`  ${m.display}: ${movementTotal} artist rows across ${m.qids.length} QID(s)`);
  }

  const out = {};
  for (const [key, movements] of map) {
    out[key] = Array.from(movements).sort();
  }

  await mkdir(path.dirname(OUT_PATH), { recursive: true });
  const json = JSON.stringify(out);
  await writeFile(OUT_PATH, json, "utf8");

  const sizeKb = (Buffer.byteLength(json) / 1024).toFixed(0);
  console.log(`\nWrote ${OUT_PATH}`);
  console.log(`  movements covered: ${MOVEMENT_QIDS.length}`);
  console.log(`  artist rows fetched (pre-dedupe): ${totalArtistRows}`);
  console.log(`  unique artist names: ${uniqueArtistNames.size}`);
  console.log(`  unique normalized keys: ${Object.keys(out).length}`);
  console.log(`  file size: ${sizeKb} KB`);
}

main().catch((err) => {
  console.error("build-movements failed:", err);
  process.exit(1);
});
