import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildFilename, downloadPdf, idemLoad, idemStore, journalAbbrev } from '../src/fetch/download.js'
import type { PaperMeta } from '../src/fetch/chain.js'

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
  it('builds the deterministic author_year_journal_title name', () => {
    const meta: PaperMeta = { title: 'Highly accurate protein structure prediction', year: 2021, author: 'Jumper', journal: 'Nature' }
    expect(buildFilename(meta, 'x')).toBe('Jumper_2021_Nature_Highly_accurate_protein_structure_predic.pdf')
  })

  it('abbreviates long journal names', () => {
    expect(journalAbbrev('Proceedings of the National Academy of Sciences')).toBe('PNAS')
    expect(journalAbbrev('Journal of the American Chemical Society')).toBe('JACS')
    expect(journalAbbrev('Neural Computation')).toBe('NeuralComputation')
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