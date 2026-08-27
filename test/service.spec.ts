import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScholarClient } from '../src/s2/client.js'
import { fetchOne, type FetchRuntime } from '../src/fetch/service.js'
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
    scihubEnabled: false,
    institutionalEnabled: false,
    cloakEnabled: false,
    scihubMirrors: '',
    pdfOutputDir: 'scholar-pdfs',
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
    expect(result.file).toMatch(/Jumper_2021_.*\.pdf$/)
  })
})