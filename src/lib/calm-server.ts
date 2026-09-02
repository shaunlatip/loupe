import sharp from "sharp";
import { analyzeCalm, ANALYSIS_MAX_EDGE, type CalmResult } from "@/lib/calm";

/**
 * Server-side fetch + decode for calm analysis. See the architecture note
 * at the top of `calm.ts` for why this runs server-side for every source
 * rather than in-browser canvas. Import only from `/api/calm` — `sharp` is
 * a native module and must never end up in a client bundle.
 */

// Module-level cache: analysis is deterministic per source image, and
// re-renders/re-sorts (e.g. flipping "calmest first" on and off) shouldn't
// re-fetch or re-decode. Keyed by artwork id, not URL, since ids are stable
// and shorter.
const cache = new Map<string, Promise<CalmResult>>();

async function analyzeBytes(bytes: Buffer): Promise<CalmResult> {
  const { data, info } = await sharp(bytes)
    .resize({
      width: ANALYSIS_MAX_EDGE,
      height: ANALYSIS_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return analyzeCalm(new Uint8Array(data.buffer, data.byteOffset, data.length), info.width, info.height);
}

async function fetchAndAnalyze(url: string): Promise<CalmResult> {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) loupe/1.0",
      accept: "image/*,*/*;q=0.8",
    },
  });
  if (!res.ok) throw new Error(`image fetch failed: ${res.status}`);
  return analyzeBytes(Buffer.from(await res.arrayBuffer()));
}

function remember(id: string, work: Promise<CalmResult>): Promise<CalmResult> {
  const pending = work.catch((err) => {
    cache.delete(id); // don't pin a failure forever — allow retry on next request
    throw err;
  });
  cache.set(id, pending);
  return pending;
}

export function getCalm(id: string, url: string): Promise<CalmResult> {
  return cache.get(id) ?? remember(id, fetchAndAnalyze(url));
}

/** Bytes the browser fetched itself — for hosts that 403 datacenter IPs
 *  (AIC on Vercel; see source-egress.ts). Same cache, same analysis. */
export function getCalmFromBytes(id: string, bytes: Buffer): Promise<CalmResult> {
  return cache.get(id) ?? remember(id, analyzeBytes(bytes));
}
