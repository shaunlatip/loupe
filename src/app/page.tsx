"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, Bookmark, BookmarkCheck, MessageSquarePlus, X } from "lucide-react";
import type { Artwork, SearchQuery, SearchResponse, SourceError, SourceId } from "@/lib/types";
import { requestCalmForAll, subscribeCalm } from "@/lib/calm-client";
import { enrichArtworksWithMovements } from "@/lib/movements";
import { getCategory, mergeCategoryQueries } from "@/lib/presets";
import type { HSL } from "@/lib/color";
import { sortArtworks, type SortMode } from "@/lib/sort";
import { queryChips, removeQueryField, type QueryChip } from "@/lib/query-chips";
import { downloadDirect, triggerDownload } from "@/lib/downloads";
import { serverCanFetch } from "@/lib/source-egress";
import { smallThumb } from "@/lib/thumb";
import {
  type Collection,
  addArtwork,
  createCollection,
  deleteCollection,
  getCollection,
  listCollections,
  removeArtwork,
} from "@/lib/collections-client";
import type { ExhibitData, SearchEntryData, WallContext } from "@/lib/thread/types";
import ResultGrid from "@/components/ResultGrid";
import DetailView from "@/components/DetailView";
import FilterRow, { WallTools } from "@/components/FilterRow";
import CollectionsMenu from "@/components/CollectionsMenu";
import SaveMenu from "@/components/SaveMenu";
import HomeHero from "@/components/HomeHero";
import examplePreviews from "@/data/examples-index.json";
import Icon from "@/components/Icon";
import ScrollTopButton from "@/components/ScrollTopButton";
import { sourceLabel } from "@/components/SourceBadge";
import ThreadProvider, { useThread, type ThreadHandlers } from "@/components/thread/ThreadProvider";
import Thread from "@/components/thread/Thread";
import Composer from "@/components/thread/Composer";
import StatusPill from "@/components/thread/StatusPill";
import CuratorTable from "@/components/thread/CuratorTable";

interface ResultState {
  artworks: Artwork[];
  errors: SourceError[];
  origin: "manual" | "curio" | "collection";
  /** wall title: the query, the category labels, the exhibit or collection */
  heading?: string;
  /** Curio's note under the title */
  note?: string;
  /** Curio's comments on individual works, by id */
  comments?: Record<string, string>;
}

interface Interpretation {
  query: SearchQuery;
  explanation: string;
  method: "vocab" | "claude" | "llm" | "fallback";
}

// SMK and Mia are keyless and always on. Rijks and Harvard stay registered but
// dormant until their keys exist; add them here once they do.
const ALL_SOURCES: SourceId[] = ["aic", "cma", "met", "smk", "mia"];
const EMPTY: ResultState = { artworks: [], errors: [], origin: "manual" };

function entryFrom(
  route: SearchEntryData["route"],
  query: string,
  heading: string,
  res: SearchResponse,
  readAs?: string[],
): SearchEntryData {
  return {
    route,
    query,
    heading,
    count: res.artworks.length,
    museums: new Set(res.artworks.map((a) => a.source)).size,
    readAs,
  };
}

