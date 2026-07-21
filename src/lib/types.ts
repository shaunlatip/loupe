export type SourceId = "aic" | "cma" | "met" | "rijks";

/** Normalized artwork record — the contract everything hangs off. */
export interface Artwork {
  /** `${source}:${nativeId}` — globally unique, used everywhere */
  id: string;
  source: SourceId;
  nativeId: string;
  title: string;
  artist: string;
  /** display string, e.g. "1665–1667" */
  date: string;
  /** ~800px wide */
  imageThumb: string;
  /** largest available */
  imageHires: string;
  /** "CC0" | "Public Domain" */
  license: string;
  /** museum object page */
  sourceUrl: string;
  accession?: string;
  medium?: string;
  /** px of hires when known */
  dims?: { width?: number; height?: number };
  /** dominant color (HSL); AIC-only — Met/CMA leave this undefined */
  color?: { h: number; s: number; l: number };
  /**
   * Art movement(s), e.g. "Impressionism". Only AIC has a native movement
   * facet (facets.aic.styleName) at query time; this field instead carries
   * a client-side join result populated for every source (including AIC) by
   * matching `artist` against the static Wikidata (P135) lookup in
   * src/lib/movements.ts — never fetched at runtime. This is what ships
   * movement precision to Met/CMA/Rijks, which have no movement field at
   * all. Absent when the name join has no match.
   */
  movements?: string[];
}

/**
 * Per-source facet namespaces. One SearchQuery fans out to every adapter;
 * each adapter reads only `facets?.<self>` and maps it to that API's real
 * filter/facet params, on top of the always-on CC0/has-image filters.
 */
export interface SearchFacets {
  aic?: {
    styleName?: string;
    subjectName?: string;
    classificationName?: string;
    departmentName?: string;
    dateFrom?: number;
    dateTo?: number;
  };
  cma?: {
    type?: string;
    technique?: string;
    department?: string;
    culture?: string;
    createdAfter?: number;
    createdBefore?: number;
    /** CMA has no subject facet — per-source keyword stands in for one */
    q?: string;
  };
  met?: {
    departmentId?: number;
    medium?: string;
    geoLocation?: string;
    dateBegin?: number;
    dateEnd?: number;
    q?: string;
    tags?: boolean;
  };
  rijks?: {
    type?: string;
    material?: string;
    technique?: string;
    datingPeriod?: number;
    q?: string;
  };
}

export interface SearchQuery {
  q?: string;
  artist?: string;
  dateRange?: [number, number];
  /** per-source; default 24 */
  limit?: number;
  facets?: SearchFacets;
}

export interface SourceAdapter {
  id: SourceId;
  label: string;
  /** e.g. rijks: !!process.env.RIJKSMUSEUM_API_KEY */
  enabled(): boolean;
  search(q: SearchQuery, signal?: AbortSignal): Promise<Artwork[]>;
  getById(nativeId: string): Promise<Artwork | null>;
}

export interface SourceError {
  source: SourceId;
  message: string;
}

export interface SearchResponse {
  artworks: Artwork[];
  errors: SourceError[];
}
