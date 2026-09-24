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

/** Periods are left out of the bar: two coarse buckets that mostly duplicate
 *  what a movement or a typed date already says. */
const GROUP_ORDER: Category["group"][] = ["Movements", "Cultures", "Subjects", "Media"];

/**
 * The wall's filter bar. It sizes itself against its own container, not the
 * window (`@container`), because the docked thread takes a resizable slice of
 * the page: at 1024px of bar or more every taxonomy group gets its own
 * dropdown; below that they fold into one sectioned "Filters" menu, so the bar
 * stays a single line at any width a desktop can give it.
 *
 * Trigger fill = "changed from default", so a resting bar reads all-quiet.
 * Taxonomy dropdowns are MULTI-select and compose as an intersection (see
 * mergeCategoryQueries in presets.ts). "In these results" is a different axis:
 * a post-fetch union filter over the movements the current results carry.
 * Sort lives with the wall label (it orders results), not here.
 */
export default function FilterRow({
  sources,
  enabled,
  onToggleSource,
  activeCategories,
  onToggleCategory,
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
  /** picked target color — ranks results by similarity (sort becomes "similar") */
  targetColor?: HSL;
  onPickColor: (c: HSL) => void;
  onClearColor: () => void;
  /** movements present across the current results — union refine, not taxonomy */
  movements: string[];
  activeMovements: string[];
  onToggleMovement: (movement: string) => void;
}) {
  // One computation of each group's items + selection state, shared by the
  // wide per-group dropdowns and the folded "Filters" menu.
  const taxonomyGroups = GROUP_ORDER.map((group) => {
    const items = CATEGORIES.filter((c) => c.group === group);
    const selected = items.filter((c) => activeCategories.includes(c.id));
    const label =
      selected.length === 0
        ? group
        : selected.length === 1
          ? selected[0].label
          : `${group} · ${selected.length}`;
    return { group, items, selected, label };
  }).filter((g) => g.items.length > 0);
  const liveTaxonomy = taxonomyGroups.reduce((n, g) => n + g.selected.length, 0);
  // At phone width Sources and "In these results" live inside the folded
  // menu, so its trigger counts their changes too.
  const sourcesChanged = enabled.length !== sources.length ? 1 : 0;
  const liveNarrow = liveTaxonomy + sourcesChanged + activeMovements.length;

  const taxonomySections = taxonomyGroups.map(({ group, items }) => (
    <MenuSection key={group} title={group}>
      {items.map((c) => (
        <DropdownOption
          key={c.id}
          selected={activeCategories.includes(c.id)}
          onClick={() => onToggleCategory(c.id)}
        >
          {c.label}
        </DropdownOption>
      ))}
    </MenuSection>
  ));

  return (
    <div className="@container w-full">
      <div className="flex flex-wrap items-center gap-2">
        {taxonomyGroups.map(({ group, items, selected, label }) => (
          <Dropdown
            key={group}
            className="hidden @5xl:block"
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

        {/* Folded, mid width: every taxonomy group in one sectioned menu. */}
        <Dropdown
          className="hidden @xl:block @5xl:hidden"
          active={liveTaxonomy > 0}
          panelClassName="max-h-80 overflow-y-auto"
          label={liveTaxonomy > 0 ? `Filters · ${liveTaxonomy}` : "Filters"}
        >
          {() => taxonomySections}
        </Dropdown>

        {/* Folded, phone width: Sources and "In these results" join it, so
            the bar is two buttons rather than a wrapping row with an orphan. */}
        <Dropdown
          className="@xl:hidden"
          active={liveNarrow > 0}
          panelClassName="max-h-80 overflow-y-auto"
          label={liveNarrow > 0 ? `Filters · ${liveNarrow}` : "Filters"}
        >
          {() => (
            <>
              {taxonomySections}
              <MenuSection title="Sources">
                {sources.map((s) => (
                  <DropdownOption
                    key={s}
                    selected={enabled.includes(s)}
                    onClick={() => onToggleSource(s)}
                  >
                    {SHORT[s]}
                  </DropdownOption>
                ))}
              </MenuSection>
              {movements.length > 0 && (
                <MenuSection title="In these results">
                  {movements.map((m) => (
                    <DropdownOption
                      key={m}
                      selected={activeMovements.includes(m)}
                      onClick={() => onToggleMovement(m)}
                    >
                      {m}
                    </DropdownOption>
                  ))}
                </MenuSection>
              )}
            </>
          )}
        </Dropdown>

        <span aria-hidden className="mx-1 hidden h-5 w-px self-center bg-ink/25 @xl:block" />

        <Dropdown
          className="hidden @xl:block"
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
            className="hidden @xl:block"
            active={activeMovements.length > 0}
            title="Narrow these results to one or more movements"
            label={
              activeMovements.length > 0
                ? `In these results · ${activeMovements.length}`
                : "In these results"
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
      </div>
    </div>
  );
}

function MenuSection({
  title,
  className = "",
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`border-b border-ink/15 last:border-b-0 ${className}`}>
      <p className="caption px-3 pt-2 pb-1">{title}</p>
      {children}
    </div>
  );
}

/** Sort, as it sits at the right end of the wall label. */
export function SortMenu({
  sort,
  onSort,
}: {
  sort: SortMode;
  onSort: (s: SortMode) => void;
}) {
  const label =
    sort === "similar" ? "By color" : (SORTS.find((s) => s.id === sort)?.label ?? "Relevance");
  return (
    <Dropdown
      align="right"
      active={sort !== "relevance"}
      label={<span>Sort · {label}</span>}
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
  );
}