export default function Home() {
  const [results, setResults] = useState<ResultState>(EMPTY);
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const [loading, setLoading] = useState(false);
  const [curating, setCurating] = useState(false);
  const [reading, setReading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState<Artwork | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  const [sources, setSources] = useState<SourceId[]>(ALL_SOURCES);
  const [sort, setSort] = useState<SortMode>("relevance");
  const [targetColor, setTargetColor] = useState<HSL | undefined>();
  const [activeMovements, setActiveMovements] = useState<string[]>([]);
  const [activeCategories, setActiveCategories] = useState<string[]>([]);
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);
  const [lastQuery, setLastQuery] = useState("");

  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | undefined>();
  const [exporting, setExporting] = useState<string | undefined>();
  const [exportNote, setExportNote] = useState<string | undefined>();
  const [saveNote, setSaveNote] = useState<string | undefined>();
  const [downloading, setDownloading] = useState(false);

  // Collections live in localStorage (Curio deploys to a read-only host).
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

  // "calmest" sort re-sorts as each lazily computed score resolves.
  const [calmTick, setCalmTick] = useState(0);
  useEffect(() => subscribeCalm(() => setCalmTick((t) => t + 1)), []);
  useEffect(() => {
    if (sort === "calmest") requestCalmForAll(results.artworks);
  }, [sort, results.artworks]);

  // Latest-wins guard: only the newest search may land on the wall.
  const reqSeq = useRef(0);

  const startSearch = useCallback((heading: string) => {
    const myId = ++reqSeq.current;
    setLoading(true);
    setSearched(true);
    setActiveCollection(undefined);
    setActiveMovements([]);
    setResults((r) => ({ ...r, heading, note: undefined, origin: "manual" }));
    return myId;
  }, []);

  const fetchResults = useCallback(
    async (params: URLSearchParams, heading: string): Promise<SearchResponse | null> => {
      const myId = startSearch(heading);
      try {
        const res = await fetch(`/api/search?${params}`);
        const json = (await res.json()) as SearchResponse;
        if (reqSeq.current !== myId) return null;
        setResults({ ...json, origin: "manual", heading });
        return json;
      } catch {
        if (reqSeq.current !== myId) return null;
        setResults({ ...EMPTY, heading });
        return { artworks: [], errors: [] };
      } finally {
        if (reqSeq.current === myId) setLoading(false);
      }
    },
    [startSearch],
  );

  // POST a full SearchQuery (a read description, a chip edit, a taxonomy merge).
  const runQuerySearch = useCallback(
    async (query: SearchQuery, heading: string): Promise<SearchResponse | null> => {
      const myId = startSearch(heading);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, sources }),
        });
        const json = (await res.json()) as SearchResponse;
        if (reqSeq.current !== myId) return null;
        setResults({ ...json, origin: "manual", heading });
        return json;
      } catch {
        if (reqSeq.current !== myId) return null;
        setResults({ ...EMPTY, heading });
        return { artworks: [], errors: [] };
      } finally {
        if (reqSeq.current === myId) setLoading(false);
      }
    },
    [sources, startSearch],
  );

  // — the one input's routes (called by the thread's router)

  const runLookup = useCallback(
    async (q: string): Promise<SearchEntryData | null> => {
      setLastQuery(q);
      setInterpretation(null);
      setActiveCategories([]);
      setReading(false);
      const res = await fetchResults(new URLSearchParams({ q, sources: sources.join(",") }), q);
      return res ? entryFrom("lookup", q, q, res) : null;
    },
    [fetchResults, sources],
  );

  // A description: the literal search lands at once (so something is on the
  // wall immediately), the phrase is read into facets meanwhile, and the
  // read search replaces it when it arrives, unless something newer has.
  const describeSeq = useRef(0);
  const runDescribe = useCallback(
    async (q: string): Promise<SearchEntryData | null> => {
      const mine = ++describeSeq.current;
      setLastQuery(q);
      setInterpretation(null);
      setActiveCategories([]);
      setReading(true);
      const literal = fetchResults(new URLSearchParams({ q, sources: sources.join(",") }), q);
      let interp: Interpretation = { query: { q }, explanation: "Searched as typed.", method: "fallback" };
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
      if (describeSeq.current !== mine) return null;
      if (interp.method === "fallback") {
        setReading(false);
        const res = await literal;
        return res ? entryFrom("describe", q, q, res) : null;
      }
      setInterpretation(interp);
      const res = await runQuerySearch(interp.query, q);
      if (describeSeq.current === mine) setReading(false);
      return res
        ? entryFrom(
            "describe",
            q,
            q,
            res,
            queryChips(interp.query).map((c) => c.value),
          )
        : null;
    },
    [fetchResults, runQuerySearch, sources],
  );

  const removeChip = useCallback(
    (chip: QueryChip) => {
      if (!interpretation) return;
      const next = removeQueryField(interpretation.query, chip);
      // the last chip gone: nothing of the reading is left, so search the
      // words exactly as typed
      if (!next.q && !next.artist && !next.dateRange && !next.facets) {
        setInterpretation(null);
        void runQuerySearch({ q: lastQuery }, lastQuery);
        return;
      }
      setInterpretation({ ...interpretation, query: next });
      void runQuerySearch(next, lastQuery);
    },
    [interpretation, runQuerySearch, lastQuery],
  );

  // Back to the empty wall: cancel anything in flight, drop every selection.
  const clearAll = useCallback(() => {
    reqSeq.current++;
    describeSeq.current++;
    setLoading(false);
    setReading(false);
    setResults(EMPTY);
    setSearched(false);
    setInterpretation(null);
    setActiveCategories([]);
    setActiveCollection(undefined);
    setActiveMovements([]);
    setLastQuery("");
  }, []);

  // A taxonomy selection is the query: the intersection of the picks.
  const runCategories = useCallback(
    (ids: string[]) => {
      setInterpretation(null);
      setActiveCollection(undefined);
      setReading(false);
      if (ids.length === 0) {
        reqSeq.current++;
        setLoading(false);
        setResults(EMPTY);
        setSearched(false);
        return;
      }
      const heading = ids.map((id) => getCategory(id)?.label ?? id).join(" + ");
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
    setSources((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  }, []);

  const toggleMovement = useCallback((m: string) => {
    setActiveMovements((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));
  }, []);

  // Picking a colour IS choosing the "similar" sort; clearing reverts.
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

  // — exhibits from the thread

  const onExhibit = useCallback((exhibit: ExhibitData) => {
    reqSeq.current++;
    describeSeq.current++;
    setLoading(false);
    setReading(false);
    setCurating(false);
    setSearched(true);
    setActiveCategories([]);
    setInterpretation(null);
    setActiveCollection(undefined);
    setActiveMovements([]);
    setResults({
      artworks: exhibit.artworks,
      errors: [],
      origin: "curio",
      heading: exhibit.title,
      note: exhibit.note,
      comments: exhibit.comments,
    });
  }, []);
  // A revision edits the words on the wall and leaves the works, and
  // whatever sort or filter the visitor has on them, alone.
  const onExhibitRevised = useCallback((exhibit: ExhibitData) => {
    setResults((r) =>
      r.origin === "curio" ? { ...r, heading: exhibit.title, note: exhibit.note, comments: exhibit.comments } : r,
    );
  }, []);
  const onTurnStart = useCallback(() => {
    setCurating(true);
    setSearched(true);
  }, []);
  const onTurnEnd = useCallback(() => {
    setCurating(false);
    // A turn begun from the empty homepage that ended without an exhibit
    // (stopped, or failed) leaves nothing to show: go back to the homepage
    // rather than claim "nothing came back"; the thread says what happened.
    if (resultsRef.current === EMPTY) setSearched(false);
  }, []);

  // — collections

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
      setReading(false);
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
      if (n > 0 && !window.confirm(`Delete “${c.name}” and its ${n} saved ${n === 1 ? "work" : "works"}?`))
        return;
      setCollections(deleteCollection(id));
      if (activeCollection === id) clearAll();
    },
    [collections, activeCollection, clearAll],
  );

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

  const exportCollection = useCallback(async (id: string) => {
    const collection = getCollection(id);
    if (!collection || collection.artworks.length === 0) {
      setExportNote("Nothing to download yet.");
      return;
    }
    setExporting(id);
    setExportNote(undefined);
    try {
      setExportNote(await triggerDownload({ artworks: collection.artworks, folderName: collection.name }));
    } finally {
      setExporting(undefined);
    }
  }, []);

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

  // Client-side only: enrich (the Wikidata artist→movement join), filter,
  // then sort over the already-fetched results.
  const { displayArtworks, availableMovements, colorlessCount } = useMemo(() => {
    let list = enrichArtworksWithMovements(results.artworks);
    const movementSet = new Set<string>();
    for (const a of list) for (const m of a.movements ?? []) movementSet.add(m);
    const availableMovements = Array.from(movementSet).sort();
    if (activeMovements.length > 0) {
      list = list.filter((a) => a.movements?.some((m) => activeMovements.includes(m)));
    }
    const colorlessCount = sort === "similar" && targetColor ? list.filter((a) => !a.color).length : 0;
    return { displayArtworks: sortArtworks(list, sort, targetColor), availableMovements, colorlessCount };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- calmTick forces
    // a re-sort as lazily-computed scores resolve; it carries no data itself.
  }, [results.artworks, sort, activeMovements, targetColor, calmTick]);

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

  // What Curio is told is on the wall (text only, first 24).
  const wall = useMemo<WallContext>(
    () => ({
      heading: results.heading,
      exhibit: results.origin === "curio",
      count: displayArtworks.length,
      works: displayArtworks.slice(0, 24).map((a) => ({
        id: a.id,
        title: a.title,
        artist: a.artist,
        date: a.date,
      })),
    }),
    [results.heading, results.origin, displayArtworks],
  );

  const handlers = useMemo<ThreadHandlers>(
    () => ({ onExhibit, onExhibitRevised, runLookup, runDescribe, onTurnStart, onTurnEnd }),
    [onExhibit, onExhibitRevised, runLookup, runDescribe, onTurnStart, onTurnEnd],
  );

  // A work opened from the thread may belong to an exhibit that isn't on the
  // wall; its comment rides along so the detail view can still show it.
  const [threadComment, setThreadComment] = useState<{ id: string; text: string }>();
  const onOpenCard = useCallback((a: Artwork) => {
    setSaveOpen(false);
    setThreadComment(undefined);
    setOpen(a);
  }, []);
  const onOpenFromThread = useCallback((a: Artwork, comment?: string) => {
    setSaveOpen(false);
    setThreadComment(comment ? { id: a.id, text: comment } : undefined);
    setOpen(a);
  }, []);
  const openComment = open
    ? (results.comments?.[open.id] ?? (threadComment?.id === open.id ? threadComment.text : undefined))
    : undefined;

  // The wall label's right end: tools that act on the works shown.
  const wallTools = useMemo(
    () => (
      <WallTools
        targetColor={targetColor}
        onPickColor={pickColor}
        onClearColor={clearColor}
        movements={availableMovements}
        activeMovements={activeMovements}
        onToggleMovement={toggleMovement}
        sort={sort}
        onSort={chooseSort}
      />
    ),
    [targetColor, pickColor, clearColor, availableMovements, activeMovements, toggleMovement, sort, chooseSort],
  );

  const facts = useMemo(() => {
    if (reading) {
      return (
        <span className="text-sweep px-1 text-[11px] tracking-[0.04em]">Reading your description</span>
      );
    }
    if (!interpretation || interpretation.method === "fallback") return undefined;
    return (
      <>
        {queryChips(interpretation.query).map((chip) => (
          <span key={chip.id} className="inline-flex items-center bg-wash text-[11px] leading-[1.5] tracking-[0.04em] text-ink/80">
            <span className="py-0.5 pl-2 text-muted-foreground">{chip.label}</span>
            <span className="py-0.5 pl-1">{chip.value}</span>
            <button
              type="button"
              onClick={() => removeChip(chip)}
              aria-label={`Remove ${chip.label} ${chip.value} and search again`}
              title="Remove and search again"
              className="press-none ml-1 flex h-[21px] w-5 items-center justify-center hover:bg-wash-strong"
            >
              <Icon icon={X} size={11} />
            </button>
          </span>
        ))}
      </>
    );
  }, [reading, interpretation, removeChip]);

  return (
    <ThreadProvider handlers={handlers} wall={wall}>
      <Shortcuts />
      <main
        // The detail view is a full-screen dialog; everything under it is
        // inert so tab order and screen readers stay inside the dialog.
        inert={open ? true : undefined}
        className="mx-auto max-w-[1440px] px-6 pb-24 transition-[margin] duration-200 ease-[var(--ease-in-out)] [html[data-resizing]_&]:transition-none"
        style={{ marginRight: "max(calc((100vw - 1440px) / 2), var(--thread-w, 0px))" }}
      >
        <SiteHeader
          onHome={clearAll}
          collections={
            <CollectionsMenu
              collections={collectionSummaries}
              active={activeCollection}
              exporting={exporting}
              note={exportNote}
              onOpen={openCollection}
              onExport={(id) => void exportCollection(id)}
              onDelete={removeCollection}
            />
          }
        />

        {showWall ? (
          <>
            <TopComposer />
            <div className="border-b border-ink py-4">
              <FilterRow
                sources={ALL_SOURCES}
                enabled={sources}
                onToggleSource={toggleSource}
                activeCategories={activeCategories}
                onToggleCategory={toggleCategory}
              />
            </div>

            <div className="pt-8">
              <CuratorTable emptyWall={curating && results.artworks.length === 0} />
              {sort === "similar" && colorlessCount > 0 && (
                <p className="caption animate-rise mb-4">
                  Colour ranking uses each museum&rsquo;s own palette data (AIC, SMK, Harvard).{" "}
                  {colorlessCount} {colorlessCount === 1 ? "work has" : "works have"} none and sit at the end.
                </p>
              )}
              {/* A turn on an empty wall shows Curio's table in place of the
                  grid; a follow-up leaves the current exhibit browsable
                  while Curio works (its progress is in the thread). */}
              {!(curating && results.artworks.length === 0) && (
              <ResultGrid
                artworks={displayArtworks}
                errors={results.errors}
                heading={results.heading}
                note={results.note}
                comments={results.comments}
                loading={loading}
                facts={facts}
                aside={wallTools}
                emptyHint={
                  results.origin === "collection" ? (
                    <span>Open any work and press Save to add it here.</span>
                  ) : (
                    <NoResultsHint
                      lastQuery={lastQuery}
                      movementFiltered={activeMovements.length > 0 && results.artworks.length > 0}
                      enabled={ALL_SOURCES.filter((s) => sources.includes(s))}
                    />
                  )
                }
                onOpen={onOpenCard}
              />
              )}
            </div>
          </>
        ) : (
          <HomeHero
            sources={ALL_SOURCES}
            previews={examplePreviews}
            onCategory={(id) => {
              setActiveCategories([id]);
              runCategories([id]);
            }}
          />
        )}
      </main>

      {open && (
        <DetailPanel
          artwork={open}
          comment={openComment}
          onClose={() => {
            setOpen(null);
            setSaveOpen(false);
          }}
          onPrev={openPrev}
          onNext={openNext}
          position={openIndex >= 0 ? { index: openIndex + 1, total: displayArtworks.length } : undefined}
          preload={
            openIndex >= 0
              ? [displayArtworks[openIndex + 1], displayArtworks[openIndex - 1]]
                  .filter((a): a is Artwork => Boolean(a))
                  .map((a) => a.imageHires)
              : undefined
          }
          saved={collectionSummaries.some((c) => c.has)}
          saveOpen={saveOpen}
          onToggleSave={() => setSaveOpen((v) => !v)}
          saveMenu={
            saveOpen ? (
              <SaveMenu
                artwork={open}
                collections={collectionSummaries}
                onSave={(id) => void saveToCollection(id)}
                onCreate={(name) => void createAndSave(name)}
              />
            ) : null
          }
          downloading={downloading}
          onDownload={() => void exportOne(open)}
          inCollection={results.origin === "collection" && Boolean(activeCollection)}
          onRemoveFromCollection={() => removeFromActiveCollection(open)}
          note={saveNote ?? exportNote}
          onDismiss={() => setOpen(null)}
        />
      )}

      <ScrollTopButton enabled={showWall && displayArtworks.length > 0 && !open} />
      <Thread onOpenArtwork={onOpenFromThread} />
    </ThreadProvider>
  );
}

