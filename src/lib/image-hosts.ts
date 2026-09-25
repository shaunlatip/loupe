/**
 * The museum image hosts Curio's adapters actually emit. Anything the server
 * fetches from a URL it was handed (the calm score, the curator viewing a
 * thumbnail) is pinned to these, so no route becomes an open image proxy.
 */
export const MUSEUM_IMAGE_HOSTS = new Set([
  "www.artic.edu", // AIC IIIF
  "openaccess-cdn.clevelandart.org",
  "images.metmuseum.org",
  "iip-thumb.smk.dk", // SMK thumbnails
  "iip.smk.dk", // SMK full size
  "api.smk.dk", // SMK download links (full size)
  "img.artsmia.org", // Mia
  "ids.lib.harvard.edu", // Harvard IIIF (dormant until key)
]);

export function isMuseumImageUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 2000) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && MUSEUM_IMAGE_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}
