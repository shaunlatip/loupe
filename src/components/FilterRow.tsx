"use client";

import { CATEGORIES, type Category } from "@/lib/presets";
import type { SourceId } from "@/lib/types";
import type { HSL } from "@/lib/color";
import { hslCss } from "@/lib/color";
import Dropdown, { DropdownOption } from "./Dropdown";
import ColorPicker from "./ColorPicker";

const SHORT: Record<SourceId, string> = {
  aic: "AIC",
  cma: "CMA",
  met: "Met",
  rijks: "Rijks",
  smk: "SMK",
  mia: "Mia",
  harvard: "Harvard",
};

/** "relevance" is the unmodified fetch order — the default, unchanged behavior.
 *  "similar" ranks by distance to a picked color; it's driven by the Color
 *  picker (not a directly selectable Sort row) and needs a target to mean
 *  anything, so it's absent from SORTS below. */
export type SortMode =
  | "relevance"
  | "lightest"
  | "darkest"
  | "hue"
  | "calmest"
  | "similar";

const SORTS: { id: SortMode; label: string }[] = [
  { id: "relevance", label: "Relevance" },
  { id: "lightest", label: "Lightest" },
  { id: "darkest", label: "Darkest" },
  { id: "hue", label: "By hue" },
  { id: "calmest", label: "Calmest" },
];

const GROUP_ORDER: Category["group"][] = [
  "Movements",
  "Periods",
  "Cultures",
  "Subjects",
  "Media",
];

/**
 * The whole filter surface in one wrapping row (max two on narrow widths).
 * Trigger accent = "changed from default", so a resting bar reads all-neutral.
 *
 * Taxonomy dropdowns are MULTI-select and compose as an intersection: pick
 * Impressionism (Movements) and Landscape (Subjects) and the grid shows works
 * matching both (see mergeCategoryQueries in presets.ts). Selections persist
 * across every group; a group's trigger shows the one label when a single
 * category is picked, else "N selected". Menus stay open on pick so you can
 * tick several, then click away to close.
 *
 * The Movement dropdown near the end is a different axis — a post-fetch union
 * filter over whatever movements the current results carry (src/lib/movements).
 * Sort sits at the far right (md:ml-auto); Movement sits just left of Artist.
 * Below md the five group dropdowns collapse into one "Filter" dropdown and
 * Sort flows inline (no ml-auto orphan).
 */