/** "/" focuses the input, wherever it is at the moment. */
function Shortcuts() {
  const { focusComposer } = useThread();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "/" && !typing && !document.querySelector('[role="dialog"]')) {
        e.preventDefault();
        focusComposer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focusComposer]);
  return null;
}

/**
 * The header, on the page's 12-column grid: the wordmark over the content
 * columns, the tagline, credits and the door to the thread at the right.
 */
function SiteHeader({ onHome, collections }: { onHome: () => void; collections: React.ReactNode }) {
  return (
    <header className="grid grid-cols-12 items-end gap-x-6 gap-y-4 border-b border-ink py-8">
      <h1 className="col-span-6 text-outline text-[64px] leading-[1.05] font-bold tracking-[-0.02em] max-md:text-[44px]">
        {/* the wordmark is intentionally lowercase */}
        <button type="button" onClick={onHome} title="Back to the start" className="press-none text-inherit">
          curio
        </button>
      </h1>
      <div className="col-span-6 flex items-center justify-end gap-4">
        <p className="caption hidden text-right lg:block">
          Open-access museum art, curated by an agent
          <br />
          <Credit />
        </p>
        {/* stretch: the collections button takes the pill's height; relative:
            the collections menu anchors to this group's right edge */}
        <div className="relative flex min-w-0 items-stretch gap-2">
          {collections}
          <StatusPill />
        </div>
      </div>
      {/* narrower: the same credit on its own line under the wordmark */}
      <p className="caption col-span-12 -mt-2 lg:hidden">
        Open-access museum art, curated by an agent, <Credit />
      </p>
    </header>
  );
}

