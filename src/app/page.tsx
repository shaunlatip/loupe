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
import { mergeCategoryQueries } from "@/lib/presets";
import { type HSL, colorDistance } from "@/lib/color";
import SearchBar from "@/components/SearchBar";
import ResultGrid from "@/components/ResultGrid";
import DetailView from "@/components/DetailView";
import FilterRow, { type SortMode } from "@/components/FilterRow";
import CollectionsBar from "@/components/CollectionsBar";
import SaveMenu from "@/components/SaveMenu";
import ClaudePanel from "@/components/ClaudePanel";
import {
  type Collection,
  addArtwork,
  createCollection,
  getCollection,
  listCollections,
} from "@/lib/collections-client";

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
  note?: string;
}

interface Interpretation {
  query: SearchQuery;
  explanation: string;
  method: "vocab" | "claude" | "fallback";
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
    return "Download failed";
  }
  if (!res.ok) {
    try {
      const j = (await res.json()) as { error?: string };
      return j.error ?? "Download failed";
    } catch {
      return "Download failed";
    }
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const filename = /filename="(.+?)"/.exec(cd)?.[1] ?? "loupe-export";
  const failed = Number(res.headers.get("x-export-failed") ?? "0");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return failed > 0
    ? `Downloaded ${filename} — ${failed} image${failed === 1 ? "" : "s"} unavailable`
    : `Downloaded ${filename}`;
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

  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | undefined>();
  const [exporting, setExporting] = useState<string | undefined>();
  const [exportNote, setExportNote] = useState<string | undefined>();

  // Collections live in localStorage (Loupe deploys to a read-only host) — read
  // them once on mount, client-side only.
  useEffect(() => {
    setCollections(listCollections());
  }, []);

  // "calmest" sort: re-render (and re-sort, via the calmTick dependency
  // below) whenever any card's score resolves. Subscribed unconditionally
  // — cheap, and avoids a subscribe/unsubscribe dance each time sort mode
  // flips — but requestCalmForAll only fires while "calmest" is selected.
  const [calmTick, setCalmTick] = useState(0);
  useEffect(() => subscribeCalm(() => setCalmTick((t) => t + 1)), []);
  useEffect(() => {
    if (sort === "calmest") requestCalmForAll(results.artworks);
  }, [sort, results.artworks]);

  const fetchResults = useCallback(
    async (params: URLSearchParams, origin: ResultState["origin"]) => {
      setLoading(true);
      setSearched(true);
      setActiveCollection(undefined);
      setActiveMovements([]);
      try {
        const res = await fetch(`/api/search?${params}`);
        const json = (await res.json()) as SearchResponse;
        setResults({ ...json, origin });
      } catch {
        setResults({ ...EMPTY, origin });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Latest-wins guard: multi-select taxonomy can fire overlapping searches as
  // the user ticks several categories in a row; only the newest response is
  // allowed to land so an earlier, slower fanout can't overwrite it.
  const reqSeq = useRef(0);

  // POST a full SearchQuery (interpret mode + chip edits + taxonomy merge) —
  // same fanout as GET
  const runQuerySearch = useCallback(
    async (query: SearchQuery) => {
      const myId = ++reqSeq.current;
      setLoading(true);
      setSearched(true);
      setActiveCollection(undefined);
      setActiveMovements([]);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, sources }),
        });
        const json = (await res.json()) as SearchResponse;
        if (reqSeq.current !== myId) return; // superseded
        setResults({ ...json, origin: "manual" });
      } catch {
        if (reqSeq.current !== myId) return;
        setResults({ ...EMPTY, origin: "manual" });
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
      // the route itself degrades; this is only for network-level failure
      let interp: Interpretation = {
        query: { q },
        explanation: "searched as-is",
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
      await runQuerySearch(interp.query);
    },
    [runQuerySearch],
  );

  const runSearch = useCallback(
    (q: string) => {
      if (interpretOn) {
        void runInterpret(q);
        return;
      }
      setInterpretation(null);
      setActiveCategories([]);
      const params = new URLSearchParams({ q, sources: sources.join(",") });
      if (artist.trim()) params.set("artist", artist.trim());
      void fetchResults(params, "manual");
    },
    [interpretOn, runInterpret, artist, sources, fetchResults],
  );

  const removeChip = useCallback(
    (chipId: string) => {
      if (!interpretation) return;
      const next = removeQueryField(interpretation.query, chipId);
      setInterpretation({ ...interpretation, query: next });
      void runQuerySearch(next);
    },
    [interpretation, runQuerySearch],
  );

  const setInterpretMode = useCallback((on: boolean) => {
    setInterpretOn(on);
    setInterpretation(null); // entering has no chips yet; leaving clears them
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
        setResults(EMPTY);
        setSearched(false);
        return;
      }
      void runQuerySearch(mergeCategoryQueries(ids));
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
  }));

  const saveToCollection = useCallback(
    (collectionId: string) => {
      if (!open) return;
      setCollections(addArtwork(collectionId, open));
      setSaveOpen(false);
    },
    [open],
  );

  const createAndSave = useCallback(
    (name: string) => {
      if (!open) return;
      const withNew = createCollection(name);
      const target = withNew.find((c) => c.name === name);
      if (target) {
        setCollections(addArtwork(target.id, open));
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
      setSearched(true);
      setActiveCategories([]);
      setInterpretation(null);
      setActiveCollection(id);
      setActiveMovements([]);
      setResults({
        artworks: c.artworks,
        errors: [],
        origin: "collection",
        note: `Collection — ${c.name}`,
      });
    },
    [collections],
  );

  // Collections are client-side now, so resolve the artworks here and hand them
  // to the export route (which only touches the network, never a filesystem).
  const exportCollection = useCallback(async (id: string) => {
    const collection = getCollection(id);
    if (!collection || collection.artworks.length === 0) {
      setExportNote("Nothing to export");
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

  const exportOne = useCallback(async (artwork: Artwork) => {
    setExportNote(undefined);
    setExportNote(await triggerDownload({ artworks: [artwork] }));
  }, []);

  const onSelection = useCallback((artworks: Artwork[], note: string) => {
    setSearched(true);
    setActiveCategories([]);
    setInterpretation(null);
    setActiveCollection(undefined);
    setActiveMovements([]);
    setResults({ artworks, errors: [], origin: "claude", note });
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

  return (
    <>
      <main
        className={`mx-auto max-w-[1440px] px-6 pb-24 transition-[margin] duration-200 ease-out ${
          panelOpen ? "lg:mr-[420px]" : ""
        }`}
      >
        <header className="flex flex-col gap-6 border-b border-ink py-8">
          <div className="flex items-end justify-between gap-4">
            {/* display — wordmark is intentionally lowercase */}
            <h1 className="text-outline text-[64px] leading-[1.05] font-bold tracking-[-0.02em] max-md:text-[44px]">
              loupe
            </h1>
            <div className="flex items-center gap-3">
              <p className="caption hidden lg:block">
                Search open-access museum art · Built by{" "}
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
            loading={loading}
            interpret={interpretOn}
            onSetInterpret={setInterpretMode}
          />
          {interpretation && (
            <div className="flex flex-col gap-2">
              <p className="caption">
                {interpretation.explanation}{" "}
                <span className="font-mono text-[10px]">· {interpretation.method}</span>
              </p>
              {queryChips(interpretation.query).length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {queryChips(interpretation.query).map((chip) => (
                    <span
                      key={chip.id}
                      className="flex items-center border border-ink text-[11px]"
                    >
                      <span className="py-1 pl-2 text-muted-foreground">
                        {chip.label}:
                      </span>
                      <span className="py-1 pr-1 pl-1.5 font-mono">{chip.value}</span>
                      <button
                        type="button"
                        onClick={() => removeChip(chip.id)}
                        aria-label={`Remove ${chip.label}`}
                        className="invert-hover self-stretch border-l border-ink px-1.5"
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
            exporting={exporting}
          />
          {exportNote && (
            <p className="caption animate-fade mt-2 font-mono text-[10px]">
              {exportNote}
            </p>
          )}
        </div>

        <div className="pt-8">
          {searched || results.artworks.length > 0 ? (
            <>
              {heroOnly && heroHiddenCount > 0 && (
                <p className="caption mb-4">
                  Fits-a-hero hides {heroHiddenCount}{" "}
                  {heroHiddenCount === 1 ? "work" : "works"} with unknown dimensions.
                </p>
              )}
              {sort === "similar" && colorlessCount > 0 && (
                <p className="caption mb-4">
                  Color ranking uses dominant-color data (AIC, SMK, Harvard) —{" "}
                  {colorlessCount}{" "}
                  {colorlessCount === 1 ? "work has" : "works have"} none and sort
                  last.
                </p>
              )}
              <ResultGrid
                artworks={displayArtworks}
                errors={results.errors}
                note={results.note}
                onOpen={(a) => {
                  setSaveOpen(false);
                  setOpen(a);
                }}
              />
            </>
          ) : (
            <p className="caption py-24 text-center">
              Search the open collections, pick a category, or ask the curator.
            </p>
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
          actions={
            <>
              <div className="flex gap-2">
                <button
                  onClick={() => setSaveOpen((v) => !v)}
                  className={`flex-1 border border-ink px-4 py-2 text-[13px] font-semibold ${
                    saveOpen ? "bg-ink text-paper" : "invert-hover"
                  }`}
                >
                  Save
                </button>
                <button
                  onClick={() => void exportOne(open)}
                  className="invert-hover flex-1 border border-ink px-4 py-2 text-[13px] font-semibold"
                >
                  Download
                </button>
              </div>
              {saveOpen && (
                <SaveMenu
                  artwork={open}
                  collections={collectionSummaries}
                  onSave={(id) => void saveToCollection(id)}
                  onCreate={(name) => void createAndSave(name)}
                />
              )}
              {exportNote && (
                <p className="caption animate-fade font-mono text-[10px]">
                  {exportNote}
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
