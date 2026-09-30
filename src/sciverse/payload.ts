/**
 * Pure request-payload builders for the Sciverse Open Platform REST API
 * (`https://api.sciverse.space`). No I/O, no runtime imports — unit-testable.
 *
 * Two translation layers live here, mirroring the public API contract
 * (see https://sciverse.space/llms.txt §6):
 *
 *  - `buildMetaSearchPayload` — maps the plugin's search-tool args
 *    (`title_contains`, `authors`, `year_from`, …) onto the `/meta-search`
 *    body shape: a `FieldFilter[]` array (`{field, operator, value}`) and a
 *    `SortField[]` array. The canonical API has no convenience args; every
 *    structured constraint must be expressed as a filter.
 *  - `buildAgenticSearchPayload` — maps the tool's `mode` (fast/balanced/
 *    quality) onto the `/agentic-search` upstream parameters (`retrieval`,
 *    `sub_queries`), strips `undefined` keys, and passes everything else
 *    through verbatim (including the optional `filters` object).
 *
 * Notes:
 *  - `abstract_contains` is intentionally NOT translated into a filter: the
 *    backend rejects `FILTER_OP_CONTAINS` on `abstract` (the field is
 *    full-text only, not filterable). The tool layer folds it into `query`
 *    before this builder runs; if it ever reaches here it is ignored.
 *  - `query` + explicit `sort` ARE compatible upstream (the query degrades to
 *    a hit filter, the hard sort wins) — that is what `sort_advanced` does.
 *    The `auto` year-sort rule only decides the IMPLICIT year ordering: it
 *    keeps the sort empty whenever a keyword `query` (or `sort_advanced`) is
 *    present, so BM25 relevance (and soft boosts) rank instead of a year sort.
 * @module dsh-scholar-find/sciverse-payload
 */

/** Args passed through to /meta-search untouched (when defined). */
const META_SEARCH_PASSTHROUGH = [
  'query',
  'page',
  'page_size',
  'fields',
  'collection',
  // Soft-boost tiers (NONE/MILD/STRONG, combinable): freshness / impact / language affinity
  'freshness_boost',
  'impact_boost',
  'language_affinity',
] as const

/** Filter operators supported by the backend (per /meta-catalog). */
export const FILTER_OP_EQ = 'FILTER_OP_EQ'
export const FILTER_OP_IN = 'FILTER_OP_IN'
export const FILTER_OP_GTE = 'FILTER_OP_GTE'
export const FILTER_OP_LTE = 'FILTER_OP_LTE'
export const FILTER_OP_CONTAINS = 'FILTER_OP_CONTAINS'

export const SORT_ORDER_DESC = 'SORT_ORDER_DESC'
export const SORT_ORDER_ASC = 'SORT_ORDER_ASC'

/**
 * Documented `/meta-search` bounds (llms.txt §6.3): `page_size` 1–200, `page` ≥ 1,
 * and page * page_size ≤ 10000 (deeper paging needs `cursor`). The tool schema
 * DSL has no `minimum`/`maximum`, so the request layer enforces them — an
 * out-of-range `page_size` used to reach the API and come back as a bare 400.
 */
export const META_SEARCH_PAGE_SIZE_MIN = 1
export const META_SEARCH_PAGE_SIZE_MAX = 200
export const META_SEARCH_PAGE_WINDOW = 10000

/** `/agentic-search` `top_k` bound (docs §6.1: 1–100). */
export const SEMANTIC_TOP_K_MAX = 100

/**
 * Truncate a numeric argument into `[min, max]`; `undefined` when it is not a
 * finite number (so a malformed value never becomes `NaN` on the wire).
 */
export function clampNumber(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.min(Math.max(Math.trunc(value), min), max)
}

/**
 * The page window as it would actually be SENT (page/page_size clamped to the
 * documented bounds; an omitted page_size means the server default 25). Use
 * `product` for error messages so they quote the request the gateway would see,
 * not the caller's raw numbers.
 */
