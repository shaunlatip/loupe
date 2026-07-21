"use client";

import { CATEGORIES, type Category } from "@/lib/presets";

const GROUP_ORDER: Category["group"][] = [
  "Movements",
  "Periods",
  "Cultures",
  "Subjects",
  "Media",
];

export default function PresetChips({
  onPick,
  active,
}: {
  onPick: (categoryId: string) => void;
  active?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      {GROUP_ORDER.map((group) => {
        const items = CATEGORIES.filter((c) => c.group === group);
        if (items.length === 0) return null;
        return (
          <div key={group} className="flex flex-col gap-1.5">
            <span className="caption">{group}</span>
            <div className="flex flex-wrap gap-2">
              {items.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => onPick(category.id)}
                  className={`invert-hover border border-ink px-3 py-1 text-[12px] ${
                    active === category.id ? "bg-ink text-paper" : ""
                  }`}
                >
                  {category.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
