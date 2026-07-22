import type { SourceId } from "@/lib/types";

const LABELS: Record<SourceId, string> = {
  aic: "Art Institute of Chicago",
  cma: "Cleveland Museum of Art",
  met: "The Met",
  rijks: "Rijksmuseum",
  smk: "Statens Museum for Kunst",
  mia: "Minneapolis Institute of Art",
  harvard: "Harvard Art Museums",
};

const SHORT: Record<SourceId, string> = {
  aic: "AIC",
  cma: "CMA",
  met: "Met",
  rijks: "Rijks",
  smk: "SMK",
  mia: "Mia",
  harvard: "Harvard",
};

export function sourceLabel(source: SourceId): string {
  return LABELS[source];
}

export default function SourceBadge({
  source,
  full = false,
}: {
  source: SourceId;
  full?: boolean;
}) {
  return (
    <span
      className="inline-block border border-ink px-1.5 py-0.5 font-mono text-[10px] leading-none tracking-[0.06em]"
      title={LABELS[source]}
    >
      {full ? LABELS[source] : SHORT[source]}
    </span>
  );
}
