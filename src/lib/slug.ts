/** URL/filename-safe slug — shared by the client collections store and the
 *  server-side export builder, so it lives in its own dependency-free module. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
