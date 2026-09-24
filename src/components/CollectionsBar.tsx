"use client";

export interface CollectionsBarCollection {
  id: string;
  name: string;
  count: number;
}

export default function CollectionsBar({
  collections,
  active,
  onOpen,
  onExport,
  onDelete,
  exporting,
}: {
  collections: CollectionsBarCollection[];
  active?: string;
  onOpen: (id: string) => void;
  onExport: (id: string) => void;
  onDelete?: (id: string) => void;
  exporting?: string;
}) {
  if (collections.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="caption mr-1 text-ink">Collections</span>
      {collections.map((c) => {
        const isActive = active === c.id;
        const isExporting = exporting === c.id;
        return (
          <span
            key={c.id}
            className="animate-rise flex items-stretch border border-ink"
          >
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              aria-pressed={isActive}
              className={`press-none px-3 py-1 text-[12px] ${
                isActive ? "bg-ink text-paper" : "invert-hover"
              }`}
            >
              {c.name}
              <span className="caption tabular ml-1.5 text-inherit opacity-70">
                {c.count}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onExport(c.id)}
              disabled={isExporting || c.count === 0}
              aria-busy={isExporting}
              title={c.count === 0 ? "Nothing to download yet" : "Download as zip"}
              className="caption invert-hover press-none border-l border-ink px-2 py-1 disabled:pointer-events-none disabled:opacity-40"
            >
              {isExporting ? "Zipping…" : "Download"}
            </button>
            {onDelete && isActive && (
              <button
                type="button"
                onClick={() => onDelete(c.id)}
                aria-label={`Delete collection ${c.name}`}
                title="Delete collection"
                className="caption invert-hover press-none animate-fade border-l border-ink px-2 py-1"
              >
                Delete
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