export function clampedPageWindow(page: unknown, pageSize: unknown): { page: number; page_size: number; product: number } {
  const p = clampNumber(page, 1, Number.MAX_SAFE_INTEGER) ?? 1
  const s = clampNumber(pageSize, META_SEARCH_PAGE_SIZE_MIN, META_SEARCH_PAGE_SIZE_MAX) ?? 25
  return { page: p, page_size: s, product: p * s }
}

/**
 * Would the requested page window exceed the API's paging ceiling? Callers use
 * this to answer with a typed validation error instead of letting the API 400.
 * Applies to `/meta-search` always and to `/meta-paper-relations` CITATIONS
 * only (REFERENCES/RELATED_WORKS page freely — live-verified).
 */
export function pageWindowExceeded(page: unknown, pageSize: unknown): boolean {
  return clampedPageWindow(page, pageSize).product > META_SEARCH_PAGE_WINDOW
}

/** The sortable year field name (per /meta-catalog). */
const YEAR_FIELD = 'publication_published_year'

export interface MetaSearchFilter {
  field: string
  operator?: string
  value: unknown
}

export interface MetaSearchSort {
  field: string
  order?: string
}

/** Paper-only filter: drops books/ebooks/Zenodo-style records from pools. */
export function paperOnlyFilter(): MetaSearchFilter {
  return { field: 'metadata_type', operator: FILTER_OP_EQ, value: 'paper' }
}

/**
 * Topic-scoped filter set for trend queries: OpenAlex topic (matched via
 * `primary_topic.id`), optional exact year, paper-only. Omitting `year` gives
 * the year-free discovery shape.
 */
export function topicYearPaperFilters(topicId: string, year?: number): MetaSearchFilter[] {
  const filters: MetaSearchFilter[] = [{ field: 'primary_topic.id', operator: FILTER_OP_EQ, value: topicId }]
  if (year !== undefined) filters.push({ field: YEAR_FIELD, operator: FILTER_OP_EQ, value: year })
  filters.push(paperOnlyFilter())
  return filters
}

/**
 * Build the `/meta-search` request body from the plugin's search args.
 * Structured constraints become `filters`; the year ordering becomes `sort`
 * (with the `auto` rule: no sort when a keyword query is present, else
 * year-desc). Passthrough args (query/page/page_size/…) are copied when set.
 */
