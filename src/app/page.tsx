"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Artwork,
  SearchFacets,
  SearchQuery,
  SearchResponse,
  SourceError,
  SourceId,
} from "@/lib/types";
import { peekCalm, requestCalmForAll, subscribeCalm } from "@/lib/calm-client";
import { enrichArtworksWithMovements } from "@/lib/movements";
import { CATEGORIES, getCategory, mergeCategoryQueries } from "@/lib/presets";
import { type HSL, colorDistance } from "@/lib/color";
import SearchBar from "@/components/SearchBar";
import ResultGrid from "@/components/ResultGrid";
import DetailView from "@/components/DetailView";
import FilterRow, { type SortMode } from "@/components/FilterRow";
import CollectionsBar from "@/components/CollectionsBar";
import SaveMenu from "@/components/SaveMenu";
import ClaudePanel from "@/components/ClaudePanel";
import { sourceLabel } from "@/components/SourceBadge";
import {
  type Collection,
  addArtwork,
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  removeArtwork,
} from "@/lib/collections-client";
import { serverCanFetch } from "@/lib/source-egress";
import { fileBaseName, imageExtension } from "@/lib/slug";

// "Fits a hero": landscape-ish and big enough to sit full-bleed behind UI —
// see the Shopify-Editions backdrop use case in AGENTS.md.
const HERO_MIN_ASPECT = 1.4;
const HERO_MIN_WIDTH = 2000;

function fitsHero(a: Artwork): boolean {
  const { width, height } = a.dims ?? {};
  if (!width || !height) return false;
  return width / height >= HERO_MIN_ASPECT && width >= HERO_MIN_WIDTH;
}

/**
 * Sort composes with the hero filter (filter first, then sort). Works
 * lacking `color` (Met/CMA, or AIC records AIC itself didn't analyze) sort
 * to the end rather than dropping out — Array#sort is stable, so within
 * each group (has-color / no-color) original relative order is preserved.
 *
 * "calmest" follows the same lacking-data convention: calm scores compute
 * lazily and asynchronously (see calm-client.ts), so at any given moment
 * some works may not have a score yet. Those sort to the end rather than
 * blocking the sort or guessing; selecting "calmest" also kicks off
 * computation for every currently-loaded work (see the effect in Home),
 * and each resolving score re-runs this sort so the grid settles into
 * calmest-first order progressively rather than jumping once at the end.
 */
function sortArtworks(list: Artwork[], mode: SortMode, target?: HSL): Artwork[] {
  if (mode === "relevance") return list;
  if (mode === "similar") {
    // Rank by perceptual closeness to the picked color. Only AIC carries a
    // dominant color; works without one can't be ranked, so — like the other
    // color sorts below — they fall to the end (stable within their group).
    if (!target) return list;
    const withColor: Artwork[] = [];
    const withoutColor: Artwork[] = [];
    for (const a of list) (a.color ? withColor : withoutColor).push(a);
    withColor.sort(
      (a, b) => colorDistance(a.color!, target) - colorDistance(b.color!, target),
    );
    return [...withColor, ...withoutColor];
  }
  if (mode === "calmest") {
    const scored: Artwork[] = [];
    const unscored: Artwork[] = [];
    for (const a of list) (peekCalm(a.id) ? scored : unscored).push(a);
    scored.sort((a, b) => peekCalm(b.id)!.score - peekCalm(a.id)!.score);
    return [...scored, ...unscored];
  }
  const withColor: Artwork[] = [];
  const withoutColor: Artwork[] = [];
  for (const a of list) (a.color ? withColor : withoutColor).push(a);
  withColor.sort((a, b) => {
    if (mode === "lightest") return b.color!.l - a.color!.l;
    if (mode === "darkest") return a.color!.l - b.color!.l;
    return a.color!.h - b.color!.h; // by hue
  });
  return [...withColor, ...withoutColor];
}

interface ResultState {
  artworks: Artwork[];
  errors: SourceError[];
  origin: "manual" | "claude" | "collection";
  /** wall title: the query, the category labels, or the collection name */
  heading?: string;
  /** curator's note under the title */
  note?: string;
}

interface Interpretation {
  query: SearchQuery;
  explanation: string;
  method: "vocab" | "claude" | "llm" | "fallback";
}

/** compiled-query chips — readable field names per facet entry */
const FIELD_LABELS: Record<string, string> = {
  styleName: "style",
  subjectName: "subject",
  classificationName: "classification",
  departmentName: "department",
  departmentId: "department",
  dateFrom: "from",
  dateTo: "to",
  dateBegin: "from",
  dateEnd: "to",
  createdAfter: "after",
  createdBefore: "before",
  geoLocation: "geo",
  medium: "medium",
  technique: "technique",
  type: "type",
  culture: "culture",
  material: "material",
  datingPeriod: "century",
  q: "q",
  tags: "tags",
};

