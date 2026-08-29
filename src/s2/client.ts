/**
 * Independent TypeScript client for the Semantic Scholar Graph API.
 * Clean-room implementation from the public API docs. Built on the Node
 * global `fetch`.
 *
 * Enforces: per-request pacing (auto 1100 ms with a key / 5000 ms anonymous),
 * exponential backoff on 429/504, and a 403-with-key fallback to anonymous.
 * @module dsh-scholar-find/s2-client
 */

import { timedFetch } from '../fetch/transport.js'
import { sleep } from '../util/async.js'

/** S2 Graph API base URL (shared by this client and the fetch chain's title resolver). */
export const GRAPH = 'https://api.semanticscholar.org/graph/v1'
const RECS = 'https://api.semanticscholar.org/recommendations/v1'

/** Max backoff wait between retries, ms. */
const MAX_BACKOFF_MS = 60_000
/** Retry count for 429/504 and connection failures. */
const MAX_RETRIES = 5
/** Default anonymous pacing, ms. */
export const ANONYMOUS_GAP_MS = 5_000
/** Default authenticated pacing, ms. */
export const KEYED_GAP_MS = 1_100
/** Default per-request timeout, ms. */
const DEFAULT_TIMEOUT_MS = 30_000
/** S2 Graph API returns at most this many results per page. */
const S2_PAGE_MAX = 100
/** S2 batch lookup accepts at most this many ids. */
const S2_BATCH_MAX = 500

/** Default result counts for the S2 helper defaults (single source — the tool
 * layer in register.ts mirrors these so a default changes in one place). */
export const DEFAULT_SEARCH_RESULTS = 20
export const DEFAULT_SNIPPETS = 10
export const DEFAULT_CITATIONS = 100
export const DEFAULT_RECS = 10
export const DEFAULT_AUTHORS = 20
/** Hard ceiling for the S2 author-search page (API rejects beyond 1000). */
export const S2_AUTHOR_SEARCH_MAX = 1000
/** Hard ceiling for a single recommendations call (documented as 'max 500'). */
export const RECS_LIMIT_MAX = 500

/**
 * Shared pacing state, GLOBAL across every client instance in the process.
 * Each tool call constructs a fresh client, so without a shared clock a burst
 * of calls would fire immediately and exhaust Semantic Scholar's shared
 * anonymous pool (429). Serialized via `pacingChain`.
 */
let sharedLastRequestAt = 0
let pacingChain: Promise<void> = Promise.resolve()

/** Reset the shared pacing clock (tests only). */
export function resetSharedPacing(): void {
  sharedLastRequestAt = 0
  pacingChain = Promise.resolve()
}

/**
 * The default pacing implementation: serialize every request on a process-global
 * chain so consecutive client instances (one per tool call) cannot burst the
 * shared anonymous S2 pool. A rejected waiter must not strand later callers.
 */
function globalPace(gapMs: number, signal?: AbortSignal): Promise<void> {
  const follow = pacingChain.then(async () => {
    const elapsed = Date.now() - sharedLastRequestAt
    const wait = gapMs - elapsed
    if (wait > 0) {
      await sleep(wait, signal)
    }
    sharedLastRequestAt = Date.now()
  })
  pacingChain = follow.catch(() => {})
  return follow
}

/** A semantic-scholar HTTP error with the API message when available. */
export class ScholarHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'ScholarHttpError'
  }
}

/** S2 paper id forms accepted by the API. */
export type PaperId = string // e.g. DOI:10.1038/..., ARXIV:2106.15928, PMID:..., CorpusId:...

/** Shared search filters (snake_case, translated to S2 camelCase params). */
export interface ScholarFilters {
  year?: string
  publicationDate?: string
  venue?: string
  fieldsOfStudy?: string
  minCitationCount?: number
  publicationTypes?: string
  openAccess?: boolean
}

export interface ScholarClientOptions {
  /** Resolve the API key per request (settings-driven). May be async. */
  readonly apiKey?: () => Promise<string | undefined>
  /** Pacing override in ms; `0` means auto (keyed/anonymous). */
  readonly minGapMs?: number
  /** Per-request timeout in ms. */
  readonly timeoutMs?: number
  /** Cancellation signal forwarded to every request. */
  readonly signal?: AbortSignal
  /** Backoff override for tests (default: exponential 2s -> 60s). */
  readonly backoffMs?: (attempt: number) => number
  /**
   * Pacing hook replacing the process-global pacing clock (tests only): called
   * with the effective gap before each request. Absent -> the shared global
   * clock (serialized across ALL client instances, which is what protects the
   * anonymous S2 pool).
   */
  readonly pacer?: { before: (gapMs: number) => Promise<void> }
}

