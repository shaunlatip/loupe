"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Artwork } from "@/lib/types";
import { useCalmScore } from "@/lib/calm-client";
import { artworkTint } from "@/lib/tint";
import SourceBadge from "./SourceBadge";

/** Cards past this reading-order index enter without delay — the stagger is
 *  for the first screenful; everything below the fold is already scrolled to. */
const STAGGER_LIMIT = 16;
const STAGGER_STEP_MS = 28;

/** Hover this long before a comment opens, so sweeping the pointer across
 *  the wall doesn't flash every comment on the way. */
const COMMENT_INTENT_MS = 120;
/** The comment's width beside the picture, and its distance from the frame. */
const COMMENT_W = 280;
const COMMENT_GAP = 12;

type CommentSide = "right" | "left" | "top" | "bottom";

/**
 * Where a comment goes: beside the picture where the wall has room for it
 * (right first, the way a label reads), else above it, or below it when the
 * picture sits too near the top of the window for anything to fit above.
 * `offset` nudges a side comment down so it starts on screen when the
 * picture's top has scrolled away.
 */
function placeComment(frame: DOMRect, bounds: DOMRect): { side: CommentSide; offset: number } {
  const offset = Math.max(0, Math.min(12 - frame.top, frame.height - 48));
  if (frame.right + COMMENT_GAP + COMMENT_W <= bounds.right) return { side: "right", offset };
  if (frame.left - COMMENT_GAP - COMMENT_W >= bounds.left) return { side: "left", offset };
  return { side: frame.top > 240 ? "top" : "bottom", offset: 0 };
}

/**
 * The comment, written out as it opens: quick (about a second at most, so a
 * long one never makes you wait), with the whole text laid out from the
 * first frame so the box never grows while it types. Reduced motion shows it
 * all at once.
 */
function TypedComment({ text }: { text: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setN(text.length);
      return;
    }
    const perChar = Math.min(14, 1000 / Math.max(1, text.length));
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(text.length, Math.ceil((now - t0) / perChar));
      setN(k);
      if (k < text.length) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text]);
  const typing = n < text.length;
  return (
    <>
      {text.slice(0, n)}
      {/* the caret takes no width, so nothing rewraps under it */}
      {typing && <span className="inline-block h-[1.05em] w-[2px] -mr-[2px] bg-accent align-[-0.18em]" />}
      <span className="invisible">{text.slice(n)}</span>
    </>
  );
}