function Credit() {
  return (
    <>
      by{" "}
      <a
        href="https://latip.me"
        target="_blank"
        rel="noopener noreferrer"
        className="whitespace-nowrap underline underline-offset-2 hover:text-ink"
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
    </>
  );
}

/** Above the wall: the one input, always there. With the thread open,
 *  attached works belong to the thread's own input, so they show (and send)
 *  only there. */
function TopComposer() {
  const { open } = useThread();
  return (
    <div className="animate-fade pt-5">
      <Composer
        variant="bar"
        placeholder="Hokusai, fog over water, cats with opinions…"
        attachmentsHere={!open}
      />
    </div>
  );
}

/** Why a search came back empty, with a one-click way forward. */
function NoResultsHint({
  lastQuery,
  movementFiltered,
  enabled,
}: {
  lastQuery: string;
  movementFiltered: boolean;
  enabled: SourceId[];
}) {
  const { submit } = useThread();
  if (movementFiltered) return <span>No work here carries that movement. Clear the In these results filter.</span>;
  return (
    <>
      {enabled.length === 0 ? (
        <span>No museum is switched on. Pick some under Sources.</span>
      ) : (
        enabled.length < ALL_SOURCES.length && (
          <span>
            Only {enabled.map(sourceLabel).join(", ")} {enabled.length === 1 ? "is" : "are"} switched on. Add the
            rest under Sources.
          </span>
        )
      )}
      {lastQuery && (
        <span>
          The museums&rsquo; own search matches their records word for word.{" "}
          <button
            type="button"
            onClick={() => submit(lastQuery, "curate")}
            className="underline underline-offset-2 hover:text-ink"
          >
            Ask Curio to look for &ldquo;{lastQuery}&rdquo;
          </button>{" "}
          instead.
        </span>
      )}
    </>
  );
}

