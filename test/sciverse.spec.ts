import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSciverseClient, SciverseHttpError } from '../src/sciverse/client.js'

const fetchMock = vi.fn()

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => handler(url, init))
  vi.stubGlobal('fetch', fetchMock)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('SciverseClient (direct REST, no SDK)', () => {
  it('posts the translated payload to /meta-search with Bearer + source headers', async () => {
    let seen: { url?: string; init?: RequestInit } = {}
    stubFetch((url, init) => {
      seen = { url, init }
      return jsonResponse({ results: [{ unique_id: 'paper:x' }], total_count: 1 })
    })
    const sc = createSciverseClient('sv-secret', 5000)
    const r = await sc.searchPapers({ query: 'transformer', title_contains: 'attention' })
    expect(seen.url).toBe('https://api.sciverse.space/meta-search')
    expect(seen.init?.method).toBe('POST')
    const headers = seen.init?.headers as Record<string, string>
    expect(headers.authorization).toBe('Bearer sv-secret')
    expect(headers['content-type']).toBe('application/json')
    expect(headers['x-request-id']).toBeTruthy()
    expect(headers['x-sciverse-source']).toBe(`${process.platform}-typescript-sdk`)
    const body = JSON.parse(String(seen.init?.body))
    expect(body.query).toBe('transformer')
    expect(body.filters).toEqual([{ field: 'title', operator: 'FILTER_OP_CONTAINS', value: 'attention' }])
    expect(r).toEqual({ results: [{ unique_id: 'paper:x' }], total_count: 1 })
  })

  it('translates semantic-search mode and GETs content with query params', async () => {
    stubFetch((url, init) => {
      // Two calls in this test: /agentic-search then /content
      return init?.method === 'POST'
        ? jsonResponse({ hits: [] })
        : jsonResponse({ text: 'hello world', bytes_returned: 11, next_offset: 11 })
    })
    const sc = createSciverseClient('tk', 5000)
    await sc.semanticSearch({ query: 'attention', mode: 'fast', top_k: 5 })
    const first = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(first[0]).toBe('https://api.sciverse.space/agentic-search')
    const body = JSON.parse(String(first[1].body))
    expect(body.query).toBe('attention')
    expect(body.retrieval).toBe('es') // mode fast -> retrieval=es
    expect(body.top_k).toBe(5)

    const r = await sc.readContent({ doc_id: 'abc123', offset: 5 })
    const second = fetchMock.mock.calls[1]! as [string, RequestInit]
    expect(second[0]).toContain('/content?doc_id=abc123&offset=5')
    expect(second[0]).toContain('limit=4096') // explicit caller offset still gets a bounded default slice
    expect(r).toMatchObject({ text: 'hello world', bytes_returned: 11 })
  })

  it('always sends an explicit offset (an omitted one returns the whole document)', async () => {
    stubFetch(() => jsonResponse({ text: 'x', chars_returned: 1, next_offset: 1 }))
    const sc = createSciverseClient('tk', 5000)
    await sc.readContent({ doc_id: 'abc123' })
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toContain('/content?doc_id=abc123&offset=0&limit=4096')
  })

  it('clamps /content offset and limit into the documented range', async () => {
    stubFetch(() => jsonResponse({ text: 'x', bytes_returned: 1, next_offset: 1 }))
    const sc = createSciverseClient('tk', 5000)
    await sc.readContent({ doc_id: 'd', offset: -5, limit: 9_999_999 })
    const [url] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toContain('offset=0')
    expect(url).toContain('limit=524288')
  })

  it('clamps relation page/page_size (the gateway 400s above 200)', async () => {
    stubFetch(() => jsonResponse({ items: [], total_count: 0 }))
    const sc = createSciverseClient('tk', 5000)
    await sc.listPaperRelations({ unique_id: 'paper:x', relation: 'CITATIONS', page: 0, page_size: 500 })
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({ unique_id: 'paper:x', relation: 'CITATIONS', page: 1, page_size: 200 })
  })

  it('builds the meta-catalog query string', async () => {
    stubFetch(() => jsonResponse({ fields: [] }))
    const sc = createSciverseClient('tk', 5000)
    await sc.listCatalog({ include_sample_values: true, include_field_stats: true, collection: 'authors' })
    expect(String(fetchMock.mock.calls[0]![0])).toContain(
      '/meta-catalog?include_sample_values=true&include_field_stats=true&collection=authors',
    )
  })

  it('posts paper-relations args verbatim', async () => {
    stubFetch(() => jsonResponse({ items: [], total_count: 0 }))
    const sc = createSciverseClient('tk', 5000)
    await sc.listPaperRelations({ unique_id: 'paper:x', relation: 'CITATIONS', page: 2, page_size: 50 })
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('https://api.sciverse.space/meta-paper-relations')
    expect(JSON.parse(String(init.body))).toEqual({ unique_id: 'paper:x', relation: 'CITATIONS', page: 2, page_size: 50 })
  })

  it('returns raw image bytes + mime for get_resource', async () => {
    stubFetch(() => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { status: 200, headers: { 'Content-Type': 'image/png' } }))
    const sc = createSciverseClient('tk', 5000)
    const { bytes, mimeType } = await sc.getResource({ file_name: 'fig1.png' })
    expect(String(fetchMock.mock.calls[0]![0])).toContain('/resource?file_name=fig1.png')
    expect(mimeType).toBe('image/png')
    expect(bytes).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))
  })

  it('aborts a stalled call with the timeout error', async () => {
    // Mirror real fetch behavior: the request rejects with the signal's reason
    // when the client aborts it on timeout.
    stubFetch((url, init) => {
      const { signal } = init ?? {}
      return new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) {
          reject(signal.reason ?? new Error('aborted'))
          return
        }
        signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true })
      })
    })
    const sc = createSciverseClient('tk', 60, { maxAttempts: 3, backoffMs: [1, 1] })
    await expect(sc.listCatalog()).rejects.toThrow('timeout after 60ms')
  })

  it('forwards an outer cancellation signal to the request', async () => {
    stubFetch((url, init) => {
      const { signal } = init ?? {}
      return new Promise<Response>((_resolve, reject) => {
        // The signal may already be aborted when fetch is called (pre-aborted
        // outer signal → timedFetch aborts the inner controller synchronously).
        if (signal?.aborted) {
          reject(signal.reason ?? new Error('aborted'))
          return
        }
        signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true })
      })
    })
    const sc = createSciverseClient('tk', 5000)
    const controller = new AbortController()
    controller.abort(new Error('tool cancelled'))
    await expect(sc.searchPapers({ query: 'x' }, controller.signal)).rejects.toThrow('tool cancelled')
    // The pre-aborted signal must reach the request without waiting on the timeout.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws a structured SciverseHttpError on an error status (after retrying a retryable one)', async () => {
    stubFetch(() => new Response('rate limited', { status: 429 }))
    const sc = createSciverseClient('tk', 5000, { maxAttempts: 3, backoffMs: [1, 1] })
    const err = (await sc.searchPapers({}).catch((e) => e)) as SciverseHttpError
    expect(err).toBeInstanceOf(SciverseHttpError)
    expect(err.status).toBe(429)
    expect(err.retryable).toBe(true)
    expect(err.message).toContain('Sciverse API 429')
    expect(fetchMock).toHaveBeenCalledTimes(3) // 1 try + 2 retries
  })

  it('retries a transient 5xx and succeeds without surfacing the failure', async () => {
    let calls = 0
    stubFetch(() => {
      calls++
      return calls === 1 ? new Response('bad gateway', { status: 502 }) : jsonResponse({ results: [], total_count: 0 })
    })
    const sc = createSciverseClient('tk', 5000, { maxAttempts: 3, backoffMs: [1, 1] })
    await expect(sc.searchPapers({ query: 'x' })).resolves.toEqual({ results: [], total_count: 0 })
    expect(calls).toBe(2)
  })

  it('never retries a non-retryable 4xx', async () => {
    stubFetch(() => new Response(JSON.stringify({ error: { code: 'INVALID_REQUEST', message: 'bad field' } }), { status: 400, headers: { 'Content-Type': 'application/json' } }))
    const sc = createSciverseClient('tk', 5000, { maxAttempts: 3, backoffMs: [1, 1] })
    const err = (await sc.searchPapers({}).catch((e) => e)) as SciverseHttpError
    expect(err.status).toBe(400)
    expect(err.retryable).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads the business code from the nested error body the gateway actually sends', async () => {
    stubFetch(() =>
      new Response(JSON.stringify({ error: { biz_code: 12633, code: 'CONTENT_NOT_FOUND', message: '原文不存在' } }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const sc = createSciverseClient('tk', 5000)
    const err = (await sc.readContent({ doc_id: 'x' }).catch((e) => e)) as SciverseHttpError
    expect(err.code).toBe('CONTENT_NOT_FOUND')
    expect(err.status).toBe(404)
    expect(err.retryable).toBe(false)
    expect(err.message).toContain('原文不存在')
  })

  it('parses the documented code from a JSON error body', async () => {
    stubFetch(() =>
      new Response(JSON.stringify({ code: 'INVALID_REQUEST', message: 'bad field' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const sc = createSciverseClient('tk', 5000)
    const err = (await sc.searchPapers({ bogus: 1 }).catch((e) => e)) as SciverseHttpError
    expect(err.code).toBe('INVALID_REQUEST')
    expect(err.retryable).toBe(false)
    expect(err.message).toContain('bad field')
  })
})
