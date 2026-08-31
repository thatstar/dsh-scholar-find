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
    expect(r).toMatchObject({ text: 'hello world', bytes_returned: 11 })
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
    const sc = createSciverseClient('tk', 60)
    await expect(sc.listCatalog()).rejects.toThrow('timeout after 60ms')
  })

  it('throws a structured SciverseHttpError on an error status', async () => {
    stubFetch(() => new Response('rate limited', { status: 429 }))
    const sc = createSciverseClient('tk', 5000)
    const err = (await sc.searchPapers({}).catch((e) => e)) as SciverseHttpError
    expect(err).toBeInstanceOf(SciverseHttpError)
    expect(err.status).toBe(429)
    expect(err.retryable).toBe(true)
    expect(err.message).toContain('Sciverse API 429')
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
