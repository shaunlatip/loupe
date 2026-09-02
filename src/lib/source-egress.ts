import type { SourceId } from "@/lib/types";

/**
 * Museum image hosts that reject fetches from datacenter IPs. AIC's IIIF
 * server sits behind Cloudflare and 403s requests from Vercel's egress (it
 * also 403s any cross-origin Referer), while serving the same URL fine to a
 * browser on a viewer's own IP with `referrerPolicy: "no-referrer"` — and it
 * sends `access-control-allow-origin: *`, so that browser can read the bytes.
 * For these sources the client fetches the image itself and hands the bytes
 * to the server, instead of asking the server to fetch the URL.
 */
const SERVER_BLOCKED: ReadonlySet<SourceId> = new Set<SourceId>(["aic"]);

export function serverCanFetch(source: SourceId): boolean {
  return !SERVER_BLOCKED.has(source);
}

/** The source prefix of an artwork id ("aic:16568" → "aic"). */
export function sourceOfId(id: string): SourceId {
  return id.split(":")[0] as SourceId;
}
