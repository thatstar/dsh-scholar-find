/**
 * Direct REST client for the Sciverse Open Platform academic-retrieval APIs
 * (`https://api.sciverse.space`) — a clean-room implementation against the
 * public HTTP API. NO SDK dependency: the `sciverse` npm package is not used
 * (the six endpoints are documented in full at https://sciverse.space/llms.txt
 * and the per-endpoint API pages; the cookbooks call them with raw HTTP).
 *
 * House rules applied here:
 *  - the Bearer token comes from the DSH credentials domain (never settings);
 *  - every call is bounded by a real timeout via `timedFetch` (AbortSignal —
 *    the request socket is actually cancelled, unlike a wall-clock wrapper);
 *  - NO proxy and NO browser UA: Sciverse is a China-hosted service and is
 *    intentionally fetched DIRECTLY (documented in AGENTS.md). `timedFetch`
 *    is reused with the global `fetch` as `fetchImpl` so neither the proxy
 *    dispatcher nor the plugin User-Agent ever applies here.
 *  - non-OK responses become a structured {@link SciverseHttpError} carrying
 *    `status`, the documented `code`, and a `retryable` verdict (retry only
 *    on 5xx/429; never on 400/401/403/404).
 * @module dsh-scholar-find/sciverse
 */

import { randomUUID } from 'node:crypto'
import { timedFetch } from '../fetch/transport.js'
import { sleep } from '../util/async.js'
import { META_SEARCH_PAGE_SIZE_MAX, buildAgenticSearchPayload, buildMetaSearchPayload, clampNumber } from './payload.js'

/** Public gateway endpoint (override for tests via the constructor baseUrl). */
export const SCIVERSE_DEFAULT_ENDPOINT = 'https://api.sciverse.space'

/** Client-origin tag sent to the gateway (platform + channel, like the SDK). */
const CHANNEL = 'typescript-sdk'
const SOURCE = `${process.platform}-${CHANNEL}`

/**
 * True when retrying the same request could plausibly succeed: a retryable HTTP
 * status (429/5xx), or a transport-level failure (socket timeout, DNS, reset).
 * A programming error is not retryable. Lives here (not in ./errors.ts) so the
 * dependency between the two modules stays one-way.
 */
export function isRetryableSciverseError(e: unknown): boolean {
  if (e instanceof SciverseHttpError) return e.retryable
  const message = e instanceof Error ? e.message : String(e)
  return /timeout|timed out|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|socket hang up|network|aborted/i.test(message)
}

/** Attempts per request (1 try + 2 retries) for transient failures. */
export const SCIVERSE_MAX_ATTEMPTS = 3
/** Backoff between those attempts, ms (index = attempt - 1). */
export const SCIVERSE_RETRY_BACKOFF_MS = [600, 1800]

/**
 * `/content` request defaults. An OMITTED `offset` makes the API return the
 * whole document and ignore `limit` (docs: 「未传时返回全文」/「仅在传入 offset
 * 时生效」), so the client always sends one. 4096 matches the official MCP
 * server's default slice; the server's own `limit` default is 700.
 */
export const SCIVERSE_CONTENT_DEFAULT_OFFSET = 0
export const SCIVERSE_CONTENT_DEFAULT_LIMIT = 4096

/** `/content` documented bounds: `offset` ≥ 0, `limit` 1–524288 (silently clamped upstream). */
export const SCIVERSE_CONTENT_LIMIT_MAX = 524288

/**
 * JSON-ish error body → structured error with the documented `code`.
 *
 * The gateway nests the real payload in `error`
 * (`{"error":{"biz_code":12633,"code":"CONTENT_NOT_FOUND","message":"…"}}`,
 * live-verified), so both the nested and the flat shape are read — missing the
 * nested one silently dropped the business code from every real failure.
 */
