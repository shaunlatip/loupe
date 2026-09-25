import type { Artwork, SourceId } from "@/lib/types";

/**
 * What the museums themselves say about a work, for Curio's read_about tool:
 * the label or catalogue text where a museum publishes one, and a short note
 * on the artist. Curio reads this before it states history, stories or
 * symbols, so what it tells a visitor about a work rests on the museum's own
 * words rather than on what the model half-remembers.
 *
 * Who publishes what (checked September 2026):
 *   aic   `description` (catalogue essay, HTML) or `short_description`, plus
 *         style, place of origin and inscriptions
 *   cma   `description` / `wall_description` / `digital_description`,
 *         `fun_fact`, and the creator's `biography`
 *   mia   `text` (the gallery label, HTML)
 *   smk   `labels[].text` / `content_description` when present
 *   met   nothing: the Met's API carries no label text
 * Every work also gets the artist's Wikipedia summary, unless the museum
 * already wrote about the artist (Cleveland's biographies).
 */

export interface WorkReading {
  /** the museum's own text on the work, plain */
  label?: string;
  /** a few facts the record carries (style, origin, inscription) */
  facts?: string[];
  /** a note on the artist, and where it came from */
  artist?: { name: string; text: string; from: string };
}

const MUSEUM: Record<SourceId, string> = {
  aic: "the Art Institute of Chicago",
  cma: "the Cleveland Museum of Art",
  met: "The Met",
  rijks: "the Rijksmuseum",
  smk: "the Statens Museum for Kunst",
  mia: "the Minneapolis Institute of Art",
  harvard: "Harvard Art Museums",
};

const LABEL_MAX = 1800;
const ARTIST_MAX = 700;
const DEADLINE_MS = 6_000;
const TTL_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 400;
const UA = "Curio/1.0 (https://loupe-xi.vercel.app; open-access art search)";

const cache = new Map<string, { at: number; value: WorkReading }>();

/** HTML to plain text: tags out, the common entities decoded, whitespace
 *  collapsed, paragraphs kept apart. */
