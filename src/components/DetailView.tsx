"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Artwork } from "@/lib/types";
import { useCalmScore } from "@/lib/calm-client";
import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import type { Attachment } from "@/lib/thread/types";
import { artworkTint } from "@/lib/tint";
import { Spinner } from "./thread/Glyph";
import Icon from "./Icon";
import { sourceLabel } from "./SourceBadge";

export default function DetailView({
  artwork,
  onClose,
  onPrev,
  onNext,
  position,
  preload,
  actions,
  onAttach,
}: {
  artwork: Artwork;
  onClose: () => void;
  /** step to the neighbouring work in the current grid (← / →) */
  onPrev?: () => void;
  onNext?: () => void;
  /** 1-based index and total in the current grid, for the counter */
  position?: { index: number; total: number };
  /** the neighbours' full-size URLs, fetched once this one is sharp */
  preload?: string[];
  /** slot for save/export affordances added in later slices */
  actions?: React.ReactNode;
  /** pin the artist or a movement to the next message */
  onAttach?: (a: Extract<Attachment, { kind: "artist" | "movement" }>) => void;
}) {
  const calm = useCalmScore(artwork);
  // Off by default — the overlay is a planning aid, not something to greet
  // every artwork with. Opt in from the panel toggle below.
  const [showSafeZone, setShowSafeZone] = useState(false);

  // Blur-up gate: the hi-res stays hidden until it has *fully* decoded, so it
  // never paints in top-to-bottom. All of this is keyed on the image URL, so
  // stepping to another work starts it soft→sharp again with no stale frame.
  const src = artwork.imageHires;
  const [loadedSrc, setLoadedSrc] = useState<string>();
  const [failedSrc, setFailedSrc] = useState<string>();
  // Already decoded (browser cache, or warmed on hover): show it at once, no
  // focus pull, which would read as a flicker on an image that never went.
  const [instantSrc, setInstantSrc] = useState<string>();
  const hiresFailed = failedSrc === src;
  const hiresLoaded = loadedSrc === src || hiresFailed;
  const instant = instantSrc === src;
  // Works whose museum reports no dimensions learn their ratio from the
  // thumbnail (the grid already decoded it, so usually at once), then from
  // the full image, and size exactly like the rest (see the frame below).
  const [measured, setMeasured] = useState<{ src: string; ratio: number }>();
  const naturalRatio = measured?.src === src ? measured.ratio : undefined;
  const hasDims = Boolean(artwork.dims?.width && artwork.dims?.height);
  // The full image already in hand when it mounts (stable per image, so it
  // runs once, not on every render). "Loaded" waits for decode, not just the
  // bytes: a large image that's complete but still decoding paints nothing,
  // and the preview must hold the frame until it can.
  const hiresRef = useCallback(
    (el: HTMLImageElement | null) => {
      if (!el || !el.complete || el.naturalWidth === 0) return;
      if (!hasDims) setMeasured({ src, ratio: el.naturalWidth / el.naturalHeight });
      void el
        .decode()
        .catch(() => undefined)
        .then(() => {
          setInstantSrc(src);
          setLoadedSrc(src);
        });
    },
    [src, hasDims],
  );
  useEffect(() => {
    if (hasDims) return;
    const probe = new Image();
    probe.referrerPolicy = "no-referrer";
    probe.onload = () => {
      if (probe.naturalWidth > 0)
        setMeasured((m) => (m?.src === src ? m : { src, ratio: probe.naturalWidth / probe.naturalHeight }));
    };
    probe.src = artwork.imageThumb;
    return () => {
      probe.onload = null;
    };
  }, [src, artwork.imageThumb, hasDims]);

  // Once this work is sharp, fetch its neighbours' full images so ← / →
  // land sharp too. Skipped on metered connections.
  const preloadKey = preload?.join("\n") ?? "";
  useEffect(() => {
    if (!hiresLoaded || !preloadKey) return;
    const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
    if (conn?.saveData) return;
    for (const src of preloadKey.split("\n")) {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.src = src;
    }
  }, [hiresLoaded, preloadKey]);

  const tint = artworkTint(artwork);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if (e.key === "Escape") onClose();
      else if (!typing && e.key === "ArrowLeft" && onPrev) onPrev();
      else if (!typing && e.key === "ArrowRight" && onNext) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext]);

  // Dialog focus: land on the close button on open, and hand focus back to
  // whatever opened us when we unmount.
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    return () => opener?.focus?.();
  }, []);

  const rect = calm?.rect;
  const hasSafeZone = !!rect && rect.w > 0 && rect.h > 0;

  // Known dims (AIC/CMA, the majority) let us reserve the exact picture box
  // ahead of load; the thumb then fills it at full size instead of the frame
  // sitting empty. Unknown dims (Met minority) fall back to the hi-res sizing
  // the box on decode — the same split the grid card makes.
  const { width, height } = artwork.dims ?? {};
  const ratio = width && height ? width / height : naturalRatio;

  const stepBtn =
    "invert-hover flex h-[30px] w-[38px] items-center justify-center border border-ink disabled:opacity-30 disabled:pointer-events-none";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${artwork.title}, ${artwork.artist}`}
      className="animate-modal-in fixed inset-0 z-50 flex flex-col bg-paper"
    >
      <header className="flex items-center justify-between gap-4 border-b border-ink px-6 py-3">
        <span className="caption min-w-0 truncate">{sourceLabel(artwork.source)}</span>
        <div className="flex items-center gap-2">
          {position && (
            <span className="caption tabular mr-2 hidden sm:inline">
              {position.index} / {position.total}
            </span>
          )}
          {(onPrev || onNext) && (
            <>
              <button
                type="button"
                onClick={onPrev}
                disabled={!onPrev}
                aria-label="Previous work"
                title="Previous (←)"
                className={stepBtn}
              >
                <Icon icon={ArrowLeft} />
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={!onNext}
                aria-label="Next work"
                title="Next (→)"
                className={stepBtn}
              >
                <Icon icon={ArrowRight} />
              </button>
            </>
          )}
          <button
            ref={closeBtn}
            onClick={onClose}
            title="Close (Esc)"
            className="invert-hover border border-ink px-4 py-1 text-[13px] font-semibold"
          >
            Close
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {/* The wall behind the work carries a whisper of its own colour
            (src/lib/tint.ts), or the plain wash when it has none. */}
        <div
          className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-wash p-6 transition-[background-color] duration-300 [container-type:size]"
          style={tint ? { backgroundColor: tint } : undefined}
        >
          {/* The frame shrink-wraps to the picture's own rendered box (no
              separate letterbox), so percentage-positioned children land on
              the displayed pixels. With a ratio (the museum's dims, or the
              thumbnail's) we size that box with container-query units —
              min(fit-by-width, fit-by-height) — which reserves the exact
              contain rect before the hi-res loads; the thumb underlay then
              fills it. Without one the hi-res sizes the box on decode
              (in-flow). Border lives on the frame so it hugs the picture in
              both paths. */}
          <div
            className="relative inline-block max-h-full max-w-full border border-ink"
            style={
              ratio
                ? {
                    width: `min(100cqw, 100cqh * ${ratio})`,
                    height: `min(100cqh, 100cqw / ${ratio})`,
                  }
                : undefined
            }
          >
            {ratio && !hiresLoaded && <RegisterMarks />}
            {ratio && (
              /* LQIP: the grid already decoded imageThumb, so it paints
                 instantly; blurred so the upscale reads as intentional (and
                 sharp, as the fallback, if the full image fails). The
                 overflow-hidden layer clips the blur to the frame so it never
                 haloes past the ink border (no soft glow in a flat register). */
              <div aria-hidden className="absolute inset-0 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  key={artwork.imageThumb}
                  src={artwork.imageThumb}
                  alt=""
                  referrerPolicy="no-referrer"
                  // scaled a touch while blurred: a blur samples the empty
                  // space past the image's edges and would fade them dark
                  className={`h-full w-full object-contain transition-opacity duration-300 ${
                    hiresFailed ? "" : "scale-110 blur-lg"
                  } ${hiresLoaded && !hiresFailed ? "opacity-0" : "opacity-100"}`}
                />
              </div>
            )}
            {/* The full image pulls into focus over the preview: blur and a
                hair of scale settle together (globals.css .animate-focus-pull),
                clipped to the frame like the preview. */}
            <div className={ratio ? "absolute inset-0 overflow-hidden" : "block overflow-hidden"}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={src}
                src={src}
                alt={artwork.title}
                decoding="async"
                referrerPolicy="no-referrer"
                ref={hiresRef}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  if (!hasDims && el.naturalWidth > 0) {
                    setMeasured({ src, ratio: el.naturalWidth / el.naturalHeight });
                  }
                  void el
                    .decode()
                    .catch(() => undefined)
                    .then(() => setLoadedSrc(src));
                }}
                onError={() => setFailedSrc(src)}
                // Without a ratio the image sizes the frame in-flow; container
                // units (not %) cap it, since a percentage max-height inside
                // this flex box resolves against nothing and a tall work would
                // spill past the viewport.
                style={ratio ? undefined : { maxWidth: "100cqw", maxHeight: "100cqh" }}
                className={`object-contain ${ratio ? "h-full w-full" : "block"} ${
                  hiresFailed
                    ? "invisible"
                    : !hiresLoaded
                      ? ratio
                        ? "opacity-0"
                        : ""
                      : instant
                        ? ""
                        : "animate-focus-pull"
                }`}
              />
            </div>
            {!hiresLoaded && (
              <span className="caption after-a-beat absolute right-2 bottom-2 flex items-center gap-1.5 bg-paper px-1.5 py-0.5 text-ink">
                <Spinner phase="look" size={9} className="text-accent" />
                Loading full size
                {width && height ? (
                  <span className="tabular text-muted-foreground">
                    {width.toLocaleString()} × {height.toLocaleString()}
                  </span>
                ) : null}
              </span>
            )}
            {hiresFailed && (
              <span className="caption absolute right-2 bottom-2 bg-paper px-1.5 py-0.5">
                Full size didn&rsquo;t load, showing the preview
              </span>
            )}
            {hasSafeZone && showSafeZone && (
              <div
                className="animate-fade pointer-events-none absolute border border-accent"
                style={{
                  left: `${rect.x * 100}%`,
                  top: `${rect.y * 100}%`,
                  width: `${rect.w * 100}%`,
                  height: `${rect.h * 100}%`,
                }}
              >
                <span className="caption absolute left-0 top-0 -translate-y-full bg-paper px-1 text-accent">
                  Calmest area
                </span>
              </div>
            )}
          </div>
        </div>
        <aside className="w-full shrink-0 overflow-y-auto border-t border-ink p-6 md:w-[360px] md:border-t-0 md:border-l">
          <h2 className="balance text-[24px] leading-tight font-semibold">
            {artwork.title}
          </h2>
          {onAttach && artwork.artist ? (
            <button
              type="button"
              onClick={() => onAttach({ kind: "artist", name: artwork.artist })}
              title={`Add ${artwork.artist} to the next message`}
              className="group/attach press-none mt-1 flex items-center gap-1.5 text-left text-[15px] underline-offset-2 hover:underline"
            >
              {artwork.artist}
              <Icon
                icon={Plus}
                size={13}
                className="shrink-0 text-ink/40 opacity-0 transition-opacity duration-150 group-hover/attach:opacity-100 group-focus-visible/attach:opacity-100"
              />
            </button>
          ) : (
            <p className="mt-1 text-[15px]">{artwork.artist}</p>
          )}
          <p className="caption mt-1">{artwork.date}</p>

          {artwork.movements && artwork.movements.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {artwork.movements.map((m) =>
                onAttach ? (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onAttach({ kind: "movement", name: m })}
                    title={`Add ${m} to the next message`}
                    className="caption flex items-center gap-1 border border-ink px-2 py-1 text-accent hover:bg-ink hover:text-paper"
                  >
                    {m}
                    <Icon icon={Plus} size={11} />
                  </button>
                ) : (
                  <span key={m} className="caption border border-ink px-2 py-1 text-accent">
                    {m}
                  </span>
                ),
              )}
            </div>
          )}

          <dl className="mt-8 flex flex-col gap-3 border-t border-ink pt-4">
            {artwork.medium && (
              <div>
                <dt className="caption">Medium</dt>
                <dd className="text-[13px]">{artwork.medium}</dd>
              </div>
            )}
            {width && height && (
              <div>
                <dt className="caption">Full size</dt>
                <dd className="tabular font-mono text-[13px]">
                  {width} × {height} px
                  <span className="ml-2 text-muted-foreground">
                    {(width / height).toFixed(2)}:1
                  </span>
                </dd>
              </div>
            )}
            {artwork.accession && (
              <div>
                <dt className="caption">Accession</dt>
                <dd className="font-mono text-[13px]">{artwork.accession}</dd>
              </div>
            )}
            <div>
              <dt className="caption">License</dt>
              <dd className="font-mono text-[13px]">{artwork.license}</dd>
            </div>
            {artwork.color && (
              <div>
                <dt className="caption">Dominant color</dt>
                <dd className="flex items-center gap-2 text-[13px]">
                  <span
                    aria-hidden
                    className="h-4 w-4 border border-ink"
                    style={{
                      backgroundColor: `hsl(${artwork.color.h} ${artwork.color.s}% ${artwork.color.l}%)`,
                    }}
                  />
                  <span className="font-mono">
                    hsl({Math.round(artwork.color.h)}, {Math.round(artwork.color.s)}%,{" "}
                    {Math.round(artwork.color.l)}%)
                  </span>
                </dd>
              </div>
            )}
            {calm && (
              <div>
                <dt className="caption">Calm score</dt>
                <dd className="tabular font-mono text-[13px]">
                  {calm.score}
                  <span className="ml-2 font-sans text-muted-foreground">of 100</span>
                </dd>
              </div>
            )}
            <div>
              <dt className="caption">Source</dt>
              <dd className="text-[13px]">
                <a
                  href={artwork.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-accent"
                >
                  View at {sourceLabel(artwork.source)} ↗
                </a>
              </dd>
            </div>
          </dl>

          {hasSafeZone && (
            <label className="mt-6 flex cursor-pointer select-none items-center gap-2 border-t border-ink pt-4 text-[13px]">
              <input
                type="checkbox"
                checked={showSafeZone}
                onChange={() => setShowSafeZone((v) => !v)}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className={`block h-3 w-3 border border-ink transition-colors duration-100 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent ${
                  showSafeZone ? "bg-accent" : "bg-paper"
                }`}
              />
              Show calmest area
            </label>
          )}

          {actions && (
            <div className="mt-8 flex flex-col gap-2 border-t border-ink pt-4">
              {actions}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Four crop marks just outside the frame's corners while the full image is
 *  on its way: the picture's box is known, the picture isn't here yet. */
function RegisterMarks() {
  const mark = "register-mark pointer-events-none absolute h-2.5 w-2.5 border-ink";
  return (
    <span aria-hidden className="after-a-beat">
      <span className={`${mark} -top-3.5 -left-3.5 border-t border-l`} />
      <span className={`${mark} -top-3.5 -right-3.5 border-t border-r`} />
      <span className={`${mark} -bottom-3.5 -left-3.5 border-b border-l`} />
      <span className={`${mark} -right-3.5 -bottom-3.5 border-r border-b`} />
    </span>
  );
}