export interface ScholarClient {
  readonly request: (method: 'GET' | 'POST', url: string, params?: Record<string, string | undefined>, json?: unknown) => Promise<any>
  readonly apiKey: () => Promise<string | undefined>
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

/** Create one client instance. Pacing is GLOBAL across all instances in the
 * process (a module-level clock + serialized queue), so consecutive tool calls
 * cannot burst the shared anonymous pool; auth fallback state stays per
 * instance. */
export function createScholarClient(options: ScholarClientOptions): ScholarClient {
  let keyInvalid = false

  async function currentKey(): Promise<string | undefined> {
    if (keyInvalid) return undefined
    const key = options.apiKey ? await options.apiKey() : undefined
    return key?.trim() ? key : undefined
  }

  /** The effective pacing given whether a key is (still) considered valid. */
  function effectiveGap(keyed: boolean): number {
    const override = options.minGapMs
    if (override !== undefined && override > 0) return override
    return keyed ? KEYED_GAP_MS : ANONYMOUS_GAP_MS
  }

  async function pace(keyed: boolean): Promise<void> {
    const gap = effectiveGap(keyed)
    if (options.pacer) {
      await options.pacer.before(gap)
      return
    }
    await globalPace(gap, options.signal)
  }

  async function request(
    method: 'GET' | 'POST',
    url: string,
    params?: Record<string, string | undefined>,
    json?: unknown,
  ): Promise<any> {
    let key = await currentKey()
    const attempt = async (withKey: boolean): Promise<Response> => {
      await pace(withKey)
      const query = params ? '?' + new URLSearchParams(cleanParams(params)).toString() : ''
      const headers: Record<string, string> = { Accept: 'application/json' }
      if (withKey && key) headers['x-api-key'] = key
      const init: RequestInit = { method, headers, signal: options.signal }
      if (json !== undefined) {
        headers['Content-Type'] = 'application/json'
        init.body = JSON.stringify(json)
      }
      return timedFetch(url + query, init, { timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, signal: options.signal })
    }

    let lastError: unknown
    for (let attemptNo = 0; attemptNo <= MAX_RETRIES; attemptNo++) {
      let r: Response
      try {
        r = await attempt(Boolean(key))
      } catch (e) {
        // Transport failure before an HTTP status: retry with backoff.
        if (attemptNo < MAX_RETRIES) {
          lastError = e
          await sleep(options.backoffMs ? options.backoffMs(attemptNo) : backoff(attemptNo), options.signal)
          continue
        }
        throw e
      }
      if (r.status === 403 && key) {
        // Invalid or expired key: drop it and retry unauthenticated. Drain the
        // body so the socket is not held while we retry.
        await r.body?.cancel().catch(() => {})
        keyInvalid = true
        key = undefined
        continue
      }
      if (r.status === 429 || r.status === 504) {
        if (attemptNo < MAX_RETRIES) {
          await r.body?.cancel().catch(() => {})
          await sleep(options.backoffMs ? options.backoffMs(attemptNo) : backoff(attemptNo), options.signal)
          continue
        }
        r = await attempt(Boolean(key))
      }
      const text = await r.text()
      let body: any
      try {
        body = text ? JSON.parse(text) : null
      } catch {
        body = text
      }
      if (!r.ok) {
        const message = typeof body === 'object' && body !== null
          ? (body.message ?? body.error ?? `HTTP ${r.status}`)
          : `HTTP ${r.status}`
        throw new ScholarHttpError(r.status, String(message), body)
      }
      return body
    }
    throw lastError ?? new Error('request failed')
  }

  return {
    request,
    apiKey: currentKey,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    signal: options.signal,
  }
}

function cleanParams(params: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') out[k] = v
  }
  return out
}

function backoff(attempt: number): number {
  return Math.min(2 ** (attempt + 1) * 1_000, MAX_BACKOFF_MS)
}

/** Translate shared snake_case filters to the S2 camelCase query params. */
export function toQueryParams(filters: ScholarFilters = {}): Record<string, string | undefined> {
  const p: Record<string, string | undefined> = {}
  if (filters.year) p.year = filters.year
  if (filters.publicationDate) p.publicationDateOrYear = filters.publicationDate
  if (filters.venue) p.venue = filters.venue
  if (filters.fieldsOfStudy) p.fieldsOfStudy = filters.fieldsOfStudy
  if (filters.minCitationCount !== undefined) p.minCitationCount = String(filters.minCitationCount)
  if (filters.publicationTypes) p.publicationTypes = filters.publicationTypes
  if (filters.openAccess) p.openAccessPdf = ''
  return p
}