export function buildMetaSearchPayload(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  const filters: MetaSearchFilter[] = []
  const sort: MetaSearchSort[] = []

  for (const k of META_SEARCH_PASSTHROUGH) {
    if (args[k] !== undefined && args[k] !== null) out[k] = args[k]
  }
  // Enforce the documented bounds here (the schema DSL has no min/max): an
  // out-of-range page/page_size must not reach the gateway as a 400.
  if (out.page !== undefined) {
    const page = clampNumber(out.page, 1, Number.MAX_SAFE_INTEGER)
    if (page === undefined) delete out.page
    else out.page = page
  }
  if (out.page_size !== undefined) {
    const size = clampNumber(out.page_size, META_SEARCH_PAGE_SIZE_MIN, META_SEARCH_PAGE_SIZE_MAX)
    if (size === undefined) delete out.page_size
    else out.page_size = size
  }

  if (args.title_contains !== undefined && args.title_contains !== null) {
    filters.push({ field: 'title', operator: FILTER_OP_CONTAINS, value: args.title_contains })
  }
  // abstract_contains: deliberately NOT mapped (backend rejects filtering on
  // `abstract`); the tool layer folds it into `query` instead.
  if (Array.isArray(args.authors) && args.authors.length > 0) {
    filters.push({ field: 'author', operator: FILTER_OP_IN, value: args.authors })
  }
  if (args.year_from !== undefined && args.year_from !== null) {
    filters.push({ field: YEAR_FIELD, operator: FILTER_OP_GTE, value: args.year_from })
  }
  if (args.year_to !== undefined && args.year_to !== null) {
    filters.push({ field: YEAR_FIELD, operator: FILTER_OP_LTE, value: args.year_to })
  }
  if (Array.isArray(args.journals) && args.journals.length > 0) {
    // Venue matching is EXACT against the stored normalized string, and the
    // index stores HTML-escaped forms (e.g. "Journal of Materials Science
    // &amp; Technology"). Pass venue strings VERBATIM — never unescape or
    // rewrite them here: the plain `&` form matches nothing (verified live,
    // 757 vs 0). Display layers may unescape for readability, but the filter
    // value must stay the raw stored form.
    filters.push({ field: 'publication_venue_name_unified', operator: FILTER_OP_IN, value: args.journals })
  }
  if (Array.isArray(args.subjects) && args.subjects.length > 0) {
    filters.push({ field: 'subjects', operator: FILTER_OP_IN, value: args.subjects })
  }
  if (Array.isArray(args.filters_advanced)) {
    for (const item of args.filters_advanced) {
      if (item && typeof item === 'object') {
        const f = item as { field?: unknown; operator?: unknown; value?: unknown }
        // Malformed items without a field string are dropped silently (the
        // tool schema already validates the array shape).
        if (typeof f.field === 'string') {
          filters.push({ field: f.field, operator: typeof f.operator === 'string' ? f.operator : FILTER_OP_EQ, value: f.value })
        }
      }
    }
  }

  // `auto` (default): with a keyword query (or explicit sort_advanced) there is
  // no year sort — the backend ranks by BM25 relevance and soft boosts; pure
  // structured filtering defaults to year-desc (the backend's default order is
  // effectively unsorted).
  let sortByYear = args.sort_by_year ?? 'auto'
  if (sortByYear === 'auto') {
    const hasQuery = typeof args.query === 'string' && args.query.length > 0
    const hasSortAdvanced = Array.isArray(args.sort_advanced) && args.sort_advanced.length > 0
    sortByYear = hasQuery || hasSortAdvanced ? 'none' : 'desc'
  }
  if (sortByYear !== 'none') {
    sort.push({
      field: YEAR_FIELD,
      order: sortByYear === 'desc' ? SORT_ORDER_DESC : SORT_ORDER_ASC,
    })
  }
  if (Array.isArray(args.sort_advanced)) {
    for (const item of args.sort_advanced) {
      if (item && typeof item === 'object') {
        const s = item as { field?: unknown; order?: unknown }
        // Sort items without a field string are malformed input — dropped
        // silently (the tool schema validates the array shape).
        if (typeof s.field === 'string') {
          sort.push({ field: s.field, order: typeof s.order === 'string' ? s.order : SORT_ORDER_DESC })
        }
      }
    }
  }

  if (filters.length > 0) out.filters = filters
  if (sort.length > 0) out.sort = sort
  return out
}

/**
 * Upstream /agentic-search has no `mode` field (unknown fields are silently
 * dropped by the gateway), so the tool-facing mode tiers are translated here
 * into the real upstream parameters `retrieval` / `sub_queries`.
 */
const SEMANTIC_MODE_MAP: Record<string, Record<string, unknown>> = {
  fast: { retrieval: 'es' },
  balanced: { retrieval: 'hybrid' },
  quality: { retrieval: 'hybrid', sub_queries: 3 },
}

/**
 * Build the `/agentic-search` request body: translate `mode`, drop undefined
 * keys, and pass any remaining fields (query, top_k, filters, …) through.
 */
export function buildAgenticSearchPayload(body: Record<string, unknown>): Record<string, unknown> {
  const { mode, ...rest } = body
  const out = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined))
  if (out.top_k !== undefined) {
    const topK = clampNumber(out.top_k, 1, SEMANTIC_TOP_K_MAX)
    if (topK === undefined) delete out.top_k
    else out.top_k = topK
  }
  if (mode === undefined || mode === null) return out
  const mapped = SEMANTIC_MODE_MAP[String(mode)]
  if (!mapped) {
    throw new Error(`mode must be one of ${Object.keys(SEMANTIC_MODE_MAP).join(' / ')}, got ${JSON.stringify(mode)}`)
  }
  // Explicitly passed retrieval / sub_queries win over the mode mapping.
  return { ...mapped, ...out }
}