export default function FilterRow({
  sources,
  enabled,
  onToggleSource,
  activeCategories,
  onToggleCategory,
  artist,
  onArtist,
  sort,
  onSort,
  heroOnly,
  onHeroToggle,
  targetColor,
  onPickColor,
  onClearColor,
  movements,
  activeMovements,
  onToggleMovement,
}: {
  sources: SourceId[];
  enabled: SourceId[];
  onToggleSource: (s: SourceId) => void;
  activeCategories: string[];
  onToggleCategory: (id: string) => void;
  artist: string;
  onArtist: (v: string) => void;
  sort: SortMode;
  onSort: (s: SortMode) => void;
  heroOnly: boolean;
  onHeroToggle: () => void;
  /** picked target color — ranks results by similarity (sort becomes "similar") */
  targetColor?: HSL;
  onPickColor: (c: HSL) => void;
  onClearColor: () => void;
  /** movements present across the current results — union refine, not taxonomy */
  movements: string[];
  activeMovements: string[];
  onToggleMovement: (movement: string) => void;
}) {
  const sortLabel =
    sort === "similar"
      ? "By color"
      : (SORTS.find((s) => s.id === sort)?.label ?? "Relevance");

  // One computation of each group's items + selection state, shared by the
  // desktop per-group dropdowns and the single mobile "Filter" dropdown.
  const taxonomyGroups = GROUP_ORDER.map((group) => {
    const items = CATEGORIES.filter((c) => c.group === group);
    const selected = items.filter((c) => activeCategories.includes(c.id));
    const label =
      selected.length === 0
        ? group
        : selected.length === 1
          ? selected[0].label
          : `${selected.length} selected`;
    return { group, items, selected, label };
  }).filter((g) => g.items.length > 0);

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {/* — taxonomy filters (multi-select, intersect) — */}
      {/* Desktop: one dropdown per group. Below md they collapse into the
          single "Filter" dropdown below (shared activeCategories, no sync). */}
      {taxonomyGroups.map(({ group, items, selected, label }) => (
        <Dropdown
          key={group}
          className="max-md:hidden"
          active={selected.length > 0}
          label={label}
        >
          {() =>
            items.map((c) => (
              <DropdownOption
                key={c.id}
                selected={activeCategories.includes(c.id)}
                onClick={() => onToggleCategory(c.id)}
              >
                {c.label}
              </DropdownOption>
            ))
          }
        </Dropdown>
      ))}

      {/* Mobile: every group in one scrollable sectioned panel. */}
      <Dropdown
        className="md:hidden"
        active={activeCategories.length > 0}
        panelClassName="max-h-72 overflow-y-auto"
        label={
          activeCategories.length > 0
            ? `Filter · ${activeCategories.length}`
            : "Filter"
        }
      >
        {() =>
          taxonomyGroups.map(({ group, items }) => (
            <div key={group} className="border-b border-ink/15 last:border-b-0">
              <p className="caption px-3 pt-2 pb-1">{group}</p>
              {items.map((c) => (
                <DropdownOption
                  key={c.id}
                  selected={activeCategories.includes(c.id)}
                  onClick={() => onToggleCategory(c.id)}
                >
                  {c.label}
                </DropdownOption>
              ))}
            </div>
          ))
        }
      </Dropdown>

      <span
        aria-hidden
        className="max-md:hidden mx-1 h-5 w-px self-center bg-ink/25"
      />

      {/* — refinements — */}
      <Dropdown
        active={enabled.length !== sources.length}
        label={`Sources · ${enabled.length}`}
      >
        {() =>
          sources.map((s) => (
            <DropdownOption
              key={s}
              selected={enabled.includes(s)}
              onClick={() => onToggleSource(s)}
            >
              {SHORT[s]}
            </DropdownOption>
          ))
        }
      </Dropdown>

      <button
        type="button"
        onClick={onHeroToggle}
        aria-pressed={heroOnly}
        title="Landscape aspect ≥1.4 and width ≥2000px"
        className={`border border-ink px-3 py-1 text-[12px] ${
          heroOnly ? "bg-accent text-paper" : "invert-hover"
        }`}
      >
        Fits a hero
      </button>

      <Dropdown
        active={!!targetColor}
        panelClassName="w-64 p-3"
        label={
          <span className="flex items-center gap-1.5">
            {targetColor && (
              <span
                aria-hidden
                className="h-3 w-3 border border-current"
                style={{ backgroundColor: hslCss(targetColor) }}
              />
            )}
            Color
          </span>
        }
      >
        {() => (
          <ColorPicker
            value={targetColor}
            onChange={onPickColor}
            onClear={onClearColor}
          />
        )}
      </Dropdown>

      {movements.length > 0 && (
        <Dropdown
          active={activeMovements.length > 0}
          label={
            activeMovements.length > 0
              ? `Movement · ${activeMovements.length}`
              : "Movement"
          }
        >
          {() =>
            movements.map((m) => (
              <DropdownOption
                key={m}
                selected={activeMovements.includes(m)}
                onClick={() => onToggleMovement(m)}
              >
                {m}
              </DropdownOption>
            ))
          }
        </Dropdown>
      )}

      <input
        type="text"
        value={artist}
        onChange={(e) => onArtist(e.target.value)}
        placeholder="Artist"
        className="border border-ink bg-paper px-2 py-1 text-[12px] text-ink outline-none max-md:w-28 placeholder:text-muted-foreground focus:bg-wash"
      />

      <Dropdown
        className="md:ml-auto"
        align="right"
        active={sort !== "relevance"}
        label={
          <span>
            Sort<span className="hidden md:inline"> · {sortLabel}</span>
          </span>
        }
      >
        {(close) =>
          SORTS.map((s) => (
            <DropdownOption
              key={s.id}
              selected={sort === s.id}
              onClick={() => {
                onSort(s.id);
                close();
              }}
            >
              {s.label}
            </DropdownOption>
          ))
        }
      </Dropdown>
    </div>
  );
}