/** The detail view with its actions, which need the thread (Add to chat). */
function DetailPanel({
  artwork,
  comment,
  onClose,
  onPrev,
  onNext,
  position,
  preload,
  saved,
  saveOpen,
  onToggleSave,
  saveMenu,
  downloading,
  onDownload,
  inCollection,
  onRemoveFromCollection,
  note,
  onDismiss,
}: {
  artwork: Artwork;
  comment?: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  position?: { index: number; total: number };
  preload?: string[];
  saved: boolean;
  saveOpen: boolean;
  onToggleSave: () => void;
  saveMenu: React.ReactNode;
  downloading: boolean;
  onDownload: () => void;
  inCollection: boolean;
  onRemoveFromCollection: () => void;
  note?: string;
  onDismiss: () => void;
}) {
  const { attach, attachments, setOpen, focusComposer } = useThread();
  const attached = attachments.some((a) => a.kind === "artwork" && a.id === artwork.id);
  const toThread = () => {
    onDismiss();
    setOpen(true);
    focusComposer();
  };
  return (
    <DetailView
      artwork={artwork}
      comment={comment}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      position={position}
      preload={preload}
      onAttach={(a) => {
        attach(a);
        toThread();
      }}
      actions={
        <>
          <div className="flex gap-2">
            <button
              onClick={onToggleSave}
              aria-expanded={saveOpen}
              className={`flex flex-1 items-center justify-center gap-2 border border-ink px-4 py-2 text-[13px] font-semibold ${
                saveOpen ? "bg-ink text-paper" : "invert-hover"
              }`}
            >
              <Icon icon={saved ? BookmarkCheck : Bookmark} />
              {saved ? "Saved" : "Save"}
            </button>
            <button
              onClick={onDownload}
              disabled={downloading}
              aria-busy={downloading}
              className="invert-hover flex flex-1 items-center justify-center gap-2 border border-ink px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
            >
              <Icon icon={ArrowDownToLine} />
              {downloading ? "Fetching" : "Download"}
            </button>
          </div>
          <button
            onClick={() => {
              attach({
                kind: "artwork",
                id: artwork.id,
                title: artwork.title,
                artist: artwork.artist,
                thumb: smallThumb(artwork),
              });
              toThread();
            }}
            className="invert-hover flex items-center justify-center gap-2 border border-ink px-4 py-2 text-[13px] font-semibold"
          >
            <Icon icon={MessageSquarePlus} />
            {attached ? "In the next message" : "Ask Curio about this"}
          </button>
          {inCollection && (
            <button onClick={onRemoveFromCollection} className="invert-hover border border-ink px-4 py-2 text-[13px]">
              Remove from this collection
            </button>
          )}
          {saveMenu}
          {note && (
            <p className="caption animate-rise" role="status">
              {note}
            </p>
          )}
        </>
      }
    />
  );
}

