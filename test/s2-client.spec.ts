import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildBoolQuery, classifyScholarStatus, createScholarClient, deduplicate, resetSharedPacing, ScholarHttpError, searchBulk, searchBulkWithMeta } from '../src/s2/client.js'

const fetchMock = vi.fn()

beforeEach(() => {
  resetSharedPacing()
})

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

describe('buildBoolQuery', () => {
  it('composes phrases, required, excluded, or-groups', () => {
    expect(buildBoolQuery({ phrases: ['deep learning'], required: ['attention'], excluded: ['survey'] }))
      .toBe('"deep learning" +attention -survey')
    expect(buildBoolQuery({ orTerms: ['CNN', 'RNN'] })).toBe('(CNN | RNN)')
  })
})

describe('deduplicate', () => {
  it('keeps first-seen paperIds', () => {
    const papers = [{ paperId: 'a' }, { paperId: 'b' }, { paperId: 'a' }]
    expect(deduplicate(papers)).toEqual([{ paperId: 'a' }, { paperId: 'b' }])
  })
})

describe('createScholarClient', () => {
  it('sends the api key header when provided', async () => {
    stubFetch(() => jsonResponse({ data: [] }))
    const client = createScholarClient({ apiKey: async () => 'k123', minGapMs: 1 })
    await client.request('GET', 'https://api.semanticscholar.org/graph/v1/paper/search', { query: 'x', limit: '10' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/paper/search?')
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('k123')
  })

  it('falls back to anonymous on 403 and retries without the key', async () => {
    let calls = 0
    stubFetch(() => {
      calls++
      return calls === 1 ? jsonResponse({ message: 'invalid key' }, 403) : jsonResponse({ data: [] })
    })
    const client = createScholarClient({ apiKey: async () => 'bad', minGapMs: 1 })
    const out = await client.request('GET', 'https://api.semanticscholar.org/graph/v1/paper/search', { query: 'x' })
    expect(out).toEqual({ data: [] })
    expect(calls).toBe(2)
    const secondInit = fetchMock.mock.calls[1]![1] as RequestInit
    expect((secondInit.headers as Record<string, string>)['x-api-key']).toBeUndefined()
  })

  it('raises a ScholarHttpError on 4xx misses', async () => {
    stubFetch(() => jsonResponse({ error: 'Paper not found' }, 404))
    const client = createScholarClient({ minGapMs: 1 })
    await expect(client.request('GET', 'https://api.semanticscholar.org/graph/v1/paper/DOI:10.9999/x')).rejects.toThrow(/Paper not found/)
  })

  it('retries 429 with backoff', async () => {
    let calls = 0
    stubFetch(() => {
      calls++
      return calls < 3 ? jsonResponse({ message: 'rate limited' }, 429) : jsonResponse({ data: [] })
    })
    const client = createScholarClient({ minGapMs: 1, backoffMs: () => 1 })
    const out = await client.request('GET', 'https://api.semanticscholar.org/graph/v1/paper/search', { query: 'x' })
    expect(out).toEqual({ data: [] })
    expect(calls).toBe(3)
  })

  it('shares pacing across separate client instances (no burst)', async () => {
    resetSharedPacing()
    const fetchTimes: number[] = []
    stubFetch(() => {
      fetchTimes.push(Date.now())
      return jsonResponse({ data: [] })
    })
    // Two clients = two separate tool calls in one turn. Without a shared
    // clock the second would fire immediately and burst the pool.
    const a = createScholarClient({ minGapMs: 120 })
    const b = createScholarClient({ minGapMs: 120 })
    await a.request('GET', 'https://api.semanticscholar.org/graph/v1/paper/search', { query: 'x' })
    await b.request('GET', 'https://api.semanticscholar.org/graph/v1/paper/search', { query: 'y' })
    expect(fetchTimes).toHaveLength(2)
    expect(fetchTimes[1]! - fetchTimes[0]!).toBeGreaterThanOrEqual(100)
  })

  it('uses an injected pacer instead of the global clock', async () => {
    const before = vi.fn(async () => {})
    stubFetch(() => jsonResponse({ data: [] }))
    const client = createScholarClient({ minGapMs: 0, pacer: { before } })
    await client.request('GET', 'https://api.semanticscholar.org/graph/v1/paper/search', { query: 'x' })
    expect(before).toHaveBeenCalledTimes(1)
    expect(before).toHaveBeenCalledWith(5000) // anonymous gap, minGapMs 0 -> auto
  })
})

describe('searchBulk', () => {
  it('follows the token cursor until maxResults', async () => {
    const page1 = { data: [{ paperId: 'a', title: 'A' }, { paperId: 'b', title: 'B' }], total: 4, token: 'tok2' }
    const page2 = { data: [{ paperId: 'c', title: 'C' }, { paperId: 'd', title: 'D' }], total: 4 }
    stubFetch((url) => (url.includes('token=tok2') ? jsonResponse(page2) : jsonResponse(page1)))
    const client = createScholarClient({ minGapMs: 1 })
    const papers = await searchBulk(client, 'attention', { maxResults: 4 })
    expect(papers.map((p) => p.paperId)).toEqual(['a', 'b', 'c', 'd'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('searchBulkWithMeta', () => {
  it('returns the first page with the API total (single request, no cursor)', async () => {
    stubFetch(() => jsonResponse({
      data: [{ paperId: 'a', title: 'A', citationCount: 3 }, { paperId: 'b', title: 'B', citationCount: 1 }],
      total: 137,
      token: 'tok2',
    }))
    const client = createScholarClient({ minGapMs: 1 })
    const r = await searchBulkWithMeta(client, 'high-entropy alloys', {
      limit: 50,
      sort: 'citationCount:desc',
      filters: { year: '2023', minCitationCount: 5 },
    })
    expect(r.total).toBe(137)
    expect(r.papers).toHaveLength(2)
    const url = decodeURIComponent(String(fetchMock.mock.calls[0]![0]))
    expect(url).toContain('/paper/search/bulk')
    expect(url).toContain('limit=50')
    expect(url).toContain('sort=citationCount:desc')
    expect(url).toContain('year=2023')
    expect(url).toContain('minCitationCount=5')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to paper count when the API omits total', async () => {
    stubFetch(() => jsonResponse({ data: [{ paperId: 'a' }] }))
    const client = createScholarClient({ minGapMs: 1 })
    const r = await searchBulkWithMeta(client, 'x', { limit: 10 })
    expect(r.total).toBeUndefined()
    expect(r.papers).toEqual([{ paperId: 'a' }])
  })
})

describe('ScholarHttpError typed envelope', () => {
  it('tags upstream 429 as a retryable rate limit with retry_after_hours', () => {
    const err = new ScholarHttpError(429, 'Too Many Requests. Please wait and try again.')
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', retryable: true, retryAfterHours: 1 })
    expect(err.message).toContain('[rate_limited|retryable|retry_after_hours=1]')
    expect(err.message).toContain('Too Many Requests')
  })

  it('classifies 403 forbidden and 404 not_found as non-retryable', () => {
    expect(new ScholarHttpError(403, 'x')).toMatchObject({ code: 'forbidden', retryable: false })
    expect(new ScholarHttpError(404, 'x')).toMatchObject({ code: 'not_found', retryable: false })
  })

  it('classifies 5xx as retryable server_error and other 4xx as non-retryable api_error', () => {
    expect(new ScholarHttpError(504, 'x')).toMatchObject({ code: 'server_error', retryable: true })
    expect(new ScholarHttpError(500, 'x')).toMatchObject({ code: 'server_error', retryable: true })
    expect(new ScholarHttpError(422, 'x')).toMatchObject({ code: 'api_error', retryable: false })
  })

  it('classifies via the pure helper for arbitrary statuses', () => {
    expect(classifyScholarStatus(429)).toEqual({ code: 'rate_limited', retryable: true, retryAfterHours: 1 })
    expect(classifyScholarStatus(200)).toEqual({ code: 'http_error', retryable: false })
    expect(classifyScholarStatus(503)).toEqual({ code: 'server_error', retryable: true })
  })
})