export async function httpErrorFromResponse(res: Response): Promise<SciverseHttpError> {
  const raw = await res.text()
  let code: string | undefined
  let message = raw
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    if (j && typeof j === 'object') {
      const nested = j.error && typeof j.error === 'object' ? (j.error as Record<string, unknown>) : undefined
      const pick = (o: Record<string, unknown> | undefined, key: string): string | undefined => (typeof o?.[key] === 'string' ? (o[key] as string) : undefined)
      code = pick(nested, 'code') ?? pick(nested, 'biz_code') ?? pick(j, 'code') ?? pick(j, 'biz_code')
      if (typeof nested?.message === 'string') message = nested.message
      else if (typeof j.message === 'string') message = j.message
      else if (j.error && typeof j.error === 'string') message = j.error
    }
  } catch {
    // Non-JSON body: keep the raw text as the message.
  }
  return new SciverseHttpError(res.status, code, message)
}

/**
 * Structured error for a non-OK Sciverse response. `message` keeps the SDK-era
 * `Sciverse API <status>: <body>` shape so existing string-based handlers
 * (e.g. `mapGetResourceError`) keep classifying it correctly.
 */
export class SciverseHttpError extends Error {
  readonly status: number
  readonly code?: string
  /** True when retrying is likely to help: 5xx upstream errors and 429. */
  readonly retryable: boolean

  constructor(status: number, code: string | undefined, message: string) {
    super(`Sciverse API ${status}: ${message}`)
    this.name = 'SciverseHttpError'
    this.status = status
    this.code = code
    this.retryable = status >= 500 || status === 429
  }
}

/** Retry policy override (tests use a no-wait policy). */
export interface SciverseRetryPolicy {
  readonly maxAttempts?: number
  readonly backoffMs?: readonly number[]
}

