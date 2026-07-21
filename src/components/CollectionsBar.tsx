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
  exporting,
}: {
  collections: CollectionsBarCollection[];
  active?: string;
  onOpen: (id: string) => void;
  onExport: (id: string) => void;
  exporting?: string;
}) {
  if (collections.length === 0) {
    return (
      <div className="caption">No collections yet — save from any artwork.</div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {collections.map((c) => {
        const isActive = active === c.id;
        const isExporting = exporting === c.id;
        return (
          <span key={c.id} className="flex items-stretch border border-ink">
            <button
              type="button"
              onClick={() => onOpen(c.id)}
              className={
                isActive
                  ? "bg-ink px-3 py-1 text-[12px] text-paper"
                  : "invert-hover px-3 py-1 text-[12px]"
              }
            >
              {c.name} ({c.count})
            </button>
            <button
              type="button"
              onClick={() => onExport(c.id)}
              disabled={isExporting}
              className="caption invert-hover border-l border-ink px-2 py-1 disabled:pointer-events-none"
            >
              {isExporting ? "Exporting…" : "Export"}
            </button>
          </span>
        );
      })}
    </div>
  );
}