export function plain(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\/p>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘")
    .replace(/&ldquo;/g, "“")
    .replace(/&rdquo;/g, "”")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .replace(/[ \t\r\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/** At most `max` characters, ending on a sentence where one ends in reach. */
export function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return end > max * 0.5 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  const deadline = AbortSignal.timeout(DEADLINE_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json", "user-agent": UA },
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// — per museum

async function readAic(nativeId: string, signal?: AbortSignal): Promise<WorkReading> {
  const fields = "description,short_description,style_title,place_of_origin,inscriptions";
  const json = await getJson<{
    data?: {
      description?: string | null;
      short_description?: string | null;
      style_title?: string | null;
      place_of_origin?: string | null;
      inscriptions?: string | null;
    };
  }>(`https://api.artic.edu/api/v1/artworks/${encodeURIComponent(nativeId)}?fields=${fields}`, signal);
  const d = json?.data;
  if (!d) return {};
  const facts = [
    d.style_title && `Style: ${d.style_title}`,
    d.place_of_origin && `Made in: ${d.place_of_origin}`,
    d.inscriptions && `Inscribed: ${clip(plain(d.inscriptions), 200)}`,
  ].filter((f): f is string => Boolean(f));
  return { label: plain(d.description) || plain(d.short_description) || undefined, facts };
}

async function readCma(nativeId: string, signal?: AbortSignal): Promise<WorkReading> {
  const json = await getJson<{
    data?: {
      description?: string | null;
      wall_description?: string | null;
      digital_description?: string | null;
      fun_fact?: string | null;
      culture?: string[] | null;
      type?: string | null;
      creators?: { description?: string | null; biography?: string | null }[] | null;
    };
  }>(`https://openaccess-api.clevelandart.org/api/artworks/${encodeURIComponent(nativeId)}`, signal);
  const d = json?.data;
  if (!d) return {};
  const texts = [d.wall_description, d.description, d.digital_description].map(plain).filter(Boolean);
  // the wall text and the description are often the same paragraph
  const label = [...new Set(texts)].join("\n") || undefined;
  const facts = [
    d.type && `Type: ${d.type}`,
    d.culture?.length && `Culture: ${d.culture.join(", ")}`,
    d.fun_fact && `Fun fact: ${plain(d.fun_fact)}`,
  ].filter((f): f is string => Boolean(f));
  const creator = d.creators?.[0];
  const bio = plain(creator?.biography);
  return {
    label,
    facts,
    artist:
      bio && creator?.description
        ? { name: creator.description, text: clip(bio, ARTIST_MAX), from: "the Cleveland Museum of Art" }
        : undefined,
  };
}

async function readMia(nativeId: string, signal?: AbortSignal): Promise<WorkReading> {
  const json = await getJson<{
    hits?: { hits?: { _source?: { text?: string | null; description?: string | null; style?: string | null } }[] };
  }>(`https://search.artsmia.org/id:${encodeURIComponent(nativeId)}`, signal);
  const d = json?.hits?.hits?.[0]?._source;
  if (!d) return {};
  return {
    label: plain(d.text) || plain(d.description) || undefined,
    facts: d.style ? [`Style: ${d.style}`] : [],
  };
}

async function readSmk(nativeId: string, signal?: AbortSignal): Promise<WorkReading> {
  const json = await getJson<{
    items?: {
      labels?: { text?: string | null }[] | null;
      content_description?: string[] | null;
    }[];
  }>(`https://api.smk.dk/api/v1/art/?object_number=${encodeURIComponent(nativeId)}&lang=en`, signal);
  const d = json?.items?.[0];
  if (!d) return {};
  const texts = [...(d.labels ?? []).map((l) => plain(l.text)), ...(d.content_description ?? []).map(plain)];
  return { label: texts.filter(Boolean).join("\n") || undefined };
}

const READERS: Partial<Record<SourceId, (nativeId: string, signal?: AbortSignal) => Promise<WorkReading>>> = {
  aic: readAic,
  cma: readCma,
  mia: readMia,
  smk: readSmk,
};

// — the artist, from Wikipedia

/** Credited hands that aren't one person's page ("Unknown", "Workshop of"). */
const NOT_A_PERSON = /^(unknown|anonymous|unidentified|various|attributed|workshop|school|circle|follower|manner|after|copy)\b/i;
/** A summary that describes a maker, so a same-name politician isn't read. */
const MAKER =
  /\b(painter|artist|sculptor|printmaker|engraver|etcher|lithographer|photographer|illustrator|draughtsman|draftsman|architect|potter|ceramicist|designer|woodblock|ukiyo-e|calligrapher|silversmith|goldsmith|weaver|miniaturist|caricaturist|cartoonist|muralist)\b/i;

type WikiSummary = { type?: string; title?: string; description?: string; extract?: string };

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();

async function readArtist(name: string, signal?: AbortSignal): Promise<WorkReading["artist"]> {
  const clean = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (!clean || NOT_A_PERSON.test(clean)) return undefined;
  const summary = (title: string) =>
    getJson<WikiSummary>(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`,
      signal,
    );
  let json = await summary(clean);
  // Museums credit full names Wikipedia doesn't redirect ("Théophile-
  // Alexandre Pierre Steinlen"): search, and take the top page only if it
  // carries the same surname.
  if (json?.type !== "standard") {
    const found = await getJson<{ query?: { search?: { title: string }[] } }>(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srlimit=1&srprop=&format=json&srsearch=${encodeURIComponent(`${clean} artist`)}`,
      signal,
    );
    const title = found?.query?.search?.[0]?.title;
    const surname = fold(clean.split(/[\s,]+/).filter(Boolean).pop() ?? "");
    json = title && surname && fold(title).includes(surname) ? await summary(title) : null;
  }
  if (!json || json.type !== "standard" || !json.extract) return undefined;
  if (!MAKER.test(`${json.description ?? ""} ${json.extract.slice(0, 300)}`)) return undefined;
  return { name: json.title ?? clean, text: clip(json.extract, ARTIST_MAX), from: "Wikipedia" };
}

/** What there is to read about one work. Cached for a few hours. */
export async function readAbout(a: Artwork, signal?: AbortSignal): Promise<WorkReading> {
  const hit = cache.get(a.id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const reader = READERS[a.source];
  const work = reader ? await reader(a.nativeId, signal).catch(() => ({}) as WorkReading) : {};
  const artist = work.artist ?? (a.artist ? await readArtist(a.artist, signal).catch(() => undefined) : undefined);
  const value: WorkReading = {
    label: work.label ? clip(work.label, LABEL_MAX) : undefined,
    facts: work.facts?.length ? work.facts : undefined,
    artist,
  };
  if (signal?.aborted) return value;
  cache.set(a.id, { at: Date.now(), value });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return value;
}

/** The reading as the model gets it. */
export function readingText(a: Artwork, r: WorkReading): string {
  const lines = [`${a.id} · ${a.title} · ${a.artist}${a.date ? ` · ${a.date}` : ""}`];
  lines.push(
    r.label
      ? `From ${MUSEUM[a.source]}'s own text on this work:\n${r.label}`
      : "(No museum text on this work. Go by what you see; there's no need to tell the visitor.)",
  );
  if (r.facts?.length) lines.push(r.facts.join(" · "));
  if (r.artist) lines.push(`On ${r.artist.name} (${r.artist.from}):\n${r.artist.text}`);
  return lines.join("\n");
}
