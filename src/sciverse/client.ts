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
import { buildAgenticSearchPayload, buildMetaSearchPayload } from './payload.js'

/** Public gateway endpoint (override for tests via the constructor baseUrl). */
export const SCIVERSE_DEFAULT_ENDPOINT = 'https://api.sciverse.space'

/** Client-origin tag sent to the gateway (platform + channel, like the SDK). */
const CHANNEL = 'typescript-sdk'
const SOURCE = `${process.platform}-${CHANNEL}`

/** JSON-ish error body → structured error with the documented `code`. */
export async function httpErrorFromResponse(res: Response): Promise<SciverseHttpError> {
  const raw = await res.text()
  let code: string | undefined
  let message = raw
  try {
    const j = JSON.parse(raw) as Record<string, unknown>
    if (j && typeof j === 'object') {
      code = typeof j.code === 'string' ? j.code : typeof j.biz_code === 'string' ? j.biz_code : undefined
      if (typeof j.message === 'string') message = j.message
      else if (typeof j.error === 'string') message = j.error
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

/** One call on any of the six Sciverse tools, timeout-bounded and direct. */
export class SciverseClient {
  private readonly baseUrl: string
  private readonly token: string
  private readonly timeoutMs: number

  constructor(token: string, timeoutMs: number, baseUrl?: string) {
    this.token = token
    this.timeoutMs = timeoutMs
    this.baseUrl = (baseUrl ?? SCIVERSE_DEFAULT_ENDPOINT).replace(/\/$/, '')
  }

  /** JSON request with the common headers; real socket timeout via AbortSignal. */
  private async json<T>(label: string, path: string, init: RequestInit = {}): Promise<T> {
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
        // Global undici fetch: NO proxy dispatcher, NO plugin browser UA.
        fetchImpl: (url, reqInit) => fetch(url, reqInit),
      },
    )
    if (!res.ok) throw await httpErrorFromResponse(res)
    return (await res.json()) as T
  }

  /** Structured metadata search over papers/authors/sources. */
  searchPapers(args: Record<string, unknown>): Promise<unknown> {
    return this.json('search_papers', '/meta-search', {
      method: 'POST',
      body: JSON.stringify(buildMetaSearchPayload(args)),
    })
  }

  /** Natural-language semantic retrieval over passages (RAG chunks). */
  semanticSearch(args: { query: string } & Record<string, unknown>): Promise<unknown> {
    return this.json('semantic_search', '/agentic-search', {
      method: 'POST',
      body: JSON.stringify(buildAgenticSearchPayload(args)),
    })
  }

  /** Discover search_papers fields, filter operators, and enum samples. */
  listCatalog(
    args: { include_sample_values?: boolean; include_field_stats?: boolean; collection?: string } = {},
  ): Promise<unknown> {
    const qs = new URLSearchParams()
    qs.set('include_sample_values', String(Boolean(args.include_sample_values)))
    if (args.include_field_stats) qs.set('include_field_stats', 'true')
    if (args.collection) qs.set('collection', args.collection)
    return this.json('list_catalog', `/meta-catalog?${qs.toString()}`)
  }

  /** Paginate a paper's citations / references / related works. */
  listPaperRelations(args: { unique_id: string; relation: string; page?: number; page_size?: number }): Promise<unknown> {
    return this.json('list_paper_relations', '/meta-paper-relations', {
      method: 'POST',
      body: JSON.stringify(args),
    })
  }

  /** Byte-range slice of a paper's full text (extend RAG context). */
  readContent(args: { doc_id: string; offset?: number; limit?: number }): Promise<unknown> {
    const qs = new URLSearchParams()
    qs.set('doc_id', args.doc_id)
    if (args.offset !== undefined) qs.set('offset', String(args.offset))
    if (args.limit !== undefined) qs.set('limit', String(args.limit))
    return this.json('read_content', `/content?${qs.toString()}`)
  }

  /** Figure/table image bytes referenced inside read_content Markdown. */
  async getResource(args: { file_name: string }): Promise<{ bytes: Uint8Array; mimeType: string }> {
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
export function createSciverseClient(token: string, timeoutMs: number): SciverseClient {
  return new SciverseClient(token, timeoutMs)
}
