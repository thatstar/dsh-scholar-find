import { afterEach, describe, expect, it, vi } from 'vitest'
import { astaSnippetSearch, ASTA_ENDPOINT, type AstaSnippet } from '../src/asta/client.js'

const fetchMock = vi.fn()
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function sseResponse(payload: unknown): Response {
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function rpcResult(result: unknown): object {
  return { jsonrpc: '2.0', id: 1, result }
}

function snippet(overrides: Partial<AstaSnippet> = {}): AstaSnippet {
  return {
    score: 1.5,
    paper: { corpusId: '999', title: 'A Paper', authors: ['A. Author'], openAccessInfo: { license: 'CCBY', status: 'GOLD' } },
    snippet: { text: 'The full ~500 word content body text.', snippetKind: 'body', section: 'Introduction' },
    ...overrides,
  }
}

describe('astaSnippetSearch', () => {
  it('sends a JSON-RPC tools/call to the Asta endpoint with x-api-key and parses structuredContent', async () => {
    const data = [snippet()]
    fetchMock.mockResolvedValue(sseResponse(rpcResult({
      content: [{ type: 'text', text: JSON.stringify({ data }) }],
      structuredContent: { result: { data } },
      isError: false,
    })))
    vi.stubGlobal('fetch', fetchMock)
    const result = await astaSnippetSearch('ak-test', { query: 'self-paced learning', paper_ids: 'CorpusId:999', limit: 1 })
    expect(result).toHaveLength(1)
    expect(result[0]!.paper!.title).toBe('A Paper')
    expect(result[0]!.snippet!.text).toContain('500 word content')
    // Verify the request shape.
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(fetchMock.mock.calls[0]![0]).toBe(ASTA_ENDPOINT)
    expect(headers['x-api-key']).toBe('ak-test')
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse(String(init.body))
    expect(body.method).toBe('tools/call')
    expect(body.params.name).toBe('snippet_search')
    expect(body.params.arguments.paper_ids).toBe('CorpusId:999')
  })

  it('falls back to parsing content[0].text when structuredContent is absent', async () => {
    const data = [snippet()] as unknown
    fetchMock.mockResolvedValue(sseResponse(rpcResult({
      content: [{ type: 'text', text: JSON.stringify({ data }) }],
      isError: false,
    })))
    vi.stubGlobal('fetch', fetchMock)
    const result = await astaSnippetSearch('ak-test', { query: 'q' })
    expect(result[0]!.paper!.title).toBe('A Paper')
  })

  it('throws on an MCP error payload', async () => {
    fetchMock.mockResolvedValue(sseResponse({ jsonrpc: '2.0', id: 1, error: { code: -32000, message: 'rate limited' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(astaSnippetSearch('ak-test', { query: 'q' })).rejects.toThrow(/rate limited/)
  })

  it('skips a method notification that precedes the real result', async () => {
    const data = [snippet()]
    const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n\ndata: ${JSON.stringify(rpcResult({ content: [{ type: 'text', text: JSON.stringify({ data }) }], isError: false }))}\n\n`
    fetchMock.mockResolvedValue(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await astaSnippetSearch('ak-test', { query: 'q' })
    expect(result).toHaveLength(1)
    expect(result[0]!.paper!.title).toBe('A Paper')
  })
})