/** One call on any of the six Sciverse tools, timeout-bounded and direct. */
export class SciverseClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly timeoutMs: number
  private readonly maxAttempts: number
  private readonly backoffMs: readonly number[]

  constructor(token: string, timeoutMs: number, baseUrl?: string, retry?: SciverseRetryPolicy) {
    this.token = token
    this.timeoutMs = timeoutMs
    this.baseUrl = (baseUrl ?? SCIVERSE_DEFAULT_ENDPOINT).replace(/\/$/, '')
    this.maxAttempts = Math.max(1, retry?.maxAttempts ?? SCIVERSE_MAX_ATTEMPTS)
    this.backoffMs = retry?.backoffMs ?? SCIVERSE_RETRY_BACKOFF_MS
  }

  /** JSON request with the common headers; real socket timeout via AbortSignal.
   *  An optional outer `signal` (e.g. the tool's `exec.signal`) composes with
   *  the timeout, so a cancelled tool run aborts the in-flight request.
   *
   *  Retries the transient failures (429/5xx/timeout/socket) with backoff —
   *  `502 FETCH_FAILED` is the documented answer for full text the platform
   *  could not fetch on the first attempt. A 4xx never retries, and an outer
   *  cancellation stops immediately. */
  private async json<T>(label: string, path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const res = await timedFetch(
          `${this.baseUrl}${path}`,
          {
            ...init,
            headers: {
              ...(init.headers ?? {}),
              authorization: `Bearer ${this.token}`,
              'content-type': 'application/json',
              'x-request-id': randomUUID(),
              'x-sciverse-source': SOURCE,
            },
          },
          {
            timeoutMs: this.timeoutMs,
            errorLabel: `sciverse ${label}: timeout after ${this.timeoutMs}ms`,
            signal,
            // Global undici fetch: NO proxy dispatcher, NO plugin browser UA.
            fetchImpl: (url, reqInit) => fetch(url, reqInit),
          },
        )
        if (!res.ok) throw await httpErrorFromResponse(res)
        return (await res.json()) as T
      } catch (e) {
        lastError = e
        if (!isRetryableSciverseError(e) || attempt === this.maxAttempts || signal?.aborted) throw e
        const wait = this.backoffMs[attempt - 1] ?? this.backoffMs[this.backoffMs.length - 1] ?? 0
        if (wait > 0) await sleep(wait, signal)
      }
    }
    throw lastError
  }

  /** Structured metadata search over papers/authors/sources. */
  searchPapers(args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.json('search_papers', '/meta-search', {
      method: 'POST',
      body: JSON.stringify(buildMetaSearchPayload(args)),
    }, signal)
  }

  /** Natural-language semantic retrieval over passages (RAG chunks). */
  semanticSearch(args: { query: string } & Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    return this.json('semantic_search', '/agentic-search', {
      method: 'POST',
      body: JSON.stringify(buildAgenticSearchPayload(args)),
    }, signal)
  }

  /** Discover search_papers fields, filter operators, and enum samples. */
  listCatalog(
    args: { include_sample_values?: boolean; include_field_stats?: boolean; collection?: string } = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    const qs = new URLSearchParams()
    qs.set('include_sample_values', String(Boolean(args.include_sample_values)))
    if (args.include_field_stats) qs.set('include_field_stats', 'true')
    if (args.collection) qs.set('collection', args.collection)
    return this.json('list_catalog', `/meta-catalog?${qs.toString()}`, undefined, signal)
  }

  /** Paginate a paper's citations / references / related works. */
  listPaperRelations(args: { unique_id: string; relation: string; page?: number; page_size?: number }, signal?: AbortSignal): Promise<unknown> {
    // Documented bounds (page ≥ 1, page_size 1–200): the tool schema cannot
    // express min/max, so clamp here rather than let the gateway answer 400.
    const page = clampNumber(args.page, 1, Number.MAX_SAFE_INTEGER)
    // `/meta-paper-relations` shares today's 200 bound with `/meta-search`; if the
    // endpoints ever diverge, give this call its own constant.
    const pageSize = clampNumber(args.page_size, 1, META_SEARCH_PAGE_SIZE_MAX)
    return this.json('list_paper_relations', '/meta-paper-relations', {
      method: 'POST',
      body: JSON.stringify({
        ...args,
        ...(page !== undefined ? { page } : {}),
        ...(pageSize !== undefined ? { page_size: pageSize } : {}),
      }),
    }, signal)
  }

  /**
   * Character-offset slice of a paper's full text (extend RAG context).
   *
   * `offset` DEFAULTS TO 0 and is always sent: the API's documented behaviour
   * for an omitted offset is "return the whole document", and `limit` is then
   * ignored ("仅在传入 offset 时生效") — so a limit-only call would stream an
   * entire paper instead of a bounded slice. Sending offset=0 makes the
   * tool-facing "offset default 0" real. `limit` defaults to the same 4096 the
   * official MCP server uses; the server default is 700 and is silently
   * clamped above 524288.
   */
  readContent(args: { doc_id: string; offset?: number; limit?: number }, signal?: AbortSignal): Promise<unknown> {
    const qs = new URLSearchParams()
    qs.set('doc_id', args.doc_id)
    qs.set('offset', String(clampNumber(args.offset, 0, Number.MAX_SAFE_INTEGER) ?? SCIVERSE_CONTENT_DEFAULT_OFFSET))
    qs.set('limit', String(clampNumber(args.limit, 1, SCIVERSE_CONTENT_LIMIT_MAX) ?? SCIVERSE_CONTENT_DEFAULT_LIMIT))
    return this.json('read_content', `/content?${qs.toString()}`, undefined, signal)
  }

  /** Figure/table image bytes referenced inside read_content Markdown. */
  async getResource(args: { file_name: string }, signal?: AbortSignal): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const qs = new URLSearchParams({ file_name: args.file_name })
    const res = await timedFetch(
      `${this.baseUrl}/resource?${qs.toString()}`,
      {
        method: 'GET',
        headers: {
          authorization: `Bearer ${this.token}`,
          accept: 'image/*',
        },
      },
      {
        timeoutMs: this.timeoutMs,
        errorLabel: `sciverse get_resource: timeout after ${this.timeoutMs}ms`,
        signal,
        fetchImpl: (url, reqInit) => fetch(url, reqInit),
      },
    )
    if (!res.ok) throw await httpErrorFromResponse(res)
    const mimeType = ((res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0] ?? '').trim()
    const bytes = new Uint8Array(await res.arrayBuffer())
    return { bytes, mimeType }
  }
}

/** Create the facade for the six sciverse_* tools (token required; the caller
 * guards on the configured DSH credential first). */
export function createSciverseClient(token: string, timeoutMs: number, retry?: SciverseRetryPolicy): SciverseClient {
  return new SciverseClient(token, timeoutMs, undefined, retry)
}
