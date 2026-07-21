"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  Artwork,
  SearchFacets,
  SearchQuery,
  SearchResponse,
  SourceError,
  SourceId,
} from "@/lib/types";
import SearchBar from "@/components/SearchBar";
import ResultGrid from "@/components/ResultGrid";
import DetailView from "@/components/DetailView";
import PresetChips from "@/components/PresetChips";
import FilterBar from "@/components/FilterBar";
import CollectionsBar from "@/components/CollectionsBar";
import SaveMenu from "@/components/SaveMenu";
import ClaudePanel from "@/components/ClaudePanel";

interface ResultState {
  artworks: Artwork[];
  errors: SourceError[];
  origin: "manual" | "claude" | "collection";
  note?: string;
}

interface Collection {
  id: string;
  name: string;
  createdAt: string;
  artworks: Artwork[];
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

// Rijksmuseum is omitted: its classic keyed API is deprecated (key issuance
// retired) and the keyless replacement returns only Linked-Art IRIs. The
// adapter stays registered but dormant; re-add "rijks" here if a key returns.
const ALL_SOURCES: SourceId[] = ["aic", "cma", "met"];
const EMPTY: ResultState = { artworks: [], errors: [], origin: "manual" };

export default function Home() {
  const [results, setResults] = useState<ResultState>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [open, setOpen] = useState<Artwork | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);

  const [sources, setSources] = useState<SourceId[]>(ALL_SOURCES);
  const [artist, setArtist] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | undefined>();
  const [interpretOn, setInterpretOn] = useState(false);
  const [interpretation, setInterpretation] = useState<Interpretation | null>(null);

  const [collections, setCollections] = useState<Collection[]>([]);
  const [activeCollection, setActiveCollection] = useState<string | undefined>();
  const [exporting, setExporting] = useState<string | undefined>();
  const [exportNote, setExportNote] = useState<string | undefined>();

  useEffect(() => {
    fetch("/api/collections")
      .then((r) => r.json())
      .then((j: { collections: Collection[] }) => setCollections(j.collections))
      .catch(() => {});
  }, []);

  const fetchResults = useCallback(
    async (params: URLSearchParams, origin: ResultState["origin"]) => {
      setLoading(true);
      setSearched(true);
      setActiveCollection(undefined);
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

  // POST a full SearchQuery (interpret mode + chip edits) — same fanout as GET
  const runQuerySearch = useCallback(
    async (query: SearchQuery) => {
      setLoading(true);
      setSearched(true);
      setActiveCollection(undefined);
      try {
        const res = await fetch("/api/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query, sources }),
        });
        const json = (await res.json()) as SearchResponse;
        setResults({ ...json, origin: "manual" });
      } catch {
        setResults({ ...EMPTY, origin: "manual" });
      } finally {
        setLoading(false);
      }
    },
    [sources],
  );

  const runInterpret = useCallback(
    async (q: string) => {
      setActiveCategory(undefined);
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
      setActiveCategory(undefined);
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

  const toggleInterpret = useCallback(() => {
    setInterpretOn((v) => !v);
    setInterpretation(null); // entering has no chips yet; leaving clears them
  }, []);

  const pickCategory = useCallback(
    (id: string) => {
      setInterpretation(null);
      setActiveCategory(id);
      const params = new URLSearchParams({
        category: id,
        sources: sources.join(","),
      });
      void fetchResults(params, "manual");
    },
    [sources, fetchResults],
  );

  const toggleSource = useCallback((s: SourceId) => {
    setSources((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  }, []);

  // — collections —

  const collectionSummaries = collections.map((c) => ({
    id: c.id,
    name: c.name,
    count: c.artworks.length,
  }));

  const saveToCollection = useCallback(
    async (collectionId: string) => {
      if (!open) return;
      const res = await fetch("/api/collections", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: collectionId, add: open }),
      });
      const json = (await res.json()) as { collections: Collection[] };
      if (json.collections) setCollections(json.collections);
      setSaveOpen(false);
    },
    [open],
  );

  const createAndSave = useCallback(
    async (name: string) => {
      if (!open) return;
      const created = await fetch("/api/collections", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const createdJson = (await created.json()) as {
        collections: Collection[];
      };
      setCollections(createdJson.collections);
      const target = createdJson.collections.find((c) => c.name === name);
      if (target) await saveToCollection(target.id);
    },
    [open, saveToCollection],
  );

  const openCollection = useCallback(
    (id: string) => {
      const c = collections.find((x) => x.id === id);
      if (!c) return;
      setSearched(true);
      setActiveCategory(undefined);
      setInterpretation(null);
      setActiveCollection(id);
      setResults({
        artworks: c.artworks,
        errors: [],
        origin: "collection",
        note: `Collection — ${c.name}`,
      });
    },
    [collections],
  );

  const exportCollection = useCallback(async (id: string) => {
    setExporting(id);
    setExportNote(undefined);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ collectionId: id }),
      });
      const json = (await res.json()) as {
        dir?: string;
        results?: { ok: boolean }[];
        error?: string;
      };
      if (json.dir) {
        const ok = json.results?.filter((r) => r.ok).length ?? 0;
        setExportNote(`Exported ${ok} works to ${json.dir}`);
      } else {
        setExportNote(json.error ?? "Export failed");
      }
    } catch {
      setExportNote("Export failed");
    } finally {
      setExporting(undefined);
    }
  }, []);

  const exportOne = useCallback(async (artwork: Artwork) => {
    setExportNote(undefined);
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ artworks: [artwork] }),
    });
    const json = (await res.json()) as { dir?: string; error?: string };
    setExportNote(json.dir ? `Exported to ${json.dir}` : (json.error ?? "Export failed"));
  }, []);

  const onSelection = useCallback((artworks: Artwork[], note: string) => {
    setSearched(true);
    setActiveCategory(undefined);
    setInterpretation(null);
    setActiveCollection(undefined);
    setResults({ artworks, errors: [], origin: "claude", note });
  }, []);

  return (
    <>
      <main
        className={`mx-auto max-w-[1440px] px-6 pb-24 transition-[margin] duration-120 ${
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
                Open-access museum art · CC0 / public domain
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
            onToggleInterpret={toggleInterpret}
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
          <div className="flex flex-wrap items-center justify-between gap-4">
            <PresetChips onPick={pickCategory} active={activeCategory} />
            <FilterBar
              sources={ALL_SOURCES}
              enabled={sources}
              onToggle={toggleSource}
              artist={artist}
              onArtist={setArtist}
            />
          </div>
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
            <p className="caption mt-2 font-mono text-[10px]">{exportNote}</p>
          )}
        </div>

        <div className="pt-8">
          {searched || results.artworks.length > 0 ? (
            <ResultGrid
              artworks={results.artworks}
              errors={results.errors}
              note={results.note}
              onOpen={(a) => {
                setSaveOpen(false);
                setOpen(a);
              }}
            />
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
                  Export
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
                <p className="caption font-mono text-[10px]">{exportNote}</p>
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
