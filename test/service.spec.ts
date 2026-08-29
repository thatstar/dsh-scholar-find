import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScholarClient } from '../src/s2/client.js'
import { fetchOne, resolveOne, type FetchRuntime } from '../src/fetch/service.js'
import { codeOf } from '../src/fetch/envelope.js'
import { ScholarSettings } from '../src/settings.js'

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

function defaults(): ScholarSettings {
  return {
    unpaywallEmail: '',
    s2ApiKeyRef: '',
    cloakEnabled: false,
    proxyUrl: '',
    defaultOutputDir: '.scholar',
    maxResultsPerSearch: 20,
    fetchTimeoutSec: 30,
    maxPdfSizeMb: 50,
    s2RequestGapMs: 0,
  }
}

function runtime(overrides: Partial<ScholarSettings> = {}): FetchRuntime {
  const s2 = createScholarClient({ minGapMs: 1 })
  return { settings: { ...defaults(), ...overrides }, s2, baseDir: '/tmp/session-workspace', signal: undefined }
}

describe('fetchOne', () => {
  it('returns a clean not_found (never crashes) when no source yields a PDF URL', async () => {
    stubFetch((url) => {
      // email unset -> unpaywall not called; S2 by-DOI returns not found.
      if (url.startsWith('https://api.semanticscholar.org/')) {
        return jsonResponse({ error: 'not found' }, 404)
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    const result = await fetchOne(runtime(), '10.1007/s11263-022-01611-x')
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('not_found')
    expect(Array.isArray(result.sourcesTried)).toBe(true)
    // The empty-candidates guard must catch this, not an index-crash on `reason`.
    expect((result.error as any)?.message).toContain('open-access')
  })

  it('downloads from a resolved candidate (Unpaywall hit)', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 1, 2])
    stubFetch((url) => {
      if (url.startsWith('https://api.unpaywall.org/')) {
        return jsonResponse({ title: 'A paper', year: 2021, journal_name: 'Nature', z_authors: [{ family: 'Jumper' }], best_oa_location: { url_for_pdf: 'https://example.com/a.pdf' } })
      }
      if (url.startsWith('https://api.semanticscholar.org/')) {
        return jsonResponse({ error: 'not found' }, 404)
      }
      if (url === 'https://example.com/a.pdf') {
        return new Response(pdf, { status: 200 })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    const result = await fetchOne(runtime({ unpaywallEmail: 'you@example.com' }), '10.1038/s41586-021-03819-2')
    expect(result.success).toBe(true)
    expect(result.source).toBe('unpaywall')
    expect(result.file).toMatch(/Jumper-2021-A_paper\.pdf$/)
  })
})
describe('fetchOne web-search fallback', () => {
  it('searches the title and downloads a free PDF after the OA source fails', async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 1, 2])
    stubFetch((url) => {
      if (url.startsWith('https://api.unpaywall.org/')) {
        return jsonResponse({ title: 'Self-Paced Learning for Latent Variable Models', year: 2010, journal_name: 'NIPS', z_authors: [{ family: 'Kumar' }], best_oa_location: { url_for_pdf: 'https://example.com/blocked.pdf' } })
      }
      if (url.startsWith('https://api.semanticscholar.org/')) return jsonResponse({ error: 'not found' }, 404)
      if (url === 'https://example.com/blocked.pdf') return new Response('Just a moment', { status: 403 })
      if (url === 'https://example.com/found.pdf') return new Response(pdf, { status: 200 })
      throw new Error(`unexpected fetch ${url}`)
    })
    const searchWeb = vi.fn(async (q: string) => [{ url: 'https://example.com/found.pdf' }])
    const result = await fetchOne({ ...runtime({ unpaywallEmail: 'you@example.com' }), searchWeb } as FetchRuntime, '10.1007/s11263-022-01611-x')
    expect(result.success).toBe(true)
    expect(result.source).toBe('web_search')
    expect(result.pdfUrl).toBe('https://example.com/found.pdf')
    expect(searchWeb).toHaveBeenCalledWith('Self-Paced Learning for Latent Variable Models pdf', 10, undefined)
    expect(result.sourcesTried).toContain('web_search')
  })

  it('does not use the web fallback when no title is known', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://api.semanticscholar.org/')) return jsonResponse({ error: 'not found' }, 404)
      throw new Error(`unexpected fetch ${url}`)
    })
    const searchWeb = vi.fn(async () => [{ url: 'https://example.com/found.pdf' }])
    const result = await fetchOne({ ...runtime(), searchWeb } as FetchRuntime, '10.1007/s11263-022-01611-x')
    expect(result.success).toBe(false)
    expect(result.error?.code).toBe('not_found')
    expect(searchWeb).not.toHaveBeenCalled()
  })
})

describe('resolveOne web-search fallback', () => {
  it('reports a free PDF URL found by title web-search (no download)', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://api.unpaywall.org/')) {
        return jsonResponse({ title: 'Self-Paced Learning for Latent Variable Models', year: 2010, journal_name: 'NIPS', z_authors: [{ family: 'Kumar' }], best_oa_location: null, oa_locations: [] })
      }
      if (url.startsWith('https://api.semanticscholar.org/')) return jsonResponse({ error: 'not found' }, 404)
      throw new Error(`unexpected fetch ${url}`)
    })
    const searchWeb = vi.fn(async () => [{ url: 'http://example.com/paper.pdf' }])
    const result = await resolveOne({ ...runtime({ unpaywallEmail: 'you@example.com' }), searchWeb } as FetchRuntime, '10.1007/s11263-022-01611-x')
    expect(result.success).toBe(true)
    expect(result.source).toBe('web_search')
    expect(result.pdfUrl).toBe('http://example.com/paper.pdf')
    expect(result.file).toBeNull()
    expect(searchWeb).toHaveBeenCalledWith('Self-Paced Learning for Latent Variable Models pdf', 10, undefined)
    expect(result.sourcesTried).toContain('web_search')
  })
})

describe('codeOf', () => {
  it('maps download reasons to the envelope error code, falling back to network error', () => {
    expect(codeOf('download_not_a_pdf')).toBe('download_not_a_pdf')
    expect(codeOf('download_host_not_allowed')).toBe('download_host_not_allowed')
    expect(codeOf('download_size_exceeded')).toBe('download_size_exceeded')
    expect(codeOf('download_io_error')).toBe('download_io_error')
    expect(codeOf('download_network_error')).toBe('download_network_error')
    expect(codeOf('unknown_reason')).toBe('download_network_error')
  })
})
