/**
 * Calm-area analysis — scores an artwork image by how much large, visually
 * quiet area it has (a "calmness" 0–100 score) and finds the largest
 * axis-aligned low-activity rectangle (the UI-safe zone for a case-study
 * card sitting on top of the image as a backdrop).
 *
 * ARCHITECTURE DECISION (Step 0, see AGENTS.md for the adapters this
 * concerns): checked CORS headers on real imageThumb URLs from all three
 * live sources —
 *   AIC (artic.edu IIIF)              → access-control-allow-origin: *
 *   Met (images.metmuseum.org)        → access-control-allow-origin: *
 *   CMA (openaccess-cdn.clevelandart) → no ACAO header at all
 * CMA thumbnails would taint a canvas and throw on `getImageData`, so a
 * pure client-side canvas approach can't cover all three sources. However
 * `sharp` is already present in node_modules (pulled in transitively by
 * Next's own image optimizer — `npm ls sharp` shows `next@16 └── sharp`),
 * satisfying the "already installed, no new deps" constraint. So analysis
 * runs SERVER-SIDE for every source, uniformly, via `calm-server.ts` (which
 * fetches + decodes with sharp) behind `GET /api/calm`. This file holds
 * only the pure pixel math — no I/O, no sharp import — so it's safe to
 * import from both the server route and (if ever needed) a client path,
 * and is trivially unit-testable with synthetic pixel buffers.
 *
 * Calm data is NOT attached to the wire `Artwork` type. It's cached
 * client-side keyed by artwork id (see `calm-client.ts`) — cleaner than
 * polluting the shared contract with a value that's expensive, optional,
 * and only relevant to the backdrop-picking use case.
 */

export interface CalmRect {
  /** normalized 0..1, image-relative */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CalmResult {
  /** 0–100, higher = more large quiet area */
  score: number;
  /** largest low-activity rectangle, normalized 0..1; zero-area if none found */
  rect: CalmRect;
}

/** Longest edge, in px, that source images are downscaled to before analysis. */
export const ANALYSIS_MAX_EDGE = 64;

/** Longest-edge cell count of the activity grid; short edge scales to preserve aspect. */
const GRID_LONG = 32;

/**
 * Gradient-magnitude activity below this (0–255 luminance scale) counts a
 * cell as "calm". Chosen empirically: flat/gradient skies and walls sit
 * well under this; brushy or high-frequency areas (foliage, crowds,
 * checkerboard-style texture) sit well over it.
 */
const ACTIVITY_THRESHOLD = 12;

function gridDims(width: number, height: number): { gridW: number; gridH: number } {
  if (width >= height) {
    const gridW = GRID_LONG;
    const gridH = Math.max(1, Math.round((GRID_LONG * height) / width));
    return { gridW, gridH };
  }
  const gridH = GRID_LONG;
  const gridW = Math.max(1, Math.round((GRID_LONG * width) / height));
  return { gridW, gridH };
}

/**
 * Per-pixel gradient magnitude (|dx| + |dy|) over a grayscale buffer, via
 * stride-1 forward differences (clamped at the far edges). NOTE: this must
 * NOT be a central difference (x-1 vs x+1, skipping x itself) — that
 * samples every other pixel, which aliases to zero on exactly a period-2
 * checkerboard (the x-1 and x+1 neighbors land on the same checker cell),
 * silently reporting a maximally busy image as calm. Caught by the
 * synthetic checkerboard test in the calm-test harness.
 */
function activityMap(gray: Uint8Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const xr = Math.min(width - 1, x + 1);
      const yb = Math.min(height - 1, y + 1);
      const dx = gray[y * width + xr] - gray[y * width + x];
      const dy = gray[yb * width + x] - gray[y * width + x];
      out[y * width + x] = Math.abs(dx) + Math.abs(dy);
    }
  }
  return out;
}

/** Average `activity` into a gridW×gridH grid of per-cell mean activity. */
function binToGrid(
  activity: Float32Array,
  width: number,
  height: number,
  gridW: number,
  gridH: number,
): Float32Array {
  const sums = new Float32Array(gridW * gridH);
  const counts = new Int32Array(gridW * gridH);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(gridH - 1, Math.floor((y * gridH) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(gridW - 1, Math.floor((x * gridW) / width));
      const idx = gy * gridW + gx;
      sums[idx] += activity[y * width + x];
      counts[idx]++;
    }
  }
  const out = new Float32Array(gridW * gridH);
  for (let i = 0; i < out.length; i++) out[i] = counts[i] ? sums[i] / counts[i] : 0;
  return out;
}

/**
 * Largest axis-aligned all-true rectangle in a boolean grid (row-major),
 * via the standard histogram-stack method run once per row. Returns cell
 * coordinates (inclusive col/row ranges via row0/col0 + w/h in cells), or
 * a zero-area rect if the grid has no true cells.
 */
function largestRectangle(
  calm: Uint8Array,
  gridW: number,
  gridH: number,
): { col: number; row: number; w: number; h: number } {
  const heights = new Int32Array(gridW);
  let best = { col: 0, row: 0, w: 0, h: 0, area: 0 };

  for (let row = 0; row < gridH; row++) {
    for (let col = 0; col < gridW; col++) {
      heights[col] = calm[row * gridW + col] ? heights[col] + 1 : 0;
    }
    // monotonic-stack max rectangle in this row's histogram
    const stack: number[] = [];
    for (let col = 0; col <= gridW; col++) {
      const h = col === gridW ? 0 : heights[col];
      while (stack.length && heights[stack[stack.length - 1]] >= h) {
        const top = stack.pop()!;
        const height = heights[top];
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = col - left;
        const area = height * width;
        if (area > best.area) {
          best = { col: left, row: row - height + 1, w: width, h: height, area };
        }
      }
      stack.push(col);
    }
  }

  return { col: best.col, row: best.row, w: best.w, h: best.h };
}

/**
 * Core pure analysis: a grayscale pixel buffer (row-major, one byte per
 * pixel, 0–255) → calmness score + normalized UI-safe-zone rect.
 */
export function analyzeCalm(gray: Uint8Array, width: number, height: number): CalmResult {
  if (width <= 0 || height <= 0 || gray.length < width * height) {
    return { score: 0, rect: { x: 0, y: 0, w: 0, h: 0 } };
  }
  const { gridW, gridH } = gridDims(width, height);
  const activity = activityMap(gray, width, height);
  const grid = binToGrid(activity, width, height, gridW, gridH);

  const calmMask = new Uint8Array(gridW * gridH);
  let calmCount = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] < ACTIVITY_THRESHOLD) {
      calmMask[i] = 1;
      calmCount++;
    }
  }

  const score = Math.round((100 * calmCount) / (gridW * gridH));
  const best = largestRectangle(calmMask, gridW, gridH);
  const rect: CalmRect =
    best.w > 0 && best.h > 0
      ? {
          x: best.col / gridW,
          y: best.row / gridH,
          w: best.w / gridW,
          h: best.h / gridH,
        }
      : { x: 0, y: 0, w: 0, h: 0 };

  return { score, rect };
}
