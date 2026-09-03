import type { NextRequest } from "next/server";

/**
 * Per-client sliding-window limiter, in memory. On Vercel every serverless
 * instance keeps its own map, so this is a soft ceiling — enough to stop one
 * visitor from draining the free model quota for everyone, not a security
 * boundary. The provider's own rate limits are the hard stop.
 */
const hits = new Map<string, number[]>();

export function clientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0].trim() || req.headers.get("x-real-ip") || "anon";
}

/** True when `key` has already made `limit` calls inside the last `windowMs`. */
export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}