export default function ArtworkCard({
  artwork,
  index = 0,
  comment,
  onOpen,
}: {
  artwork: Artwork;
  /** reading-order position, drives the entrance stagger */
  index?: number;
  /** Curio's word on this work, when it has one */
  comment?: string;
  onOpen: (a: Artwork) => void;
}) {
  const calm = useCalmScore(artwork);
  const commentId = useId();

  // Curio's comment: at rest only an accent line along the frame's top edge
  // says there is one. Pointing at the card (or focusing it) opens it beside
  // the picture, outside the frame, and it writes itself out. It floats over
  // the wall, so nothing moves.
  const frameRef = useRef<HTMLSpanElement>(null);
  const [commentAt, setCommentAt] = useState<{ side: CommentSide; offset: number } | null>(null);
  const commentTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openComment = () => {
    const frame = frameRef.current;
    const bounds = frame?.closest("section")?.getBoundingClientRect();
    if (!comment || !frame || !bounds) return;
    setCommentAt(placeComment(frame.getBoundingClientRect(), bounds));
  };
  const openCommentSoon = () => {
    if (!comment || commentTimer.current) return;
    commentTimer.current = setTimeout(openComment, COMMENT_INTENT_MS);
  };
  const closeComment = () => {
    if (commentTimer.current) clearTimeout(commentTimer.current);
    commentTimer.current = null;
    setCommentAt(null);
  };
  useEffect(
    () => () => {
      if (commentTimer.current) clearTimeout(commentTimer.current);
    },
    [],
  );

  // Reserving the image box up front is what stops the masonry from
  // reflowing as thumbnails decode: with aspect-ratio set from the known
  // dims (AIC/CMA carry them), the column height is final before a single
  // pixel loads, so nothing below shifts. The thumb is a scaled copy of the
  // same image, so dims give its exact ratio. Met has no dims — those cards
  // fall back to natural sizing and settle on load (the minority).
  const { width, height } = artwork.dims ?? {};
  const ratio = width && height ? width / height : undefined;

  // With space reserved we can hide the image until it decodes and fade it
  // in — pure opacity, never layout. Unknown-ratio cards skip the hide so
  // they don't collapse-then-pop. While hidden, the reserved box carries the
  // work's own tint (or the wash, when it reports no colour) so the wall
  // reads as frames-awaiting-pictures, each already hinting at its picture.
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const fadeReady = ratio !== undefined;
  const tint = fadeReady && !loaded ? artworkTint(artwork) : undefined;

  // Warm the hi-res on hover intent so DetailView opens sharp (or nearly)
  // instead of dwelling on the blur-up: by click the full image is usually
  // decoded and cached, so its <img> mounts `complete` and skips the fade.
  // Guarded to fire once, and only after a brief linger, so grazing the grid
  // to reach one card doesn't fetch dozens of full-size images.
  const warmed = useRef(false);
  const warmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // AIC's IIIF server 403s any cross-origin Referer (it only serves when none
  // is sent), so every museum image request goes out referrer-less — the
  // grid <img> below, this warm-up, and DetailView alike.
  const warmHires = () => {
    if (warmed.current) return;
    warmed.current = true;
    const img = new Image();
    img.referrerPolicy = "no-referrer";
    img.src = artwork.imageHires;
  };
  const warmSoon = () => {
    if (warmed.current || warmTimer.current) return;
    warmTimer.current = setTimeout(warmHires, 120);
  };
  const cancelWarm = () => {
    if (warmTimer.current) {
      clearTimeout(warmTimer.current);
      warmTimer.current = null;
    }
  };
  useEffect(() => cancelWarm, []);

  const stagger = index < STAGGER_LIMIT ? index * STAGGER_STEP_MS : 0;

  return (
    <figure
      // raised while its comment is open, so the comment sits over the
      // neighbouring cards it reaches across
      className={`group animate-fade relative mb-8 ${commentAt ? "z-30" : ""}`}
      style={{ ["--stagger" as string]: `${stagger}ms` }}
      onPointerEnter={openCommentSoon}
      onPointerLeave={closeComment}
    >
      <button
        className="press-none block w-full cursor-pointer text-left"
        onClick={() => onOpen(artwork)}
        onPointerEnter={warmSoon}
        onPointerLeave={cancelWarm}
        onPointerDown={warmHires}
        onFocus={() => {
          warmHires();
          openComment();
        }}
        onBlur={closeComment}
        aria-label={`${artwork.title}, ${artwork.artist}`}
        aria-describedby={comment ? commentId : undefined}
      >
        <span
          ref={frameRef}
          className={`relative block w-full border border-ink ${
            fadeReady && !loaded ? "bg-wash" : ""
          }`}
          style={ratio ? { aspectRatio: String(ratio), backgroundColor: tint } : undefined}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={artwork.imageThumb}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            ref={(el) => {
              if (el?.complete && el.naturalWidth > 0) setLoaded(true);
            }}
            onLoad={() => setLoaded(true)}
            onError={() => {
              setLoaded(true);
              setFailed(true);
            }}
            className={`block w-full transition-opacity duration-300 ${
              ratio ? "h-full object-cover" : ""
            } ${fadeReady && !loaded ? "opacity-0" : "opacity-100"} ${
              failed ? "hidden" : ""
            }`}
          />
          {failed && (
            <span className="caption absolute inset-0 flex items-center justify-center bg-wash">
              image unavailable
            </span>
          )}
          {/* Hover: a second ink line inside the frame — the museum "mat".
              Pure opacity, no layout, no shadow. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 border-[3px] border-ink opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
          />
          {/* Curio has a word on this one: an accent line along the top
              edge, over the mat, the same edge its comment opens with. */}
          {comment && (
            <>
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-accent" />
              <span id={commentId} className="sr-only">
                Curio: {comment}
              </span>
            </>
          )}
        </span>
      </button>
      {comment && commentAt && (
        <aside
          aria-hidden
          className={`animate-fade pointer-events-none absolute z-10 border border-ink border-t-[3px] border-t-accent bg-paper px-3.5 pt-2.5 pb-3 text-left ${
            commentAt.side === "right"
              ? "left-[calc(100%+12px)]"
              : commentAt.side === "left"
                ? "right-[calc(100%+12px)]"
                : commentAt.side === "top"
                  ? "inset-x-0 bottom-[calc(100%+12px)]"
                  : "inset-x-0 top-[calc(100%+4px)]"
          }`}
          style={{
            ["--stagger" as string]: "0ms",
            width: commentAt.side === "left" || commentAt.side === "right" ? COMMENT_W : undefined,
            top: commentAt.side === "left" || commentAt.side === "right" ? commentAt.offset : undefined,
          }}
        >
          <p className="caption text-accent!">Curio</p>
          <p className="pretty mt-1 text-[14px] leading-[1.5] text-ink">
            <TypedComment text={comment} />
          </p>
        </aside>
      )}
      <figcaption className="mt-2 flex flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <span className="pretty text-[14px] leading-tight font-medium underline-offset-2 group-hover:underline">
            {artwork.title}
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {artwork.color && (
              <span
                aria-hidden
                title="Dominant color"
                className="h-3 w-3 border border-ink"
                style={{
                  backgroundColor: `hsl(${artwork.color.h} ${artwork.color.s}% ${artwork.color.l}%)`,
                }}
              />
            )}
            <SourceBadge source={artwork.source} />
          </div>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="caption">
            {artwork.artist}
            {artwork.date ? ` · ${artwork.date}` : ""}
          </span>
          {/* fixed-width slot reserved up front — no shift when the score lands */}
          <span
            className="caption tabular min-w-[4.5em] shrink-0 text-right font-mono"
            title={calm ? "Calm score: share of the image that is quiet enough to sit UI on" : undefined}
          >
            {calm ? `calm ${calm.score}` : ""}
          </span>
        </div>
      </figcaption>
    </figure>
  );
}
