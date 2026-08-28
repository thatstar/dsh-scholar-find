import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildFilename, downloadPdf, idemLoad, idemStore } from '../src/fetch/download.js'
import type { PaperMeta } from '../src/fetch/chain.js'

// Mock the browser-backed cloak module so no Chromium is launched in tests.
vi.mock('../src/fetch/cloak.js', () => ({ cloakFetchPdf: vi.fn() }))

const fetchMock = vi.fn()
let tmp: string

afterEach(async () => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
  if (tmp) await rm(tmp, { recursive: true, force: true })
})

function stubFetch(response: Response): void {
  fetchMock.mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
}

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 1, 2, 3])

describe('buildFilename', () => {
  it('builds the canonical author-year-title name with underscores and a ≤50-char title', () => {
    const meta: PaperMeta = { title: 'Highly accurate protein structure prediction with AlphaFold', year: 2021, author: 'John Jumper', journal: 'Nature' }
    const name = buildFilename(meta, 'x')
    const title = name.slice(0, -4).split('-').slice(2).join('-') // drop author-year + .pdf
    expect(name).toMatch(/^Jumper-2021-.+\.pdf$/) // surname, year, hyphenated
    expect(title.length).toBeLessThanOrEqual(50)
    expect(title).not.toContain(' ')
  })

  it('falls back to unknown author when metadata is missing', () => {
    const meta: PaperMeta = { title: 'A very long paper title that should be truncated to fifty characters exactly', year: 2024, author: '' }
    const name = buildFilename(meta, 'x')
    expect(name).toMatch(/^unknown-2024-A_very_long_paper_title_that_should_be_truncated_t\.pdf$/)
  })
})

describe('downloadPdf', () => {
  it('writes a valid PDF and validates the magic bytes', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'scholar-test-'))
    stubFetch(new Response(PDF_BYTES, { status: 200 }))
    const dest = join(tmp, 'a.pdf')
    const out = await downloadPdf('https://example.com/a.pdf', dest, { timeoutMs: 5000, maxBytes: 1024, checkDns: false })
    expect(out.ok).toBe(true)
    expect(await readFile(dest)).toEqual(Buffer.from(PDF_BYTES))
  })

  it('rejects an HTML landing page', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'scholar-test-'))
    stubFetch(new Response('<html>landing</html>', { status: 200 }))
    const out = await downloadPdf('https://example.com/a.pdf', join(tmp, 'a.pdf'), { timeoutMs: 5000, maxBytes: 1024, checkDns: false })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('download_not_a_pdf')
  })

  it('rejects oversized responses', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'scholar-test-'))
    stubFetch(new Response(PDF_BYTES, { status: 200 }))
    const out = await downloadPdf('https://example.com/a.pdf', join(tmp, 'a.pdf'), { timeoutMs: 5000, maxBytes: 5, checkDns: false })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('download_size_exceeded')
  })

  it('rejects unsafe hosts', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'scholar-test-'))
    const out = await downloadPdf('http://127.0.0.1:8000/x.pdf', join(tmp, 'a.pdf'), { timeoutMs: 5000, maxBytes: 1024, checkDns: false })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('download_host_not_allowed')
  })

  it('retries a transient 429 with backoff then succeeds', async () => {
    vi.useFakeTimers()
    tmp = await mkdtemp(join(tmpdir(), 'scholar-test-'))
    let calls = 0
    fetchMock.mockImplementation(() => {
      calls++
      return calls < 3 ? Promise.resolve(new Response('rate limited', { status: 429 })) : Promise.resolve(new Response(PDF_BYTES, { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const outPromise = downloadPdf('https://example.com/a.pdf', join(tmp, 'a.pdf'), { timeoutMs: 5000, maxBytes: 1024, checkDns: false })
    let out: Awaited<ReturnType<typeof downloadPdf>> | undefined
    const p = outPromise.then((r) => { out = r })
    await vi.advanceTimersByTimeAsync(12000)
    await p
    expect(out?.ok).toBe(true)
    expect(calls).toBe(3)
    vi.useRealTimers()
  })

  it('times out a stalled host instead of hanging past the configured timeout', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'scholar-test-'))
    // A host that never responds; the request must still resolve within
    // timeoutMs — the timeout now bounds connect+headers, not just the body read.
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const s = init?.signal
      if (!s) return
      if (s.aborted) {
        reject(s.reason ?? new Error('aborted'))
        return
      }
      s.addEventListener('abort', () => reject(s.reason ?? new Error('aborted')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const out = await downloadPdf('https://example.com/a.pdf', join(tmp, 'a.pdf'), { timeoutMs: 150, maxBytes: 1024, checkDns: false })
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('download_network_error')
    expect(out.detail).toContain('timeout after 150ms')
  })

  it('honors an abort signal mid-download', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'scholar-test-'))
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const s = init?.signal
      if (!s) return
      if (s.aborted) {
        reject(s.reason ?? new Error('aborted'))
        return
      }
      s.addEventListener('abort', () => reject(s.reason ?? new Error('aborted')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const ac = new AbortController()
    const p = downloadPdf('https://example.com/a.pdf', join(tmp, 'a.pdf'), { timeoutMs: 10_000, maxBytes: 1024, checkDns: false, signal: ac.signal })
    await Promise.resolve() // let the request attach its listener
    ac.abort(new Error('user cancel'))
    const out = await p
    expect(out.ok).toBe(false)
    expect(out.reason).toBe('download_network_error')
    expect(out.detail).toContain('user cancel')
  })
})

describe('idempotency sidecar', () => {
  it('round-trips the envelope', async () => {
    tmp = await mkdtemp(join(tmpdir(), 'scholar-test-'))
    const envelope = { ok: true, data: { summary: { total: 1, succeeded: 1, failed: 0 } } }
    await idemStore(tmp, 'weekly-review', envelope)
    expect(await idemLoad(tmp, 'weekly-review')).toEqual(envelope)
    expect(await idemLoad(tmp, 'other-key')).toBeUndefined()
  })
})

describe('downloadPdf cloak fallback', () => {
  it('falls back to CloakBrowser when a Cloudflare 403 blocks the direct fetch', async () => {
    const { cloakFetchPdf } = await import('../src/fetch/cloak.js')
    ;(cloakFetchPdf as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue({ ok: true, bytes: PDF_BYTES })
    // Direct route returns 403 every time; the cloak fallback supplies the PDF.
    fetchMock.mockResolvedValue(new Response('Just a moment', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    tmp = await mkdtemp(join(tmpdir(), 'scholar-test-'))
    const out = await downloadPdf('https://example.com/a.pdf', join(tmp, 'a.pdf'), { timeoutMs: 4000, maxBytes: 1024, checkDns: false, cloakEnabled: true })
    expect(out.ok).toBe(true)
    expect(cloakFetchPdf).toHaveBeenCalledWith('https://example.com/a.pdf', 4000, undefined)
  })

  it('does not use CloakBrowser unless the operator opted in', async () => {
    const { cloakFetchPdf } = await import('../src/fetch/cloak.js')
    ;(cloakFetchPdf as unknown as { mockClear: () => void }).mockClear()
    fetchMock.mockResolvedValue(new Response('Just a moment', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    tmp = await mkdtemp(join(tmpdir(), 'scholar-test-'))
    const out = await downloadPdf('https://example.com/a.pdf', join(tmp, 'a.pdf'), { timeoutMs: 4000, maxBytes: 1024, checkDns: false, cloakEnabled: false })
    expect(out.ok).toBe(false)
    expect(cloakFetchPdf).not.toHaveBeenCalled()
  })
})
