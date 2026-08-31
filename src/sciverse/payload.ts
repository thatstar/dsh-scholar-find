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
 *  - `query` and `sort` are mutually exclusive upstream; the `auto` year-sort
 *    rule keeps the sort empty whenever a keyword `query` (or `sort_advanced`)
 *    is present, so BM25 relevance ordering is preserved.
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
        filters.push({ operator: FILTER_OP_EQ, ...(item as Record<string, unknown>) } as MetaSearchFilter)
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
      if (item && typeof item === 'object' && (item as Record<string, unknown>).field) {
        const s = item as Record<string, unknown>
        sort.push({ field: s.field as string, order: (s.order as string | undefined) ?? SORT_ORDER_DESC })
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
  if (mode === undefined || mode === null) return out
  const mapped = SEMANTIC_MODE_MAP[String(mode)]
  if (!mapped) {
    throw new Error(`mode must be one of ${Object.keys(SEMANTIC_MODE_MAP).join(' / ')}, got ${JSON.stringify(mode)}`)
  }
  // Explicitly passed retrieval / sub_queries win over the mode mapping.
  return { ...mapped, ...out }
}