const METHOD_LABELS: Record<Interpretation["method"], string> = {
  vocab: "matched the shared vocabulary",
  claude: "compiled by Claude",
  llm: "compiled by the model",
  fallback: "searched as typed",
};

interface QueryChip {
  id: string;
  label: string;
  value: string;
}

function queryChips(query: SearchQuery): QueryChip[] {
  const chips: QueryChip[] = [];
  if (query.q) chips.push({ id: "q", label: "q", value: query.q });
  if (query.artist) chips.push({ id: "artist", label: "artist", value: query.artist });
  if (query.dateRange)
    chips.push({
      id: "dateRange",
      label: "dates",
      value: `${query.dateRange[0]}–${query.dateRange[1]}`,
    });
  for (const source of Object.keys(query.facets ?? {}) as (keyof SearchFacets)[]) {
    const ns = query.facets?.[source] as Record<string, unknown> | undefined;
    if (!ns) continue;
    for (const [field, value] of Object.entries(ns)) {
      if (value === undefined) continue;
      chips.push({
        id: `${source}.${field}`,
        label: `${source} ${FIELD_LABELS[field] ?? field}`,
        value: String(value),
      });
    }
  }
  return chips;
}

/** remove one chip's field from a compiled query (chip ids from queryChips) */
function removeQueryField(query: SearchQuery, chipId: string): SearchQuery {
  const next: SearchQuery = structuredClone(query);
  if (chipId === "q") delete next.q;
  else if (chipId === "artist") delete next.artist;
  else if (chipId === "dateRange") delete next.dateRange;
  else {
    const [source, field] = chipId.split(".") as [keyof SearchFacets, string];
    const ns = next.facets?.[source] as Record<string, unknown> | undefined;
    if (ns) {
      delete ns[field];
      if (Object.keys(ns).length === 0) delete next.facets?.[source];
      if (next.facets && Object.keys(next.facets).length === 0) delete next.facets;
    }
  }
  return next;
}

// SMK and Mia are keyless and always on. Two sources stay registered-but-
// dormant and are omitted here until their key exists (same pattern): Rijks
// (classic keyed API deprecated, keyless replacement returns only Linked-Art
// IRIs) and Harvard (needs a free HARVARD_API_KEY; its enabled() gate is
// false without one). Add "harvard" / "rijks" here once the key lands.
const ALL_SOURCES: SourceId[] = ["aic", "cma", "met", "smk", "mia"];
const EMPTY: ResultState = { artworks: [], errors: [], origin: "manual" };

/** Starting points on the empty wall — each one a real query that returns
 *  well. Keyword searches and taxonomy picks, mixed. */
const STARTERS: { label: string; run: "search" | "category"; value: string }[] = [
  { label: "Whistler nocturnes", run: "search", value: "nocturne" },
  { label: "Monet's mist", run: "search", value: "monet mist" },
  { label: "Dutch Golden Age", run: "category", value: "dutch-golden-age" },
  { label: "Still life", run: "category", value: "still-life" },
  { label: "Ukiyo-e prints", run: "category", value: "ukiyo-e" },
  { label: "Seascapes", run: "category", value: "seascape" },
  { label: "Water lilies", run: "search", value: "water lilies" },
];

/** Hand a Blob to the browser as a download. */
function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Single-work download fetched by the browser itself. For sources whose image
 * host blocks datacenter IPs (AIC — see source-egress.ts) the server route
 * can't fetch the file on a deployed build, but the viewer's own browser can:
 * no Referer, and AIC sends CORS `*`. Returns a status line for the note.
 */
async function downloadDirect(artwork: Artwork): Promise<string> {
  try {
    const res = await fetch(artwork.imageHires, { referrerPolicy: "no-referrer" });
    if (!res.ok) return "The museum didn't serve the file. Try again, or open it at the source.";
    const filename = `${fileBaseName(artwork)}.${imageExtension(artwork.imageHires)}`;
    saveBlob(await res.blob(), filename);
    return `Saved ${filename}`;
  } catch {
    return "The download didn't go through. Check the connection and try again.";
  }
}

/**
 * POST an export request and save the streamed response as a file — the server
 * fetches the images and hands back an image (one work) or a zip (many); the
 * browser download works the same on localhost and on a deployed host. Returns
 * a status line for the export note.
 */
