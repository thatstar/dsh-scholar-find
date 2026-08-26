import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildBoolQuery, createScholarClient, deduplicate, searchBulk } from '../src/s2/client.js'

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