/** Compose a boolean query string for bulk search. See SKILL reference for syntax. */
export function buildBoolQuery(options: {
  phrases?: readonly string[]
  required?: readonly string[]
  excluded?: readonly string[]
  orTerms?: readonly string[]
  fuzzy?: readonly (readonly [term: string, editDistance: number])[]
  proximity?: readonly (readonly [phrase: string, wordDistance: number])[]
}): string {
  const parts: string[] = []
  for (const p of options.phrases ?? []) parts.push(`"${p}"`)
  for (const r of options.required ?? []) parts.push(`+${r}`)
  for (const e of options.excluded ?? []) parts.push(`-${e}`)
  if (options.orTerms?.length) parts.push(`(${options.orTerms.join(' | ')})`)
  for (const [term, dist] of options.fuzzy ?? []) parts.push(`${term}~${dist}`)
  for (const [phrase, dist] of options.proximity ?? []) parts.push(`"${phrase}"~${dist}`)
  return parts.join(' ')
}

/** Drop duplicates by paperId, preserving first-seen order. */
export function deduplicate<T extends { paperId?: string }>(papers: readonly T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const p of papers) {
    if (p.paperId && !seen.has(p.paperId)) {
      seen.add(p.paperId)
      out.push(p)
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Field defaults (minimal by design — S2 responses slow down with more fields)
// ---------------------------------------------------------------------------

export const DEFAULT_PAPER_FIELDS = 'title,year,citationCount,authors,venue,externalIds,tldr'
export const BULK_PAPER_FIELDS = 'title,year,citationCount,authors,venue,externalIds'
const AUTHOR_FIELDS = 'name,affiliations,paperCount,citationCount,hIndex'

// ---------------------------------------------------------------------------
// High-level helpers
// ---------------------------------------------------------------------------

async function paginate(client: ScholarClient, url: string, params: Record<string, string | undefined>, maxResults: number): Promise<any[]> {
  const next = { ...params, limit: String(Math.min(maxResults, S2_PAGE_MAX)), offset: '0' }
  const out: any[] = []
  while (out.length < maxResults) {
    const r = await client.request('GET', url, next)
    out.push(...(r.data ?? []))
    // `r.next` is the next `offset` (a number). It is typed as a string here
    // because params values are strings; URLSearchParams coerces the number.
    const cursor: string | undefined = r.next
    if (!cursor || out.length >= maxResults) break
    next.offset = cursor
  }
  return out.slice(0, maxResults)
}

async function paginateBulk(client: ScholarClient, url: string, params: Record<string, string | undefined>, maxResults: number): Promise<any[]> {
  const next = { ...params }
  const out: any[] = []
  while (out.length < maxResults) {
    const r = await client.request('GET', url, next)
    out.push(...(r.data ?? []))
    const token: string | undefined = r.token
    if (!token || out.length >= maxResults) break
    next.token = token
  }
  return out.slice(0, maxResults)
}

/** Bulk (boolean) search. Up to ~10M results; no tldr on this endpoint. */
export async function searchBulk(
  client: ScholarClient,
  query: string,
  options: { maxResults?: number; sort?: 'citationCount:desc' | 'publicationDate:desc' | 'paperId:asc'; filters?: ScholarFilters; fields?: string } = {},
): Promise<any[]> {
  const params = {
    query,
    fields: options.fields ?? BULK_PAPER_FIELDS,
    sort: options.sort ?? 'citationCount:desc',
    ...toQueryParams(options.filters),
  }
  return paginateBulk(client, `${GRAPH}/paper/search/bulk`, params, options.maxResults ?? DEFAULT_SEARCH_RESULTS)
}

/** Relevance-ranked search (supports tldr). */
export async function searchRelevance(
  client: ScholarClient,
  query: string,
  options: { maxResults?: number; filters?: ScholarFilters; fields?: string } = {},
): Promise<any[]> {
  const maxResults = options.maxResults ?? DEFAULT_SEARCH_RESULTS
  const params = {
    query,
    fields: options.fields ?? DEFAULT_PAPER_FIELDS,
    ...toQueryParams(options.filters),
  }
  if (maxResults <= S2_PAGE_MAX) {
    const r = await client.request('GET', `${GRAPH}/paper/search`, { ...params, limit: String(maxResults) })
    return (r.data ?? []).slice(0, maxResults)
  }
  return paginate(client, `${GRAPH}/paper/search`, params, maxResults)
}

/** Full-text snippet search. */
export async function searchSnippets(
  client: ScholarClient,
  query: string,
  options: { maxResults?: number; paperIds?: string; authors?: string; insertedBefore?: string } = {},
): Promise<any[]> {
  const params: Record<string, string | undefined> = {
    query,
    fields: 'snippet.text,snippet.snippetKind,snippet.section',
    limit: String(Math.min(options.maxResults ?? DEFAULT_SNIPPETS, S2_PAGE_MAX)),
    paperIds: options.paperIds,
    authors: options.authors,
    insertedBefore: options.insertedBefore,
  }
  const r = await client.request('GET', `${GRAPH}/snippet/search`, params)
  return (r.data ?? []).slice(0, options.maxResults ?? DEFAULT_SNIPPETS)
}

/** Exact-title match (single best result envelope). */
export async function matchTitle(client: ScholarClient, title: string): Promise<any> {
  return client.request('GET', `${GRAPH}/paper/search/match`, { query: title, fields: DEFAULT_PAPER_FIELDS })
}

/** Single paper by id (DOI:, ARXIV:, PMID:, PMCID:, CorpusId:, ...). */
export async function getPaper(client: ScholarClient, paperId: PaperId, fields?: string): Promise<any> {
  return client.request('GET', `${GRAPH}/paper/${encodeURIComponent(paperId)}`, {
    fields: fields ?? `${DEFAULT_PAPER_FIELDS},abstract,openAccessPdf`,
  })
}

/** Who cites a paper (with contextsWithIntent when requested). */
export async function getCitations(
  client: ScholarClient,
  paperId: PaperId,
  options: { maxResults?: number; publicationDate?: string; withIntents?: boolean } = {},
): Promise<any[]> {
  const maxResults = options.maxResults ?? DEFAULT_CITATIONS
  const fields = options.withIntents
    ? 'title,year,citationCount,authors,venue,contextsWithIntent'
    : 'title,year,citationCount,authors,venue'
  const params: Record<string, string | undefined> = { fields, ...(options.publicationDate ? { publicationDateOrYear: options.publicationDate } : {}) }
  return paginate(client, `${GRAPH}/paper/${encodeURIComponent(paperId)}/citations`, params, maxResults)
}

/** What a paper cites. */
export async function getReferences(client: ScholarClient, paperId: PaperId, options: { maxResults?: number } = {}): Promise<any[]> {
  return paginate(client, `${GRAPH}/paper/${encodeURIComponent(paperId)}/references`, { fields: 'title,year,citationCount,authors,venue' }, options.maxResults ?? DEFAULT_CITATIONS)
}

/** Single-seed recommendations. */
export async function findSimilar(client: ScholarClient, paperId: PaperId, options: { limit?: number; pool?: 'recent' | 'all-cs' } = {}): Promise<any[]> {
  const r = await client.request('GET', `${RECS}/papers/forpaper/${encodeURIComponent(paperId)}`, {
    fields: 'title,year,citationCount,authors,venue',
    limit: String(Math.min(options.limit ?? DEFAULT_RECS, RECS_LIMIT_MAX)),
    from: options.pool ?? 'recent',
  })
  return r.recommendedPapers ?? []
}

/** Multi-seed recommendations with optional negative seeds. */
export async function recommend(client: ScholarClient, options: { positiveIds: readonly string[]; negativeIds?: readonly string[]; limit?: number }): Promise<any[]> {
  const body: Record<string, unknown> = { positivePaperIds: options.positiveIds }
  if (options.negativeIds?.length) body.negativePaperIds = options.negativeIds
  const r = await client.request('POST', `${RECS}/papers/`, { fields: 'title,year,citationCount,authors,venue', limit: String(Math.min(options.limit ?? DEFAULT_RECS, RECS_LIMIT_MAX)) }, body)
  return r.recommendedPapers ?? []
}

/** Search authors by name. */
export async function searchAuthors(client: ScholarClient, query: string, maxResults = DEFAULT_AUTHORS): Promise<any[]> {
  const r = await client.request('GET', `${GRAPH}/author/search`, { query, fields: AUTHOR_FIELDS, limit: String(Math.min(maxResults, S2_AUTHOR_SEARCH_MAX)) })
  return (r.data ?? []).slice(0, maxResults)
}

/** Author profile. */
export async function getAuthor(client: ScholarClient, authorId: string): Promise<any> {
  return client.request('GET', `${GRAPH}/author/${encodeURIComponent(authorId)}`, { fields: AUTHOR_FIELDS })
}

/** Author publication list. */
export async function getAuthorPapers(client: ScholarClient, authorId: string, maxResults = DEFAULT_CITATIONS): Promise<any[]> {
  return paginate(client, `${GRAPH}/author/${encodeURIComponent(authorId)}/papers`, { fields: DEFAULT_PAPER_FIELDS }, maxResults)
}

/** Batch paper lookup (<=500 ids). */
export async function batchPapers(client: ScholarClient, ids: readonly string[], fields?: string): Promise<any[]> {
  const r = await client.request('POST', `${GRAPH}/paper/batch`, { fields: fields ?? DEFAULT_PAPER_FIELDS }, { ids: ids.slice(0, S2_BATCH_MAX) })
  return Array.isArray(r) ? r : []
}