async function triggerDownload(body: {
  artworks?: Artwork[];
  folderName?: string;
}): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return "The download didn't go through. Check the connection and try again.";
  }
  if (!res.ok) {
    try {
      const j = (await res.json()) as { error?: string };
      return j.error ?? "The download didn't go through.";
    } catch {
      return "The download didn't go through.";
    }
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const filename = /filename="(.+?)"/.exec(cd)?.[1] ?? "curio-export";
  const failed = Number(res.headers.get("x-export-failed") ?? "0");
  saveBlob(await res.blob(), filename);
  return failed > 0
    ? `Saved ${filename}. ${failed} ${failed === 1 ? "image was" : "images were"} unavailable and skipped.`
    : `Saved ${filename}`;
}

export default function Home() {
  const [results, setResults] = useState<ResultState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState<Artwork | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const [sources, setSources] = useState<SourceId[]>(ALL_SOURCES);
  const [artist, setArtist] = useState("");
  const [sort, setSort] = useState<SortMode>("relevance");
  const [heroOnly, setHeroOnly] = useState(false);
  // Picked target color for search-by-color; when set, sort is "similar".
  const [targetColor, setTargetColor] = useState<HSL | undefined>();
  // Movement chips are derived from the current results (see the memo
  // below), not a fixed taxonomy — this only holds which of *those* are
  // toggled on. Multi-select = union (show works matching ANY selected
  // movement), same as ticking multiple source checkboxes.
  const [activeMovements, setActiveMovements] = useState<string[]>([]);
  // Taxonomy selections across every group (Movements/Periods/Subjects/…).
  // Multiple compose as an intersection via mergeCategoryQueries — see
  // runCategories below. Single-select is just the length-1 case.
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [interpretOn, setInterpretOn] = useState(false);
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  // last keyword the user searched — the no-results state repeats it
  const [lastQuery, setLastQuery] = useState("");

  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | undefined>();
  const [exporting, setExporting] = useState<string | undefined>();
  const [exportNote, setExportNote] = useState<string | undefined>();
  // one-line confirmation inside the detail panel after Save / Remove
  const [saveNote, setSaveNote] = useState<string | undefined>();

  // Collections live in localStorage (Curio deploys to a read-only host) — read
  // them once on mount, client-side only.
  useEffect(() => {
    setCollections(listCollections());
  }, []);

  // Notes clear themselves; a stale "Saved …" beside a different work lies.
  useEffect(() => {
    if (!saveNote) return;
    const t = setTimeout(() => setSaveNote(undefined), 4000);
    return () => clearTimeout(t);
  }, [saveNote]);
  useEffect(() => {
    if (!exportNote) return;
    const t = setTimeout(() => setExportNote(undefined), 8000);
    return () => clearTimeout(t);
  }, [exportNote]);

  // "calmest" sort: re-render (and re-sort, via the calmTick dependency
  // below) whenever any card's score resolves. Subscribed unconditionally
  // — cheap, and avoids a subscribe/unsubscribe dance each time sort mode
  // flips — but requestCalmForAll only fires while "calmest" is selected.
  const [calmTick, setCalmTick] = useState(0);
  useEffect(() => subscribeCalm(() => setCalmTick((t) => t + 1)), []);
  useEffect(() => {
    if (sort === "calmest") requestCalmForAll(results.artworks);
  }, [sort, results.artworks]);

  // Latest-wins guard: multi-select taxonomy can fire overlapping searches as
  // the user ticks several categories in a row; only the newest response is
  // allowed to land so an earlier, slower fanout can't overwrite it.
  const reqSeq = useRef(0);

  const fetchResults = useCallback(
    async (params: URLSearchParams, heading: string) => {
      const myId = ++reqSeq.current;
      setLoading(true);
      setSearched(true);
      setActiveCollection(undefined);
      setActiveMovements([]);
      setResults((r) => ({ ...r, heading, note: undefined, origin: "manual" }));
      try {
        const res = await fetch(`/api/search?${params}`);
        const json = (await res.json()) as SearchResponse;
        if (reqSeq.current !== myId) return;
        setResults({ ...json, origin: "manual", heading });
      } catch {
        if (reqSeq.current !== myId) return;
        setResults({ ...EMPTY, heading });
      } finally {
        if (reqSeq.current === myId) setLoading(false);
      }
    },
    [],
  );

  // POST a full SearchQuery (interpret mode + chip edits + taxonomy merge) —
  // same fanout as GET
  const runQuerySearch = useCallback(
    async (query: SearchQuery, heading: string) => {
      const myId = ++reqSeq.current;
      setLoading(true);
      setSearched(true);
      setActiveCollection(undefined);
      setActiveMovements([]);
      setResults((r) => ({ ...r, heading, note: undefined, origin: "manual" }));
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, sources }),
        });
        const json = (await res.json()) as SearchResponse;
        if (reqSeq.current !== myId) return; // superseded
        setResults({ ...json, origin: "manual", heading });
      } catch {
        if (reqSeq.current !== myId) return;
        setResults({ ...EMPTY, heading });
      } finally {
        if (reqSeq.current === myId) setLoading(false);
      }
    },
    [sources],
  );

  const runInterpret = useCallback(
    async (q: string) => {
      setActiveCategories([]);
      setLoading(true);
      setSearched(true);
      setResults((r) => ({ ...r, heading: q, note: undefined, origin: "manual" }));
      // the route itself degrades; this is only for network-level failure
      let interp: Interpretation = {
        query: { q },
        explanation: "Searched as typed.",
        method: "fallback",
      };
      try {
        const res = await fetch("/api/interpret", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ q }),
        });
        if (res.ok) interp = (await res.json()) as Interpretation;
      } catch {
        /* keep fallback */
      }
      setInterpretation(interp);
      await runQuerySearch(interp.query, q);
    },
    [runQuerySearch],
  );

  const runSearch = useCallback(
    (q: string) => {
      setLastQuery(q);
      if (interpretOn) {
        void runInterpret(q);
        return;
      }
      setInterpretation(null);
      setActiveCategories([]);
      const params = new URLSearchParams({ q, sources: sources.join(",") });
      if (artist.trim()) params.set("artist", artist.trim());
      void fetchResults(params, artist.trim() ? `${q} · ${artist.trim()}` : q);
    },
    [interpretOn, runInterpret, artist, sources, fetchResults],
  );

  const removeChip = useCallback(
    (chipId: string) => {
      if (!interpretation) return;
      const next = removeQueryField(interpretation.query, chipId);
      setInterpretation({ ...interpretation, query: next });
      void runQuerySearch(next, lastQuery);
    },
    [interpretation, runQuerySearch, lastQuery],
  );

  const setInterpretMode = useCallback((on: boolean) => {
    setInterpretOn(on);
    setInterpretation(null); // entering has no chips yet; leaving clears them
  }, []);

  // Back to the empty wall: cancel anything in flight, drop every selection.
  const clearAll = useCallback(() => {
    reqSeq.current++;
    setLoading(false);
    setResults(EMPTY);
    setSearched(false);
    setInterpretation(null);
    setActiveCategories([]);
    setActiveCollection(undefined);
    setActiveMovements([]);
    setLastQuery("");
  }, []);

  // Run the intersection of a taxonomy selection set. Empty set clears back to
  // the prompt (the last filter was removed); otherwise the merged query fans
  // out. A taxonomy pick IS the query, so this owns the results.
  const runCategories = useCallback(
    (ids: string[]) => {
      setInterpretation(null);
      setActiveCollection(undefined);
      if (ids.length === 0) {
        reqSeq.current++; // cancel any in-flight taxonomy fetch
        setLoading(false);
        setResults(EMPTY);
        setSearched(false);
        return;
      }
      const heading = ids
        .map((id) => getCategory(id)?.label ?? id)
        .join(" + ");
      setLastQuery(heading);
      void runQuerySearch(mergeCategoryQueries(ids), heading);
    },
    [runQuerySearch],
  );

  const toggleCategory = useCallback(
    (id: string) => {
      const next = activeCategories.includes(id)
        ? activeCategories.filter((x) => x !== id)
        : [...activeCategories, id];
      setActiveCategories(next);
      runCategories(next);
    },
    [activeCategories, runCategories],
  );

  const toggleSource = useCallback((s: SourceId) => {
    setSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }, []);

  const toggleMovement = useCallback((m: string) => {
    setActiveMovements((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m],
    );
  }, []);

  // Picking a color IS choosing the "similar" sort; clearing reverts to
  // relevance. Choosing any other sort explicitly drops the color so the row
  // never shows a picked color that isn't actually driving the order.
  const pickColor = useCallback((c: HSL) => {
    setTargetColor(c);
    setSort("similar");
  }, []);

  const clearColor = useCallback(() => {
    setTargetColor(undefined);
    setSort((s) => (s === "similar" ? "relevance" : s));
  }, []);

  const chooseSort = useCallback((m: SortMode) => {
    setSort(m);
    if (m !== "similar") setTargetColor(undefined);
  }, []);

  // — collections —

  const collectionSummaries = collections.map((c) => ({
    id: c.id,
    name: c.name,
    count: c.artworks.length,
    has: open ? c.artworks.some((a) => a.id === open.id) : false,
  }));

  const saveToCollection = useCallback(
    (collectionId: string) => {
      if (!open) return;
      const col = collections.find((c) => c.id === collectionId);
      if (col?.artworks.some((a) => a.id === open.id)) {
        setCollections(removeArtwork(collectionId, open.id));
        setSaveNote(`Removed from ${col.name}`);
      } else {
        setCollections(addArtwork(collectionId, open));
        setSaveNote(`Saved to ${col?.name ?? "collection"}`);
      }
      setSaveOpen(false);
    },
    [open, collections],
  );

  const createAndSave = useCallback(
    (name: string) => {
      if (!open) return;
      const withNew = createCollection(name);
      const target = withNew.find((c) => c.name === name);
      if (target) {
        setCollections(addArtwork(target.id, open));
        setSaveNote(`Saved to ${name}`);
      } else {
        setCollections(withNew);
      }
      setSaveOpen(false);
    },
    [open],
  );

  const openCollection = useCallback(
    (id: string) => {
      const c = collections.find((x) => x.id === id);
      if (!c) return;
      reqSeq.current++;
      setLoading(false);
      setSearched(true);
      setActiveCategories([]);
      setInterpretation(null);
      setActiveCollection(id);
      setActiveMovements([]);
      setResults({
        artworks: c.artworks,
        errors: [],
        origin: "collection",
        heading: c.name,
        note: c.artworks.length === 0 ? "Nothing saved here yet." : undefined,
      });
    },
    [collections],
  );

  const removeCollection = useCallback(
    (id: string) => {
      const c = collections.find((x) => x.id === id);
      if (!c) return;
      const n = c.artworks.length;
      if (
        n > 0 &&
        !window.confirm(`Delete “${c.name}” and its ${n} saved ${n === 1 ? "work" : "works"}?`)
      )
        return;
      setCollections(deleteCollection(id));
      if (activeCollection === id) clearAll();
    },
    [collections, activeCollection, clearAll],
  );

  // Viewing a collection: the detail's Remove takes the work out and the wall
  // updates in place.
  const removeFromActiveCollection = useCallback(
    (artwork: Artwork) => {
      if (!activeCollection) return;
      const next = removeArtwork(activeCollection, artwork.id);
      setCollections(next);
      const c = next.find((x) => x.id === activeCollection);
      setResults((r) => ({
        ...r,
        artworks: r.artworks.filter((a) => a.id !== artwork.id),
        note: c && c.artworks.length === 0 ? "Nothing saved here yet." : undefined,
      }));
      setSaveNote(`Removed from ${c?.name ?? "collection"}`);
      setOpen(null);
    },
    [activeCollection],
  );

  // Collections are client-side now, so resolve the artworks here and hand them
  // to the export route (which only touches the network, never a filesystem).
  const exportCollection = useCallback(async (id: string) => {
    const collection = getCollection(id);
    if (!collection || collection.artworks.length === 0) {
      setExportNote("Nothing to download yet.");
      return;
    }
    setExporting(id);
    setExportNote(undefined);
    try {
      setExportNote(
        await triggerDownload({
          artworks: collection.artworks,
          folderName: collection.name,
        }),
      );
    } finally {
      setExporting(undefined);
    }
  }, []);

  const [downloading, setDownloading] = useState(false);
  const exportOne = useCallback(async (artwork: Artwork) => {
    setExportNote(undefined);
    setDownloading(true);
    try {
      setExportNote(
        serverCanFetch(artwork.source)
          ? await triggerDownload({ artworks: [artwork] })
          : await downloadDirect(artwork),
      );
    } finally {
      setDownloading(false);
    }
  }, []);

  const onSelection = useCallback((artworks: Artwork[], note: string) => {
    reqSeq.current++;
    setLoading(false);
    setSearched(true);
    setActiveCategories([]);
    setInterpretation(null);
    setActiveCollection(undefined);
    setActiveMovements([]);
    setResults({
      artworks,
      errors: [],
      origin: "claude",
      heading: "Curator's selection",
      note,
    });
  }, []);

  // Client-side only — enrich, filter, then sort over the already-fetched
  // results. Enrichment (the Wikidata artist→movement join, see
  // src/lib/movements.ts) runs first so every downstream consumer — the
  // movement chip row, the movement filter, and DetailView (which receives
  // whichever artwork object was clicked out of displayArtworks) — sees
  // `movements` whether the source is AIC, Met, or CMA.
  //
  // Hero rule: dims are only sometimes known, so a work with no usable
  // width/height can never be *confirmed* hero-fit — it's excluded rather
  // than guessed into the grid. To keep that exclusion from silently
  // hollowing out the grid, the count hidden for missing dims is surfaced
  // as a caption instead of just vanishing.
  //
  // Movement chips are derived from the hero-filtered list (what's actually
  // browsable right now) and only rendered when non-empty; multi-select is
  // a union (OR) — a work matching any selected movement stays in.
  const { displayArtworks, heroHiddenCount, availableMovements, colorlessCount } =
    useMemo(() => {
    let list = enrichArtworksWithMovements(results.artworks);
    let hiddenForDims = 0;
    if (heroOnly) {
      const withDims = list.filter((a) => a.dims?.width && a.dims?.height);
      hiddenForDims = list.length - withDims.length;
      list = withDims.filter(fitsHero);
    }

    const movementSet = new Set<string>();
    for (const a of list) for (const m of a.movements ?? []) movementSet.add(m);
    const availableMovements = Array.from(movementSet).sort();

    if (activeMovements.length > 0) {
      list = list.filter((a) => a.movements?.some((m) => activeMovements.includes(m)));
    }

    // Under color ranking, how many of the shown works have no color to rank
    // by (they sort last) — surfaced as a caption so the tail isn't a mystery.
    const colorlessCount =
      sort === "similar" && targetColor
        ? list.filter((a) => !a.color).length
        : 0;

    return {
      displayArtworks: sortArtworks(list, sort, targetColor),
      heroHiddenCount: hiddenForDims,
      availableMovements,
      colorlessCount,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- calmTick forces
    // a re-sort as lazily-computed scores resolve; it carries no data itself.
  }, [results.artworks, sort, heroOnly, activeMovements, targetColor, calmTick]);

  // Detail navigation: ← / → walk the wall in its displayed order.
  const openIndex = open ? displayArtworks.findIndex((a) => a.id === open.id) : -1;
  const openPrev =
    openIndex > 0
      ? () => {
          setSaveOpen(false);
          setOpen(displayArtworks[openIndex - 1]);
        }
      : undefined;
  const openNext =
    openIndex >= 0 && openIndex < displayArtworks.length - 1
      ? () => {
          setSaveOpen(false);
          setOpen(displayArtworks[openIndex + 1]);
        }
      : undefined;

  const showWall = searched || results.artworks.length > 0;
  const enabledLabels = ALL_SOURCES.filter((s) => sources.includes(s));

  return (
    <>
      <main
        // The detail view is a full-screen dialog; everything under it is
        // inert so tab order and screen readers stay inside the dialog.
        inert={open ? true : undefined}
        className={`mx-auto max-w-[1440px] px-6 pb-24 transition-[margin] duration-200 ease-[var(--ease-in-out)] ${
          panelOpen ? "lg:mr-[420px]" : ""
        }`}
      >
        <header className="flex flex-col gap-6 border-b border-ink py-8">
          <div className="flex items-end justify-between gap-4">
            {/* display — wordmark is intentionally lowercase */}
            <h1 className="text-outline text-[64px] leading-[1.05] font-bold tracking-[-0.02em] max-md:text-[44px]">
              <button
                type="button"
                onClick={clearAll}
                title="Back to the start"
                className="press-none text-inherit"
              >
                curio
              </button>
            </h1>
            <div className="flex items-center gap-3">
              <p className="caption hidden lg:block">
                Open-access museum art for design backdrops · by{" "}
                <a
                  href="https://latip.me"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-ink"
                >
                  Shaun Latip
                </a>{" "}
                ·{" "}
                <a
                  href="https://github.com/shaunlatip/loupe"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover:text-ink"
                >
                  GitHub
                </a>
              </p>
              <button
                onClick={() => setPanelOpen((v) => !v)}
                aria-pressed={panelOpen}
                aria-controls="curator-panel"
                className={`border border-ink px-4 py-2 text-[13px] font-semibold ${
                  panelOpen ? "bg-accent text-paper" : "invert-hover"
                }`}
              >
                Curator
              </button>
            </div>
          </div>
          <SearchBar
            onSearch={runSearch}
            onClear={clearAll}
            loading={loading}
            interpret={interpretOn}
            onSetInterpret={setInterpretMode}
          />
          {interpretation && (
            <div className="animate-rise flex flex-col gap-2">
              <p className="caption">
                {interpretation.explanation}{" "}
                <span className="text-ink/60">· {METHOD_LABELS[interpretation.method]}</span>
              </p>
              {queryChips(interpretation.query).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {queryChips(interpretation.query).map((chip, i) => (
                    <span
                      key={chip.id}
                      className="animate-rise flex items-center border border-ink text-[11px]"
                      style={{ ["--stagger" as string]: `${i * 30}ms` }}
                    >
                      <span className="py-1 pl-2 text-muted-foreground">
                        {chip.label}:
                      </span>
                      <span className="py-1 pr-1 pl-1.5 font-mono">{chip.value}</span>
                      <button
                        type="button"
                        onClick={() => removeChip(chip.id)}
                        aria-label={`Remove ${chip.label}`}
                        title="Remove and search again"
                        className="invert-hover press-none self-stretch border-l border-ink px-2 text-[13px] leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          <FilterRow
            sources={ALL_SOURCES}
            enabled={sources}
            onToggleSource={toggleSource}
            activeCategories={activeCategories}
            onToggleCategory={toggleCategory}
            artist={artist}
            onArtist={setArtist}
            sort={sort}
            onSort={chooseSort}
            heroOnly={heroOnly}
            onHeroToggle={() => setHeroOnly((v) => !v)}
            targetColor={targetColor}
            onPickColor={pickColor}
            onClearColor={clearColor}
            movements={availableMovements}
            activeMovements={activeMovements}
            onToggleMovement={toggleMovement}
          />
        </header>

        <div className="border-b border-ink py-3">
          <CollectionsBar
            collections={collectionSummaries}
            active={activeCollection}
            onOpen={openCollection}
            onExport={(id) => void exportCollection(id)}
            onDelete={removeCollection}
            exporting={exporting}
          />
          {exportNote && (
            <p className="caption animate-rise mt-2" role="status">
              {exportNote}
            </p>
          )}
        </div>

        <div className="pt-8">
          {showWall ? (
            <>
              {heroOnly && heroHiddenCount > 0 && (
                <p className="caption animate-rise mb-4">
                  Fits a hero is hiding {heroHiddenCount}{" "}
                  {heroHiddenCount === 1 ? "work" : "works"} whose size the museum
                  doesn&rsquo;t report.
                </p>
              )}
              {sort === "similar" && colorlessCount > 0 && (
                <p className="caption animate-rise mb-4">
                  Color ranking uses each museum&rsquo;s own palette data (AIC, SMK,
                  Harvard). {colorlessCount}{" "}
                  {colorlessCount === 1 ? "work has" : "works have"} none and sit at
                  the end.
                </p>
              )}
              <ResultGrid
                artworks={displayArtworks}
                errors={results.errors}
                heading={results.heading}
                note={results.note}
                loading={loading}
                emptyHint={
                  results.origin === "collection" ? (
                    <span>Open any work and press Save to add it here.</span>
                  ) : heroOnly && results.artworks.length > 0 ? (
                    <span>
                      Every result failed the hero rule (landscape, 2000px wide or
                      more). Turn off Fits a hero to see them.
                    </span>
                  ) : activeMovements.length > 0 && results.artworks.length > 0 ? (
                    <span>No work here carries that movement. Clear the Movement filter.</span>
                  ) : (
                    <>
                      {enabledLabels.length === 0 ? (
                        <span>No museum is switched on. Pick some under Sources.</span>
                      ) : (
                        enabledLabels.length < ALL_SOURCES.length && (
                          <span>
                            Only {enabledLabels.map(sourceLabel).join(", ")}{" "}
                            {enabledLabels.length === 1 ? "is" : "are"} switched on. Add
                            the rest under Sources.
                          </span>
                        )
                      )}
                      {artist.trim() && (
                        <span>The Artist field is narrowing this. Try clearing it.</span>
                      )}
                      {!interpretOn && lastQuery && (
                        <span>
                          Keyword mode matches museum records literally.{" "}
                          <button
                            type="button"
                            onClick={() => {
                              setInterpretMode(true);
                              void runInterpret(lastQuery);
                            }}
                            className="underline underline-offset-2 hover:text-ink"
                          >
                            Interpret &ldquo;{lastQuery}&rdquo; instead
                          </button>
                          .
                        </span>
                      )}
                      <span>
                        Or{" "}
                        <button
                          type="button"
                          onClick={() => setPanelOpen(true)}
                          className="underline underline-offset-2 hover:text-ink"
                        >
                          ask the curator
                        </button>{" "}
                        to search across phrasing and sources for you.
                      </span>
                    </>
                  )
                }
                onOpen={(a) => {
                  setSaveOpen(false);
                  setOpen(a);
                }}
              />
            </>
          ) : (
            <EmptyWall
              onSearch={runSearch}
              onCategory={(id) => {
                setActiveCategories([id]);
                runCategories([id]);
              }}
              onCurator={() => setPanelOpen(true)}
            />
          )}
        </div>
      </main>

      {open && (
        <DetailView
          artwork={open}
          onClose={() => {
            setOpen(null);
            setSaveOpen(false);
          }}
          onPrev={openPrev}
          onNext={openNext}
          position={
            openIndex >= 0 ? { index: openIndex + 1, total: displayArtworks.length } : undefined
          }
          actions={
            <>
              <div className="flex gap-2">
                <button
                  onClick={() => setSaveOpen((v) => !v)}
                  aria-expanded={saveOpen}
                  className={`flex-1 border border-ink px-4 py-2 text-[13px] font-semibold ${
                    saveOpen ? "bg-ink text-paper" : "invert-hover"
                  }`}
                >
                  {collectionSummaries.some((c) => c.has) ? "Saved" : "Save"}
                </button>
                <button
                  onClick={() => void exportOne(open)}
                  disabled={downloading}
                  aria-busy={downloading}
                  className="invert-hover flex-1 border border-ink px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
                >
                  {downloading ? "Fetching…" : "Download"}
                </button>
              </div>
              {results.origin === "collection" && activeCollection && (
                <button
                  onClick={() => removeFromActiveCollection(open)}
                  className="invert-hover border border-ink px-4 py-2 text-[13px]"
                >
                  Remove from this collection
                </button>
              )}
              {saveOpen && (
                <SaveMenu
                  artwork={open}
                  collections={collectionSummaries}
                  onSave={(id) => void saveToCollection(id)}
                  onCreate={(name) => void createAndSave(name)}
                />
              )}
              {(saveNote || exportNote) && (
                <p className="caption animate-rise" role="status">
                  {saveNote ?? exportNote}
                </p>
              )}
            </>
          }
        />
      )}

      <ClaudePanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        onSelection={onSelection}
      />
    </>
  );
}

/**
 * The empty wall. A statement of what this is, then real starting points —
 * each chip runs a query that returns well, so the first click always lands
 * on pictures. Sits in the same register as a museum's intro wall text.
 */
function EmptyWall({
  onSearch,
  onCategory,
  onCurator,
}: {
  onSearch: (q: string) => void;
  onCategory: (id: string) => void;
  onCurator: () => void;
}) {
  const groups = ["Movements", "Subjects"] as const;
  return (
    <div className="animate-fade grid gap-10 py-6 md:grid-cols-[1.2fr_1fr] md:gap-16 md:py-12">
      <div className="flex flex-col gap-6">
        <p className="pretty max-w-[26ch] text-[28px] leading-[1.15] font-semibold tracking-[-0.01em] max-md:text-[22px]">
          Public-domain paintings, sized for a hero, from five museums&rsquo; open
          collections.
        </p>
        <p className="pretty max-w-[52ch] text-[14px] leading-relaxed text-muted-foreground">
          Search by keyword, or switch to Interpret and describe the mood you want
          behind your UI. Every result is CC0 or public domain and downloads at full
          resolution with attribution.
        </p>
        <div className="flex flex-wrap gap-2">
          {STARTERS.map((s, i) => (
            <button
              key={s.label}
              type="button"
              onClick={() => (s.run === "search" ? onSearch(s.value) : onCategory(s.value))}
              className="invert-hover animate-rise border border-ink px-3 py-1.5 text-[13px]"
              style={{ ["--stagger" as string]: `${80 + i * 35}ms` }}
            >
              {s.label}
            </button>
          ))}
          <button
            type="button"
            onClick={onCurator}
            className="animate-rise border border-accent px-3 py-1.5 text-[13px] text-accent transition-colors hover:bg-accent hover:text-paper"
            style={{ ["--stagger" as string]: `${80 + STARTERS.length * 35}ms` }}
          >
            Ask the curator
          </button>
        </div>
      </div>
      <dl className="flex flex-col gap-4 border-t border-ink pt-4 md:border-t-0 md:border-l md:pt-0 md:pl-8">
        {groups.map((g) => (
          <div key={g}>
            <dt className="caption mb-1.5">{g}</dt>
            <dd className="flex flex-wrap gap-x-3 gap-y-1">
              {CATEGORIES.filter((c) => c.group === g).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onCategory(c.id)}
                  className="press-none text-[13px] underline-offset-2 hover:underline"
                >
                  {c.label}
                </button>
              ))}
            </dd>
          </div>
        ))}
        <div>
          <dt className="caption mb-1.5">Sources</dt>
          <dd className="pretty text-[13px] text-muted-foreground">
            {ALL_SOURCES.map(sourceLabel).join(" · ")}
          </dd>
        </div>
        <div>
          <dt className="caption mb-1.5">Keys</dt>
          <dd className="text-[13px] text-muted-foreground">
            <kbd className="font-mono text-[11px]">/</kbd> search ·{" "}
            <kbd className="font-mono text-[11px]">←</kbd>{" "}
            <kbd className="font-mono text-[11px]">→</kbd> step through works ·{" "}
            <kbd className="font-mono text-[11px]">esc</kbd> close
          </dd>
        </div>
      </dl>
    </div>
  );
}
