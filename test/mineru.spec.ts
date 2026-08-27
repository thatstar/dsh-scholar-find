import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mineruParseUrl, mineruParseFile, MINERU_MAX_BYTES } from '../src/mineru/client.js'

const fetchMock = vi.fn()
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('mineruParseUrl', () => {
  it('submits a URL task and returns the polled markdown', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === 'https://mineru.net/api/v1/agent/parse/url') return jsonResponse({ code: 0, data: { task_id: 't1', state: 'pending' } })
      if (url === 'https://mineru.net/api/v1/agent/parse/t1') return jsonResponse({ code: 0, data: { task_id: 't1', state: 'done', markdown_url: 'https://cdn-mineru.example/full.md' } })
      if (url === 'https://cdn-mineru.example/full.md') return new Response('# Hello\n\nbody text', { status: 200, headers: { 'Content-Type': 'text/markdown' } })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { markdown } = await mineruParseUrl('https://example.com/a.pdf', { timeoutMs: 10000 })
    expect(markdown).toContain('# Hello')
  })

  it('throws a parse error when the task fails', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url === 'https://mineru.net/api/v1/agent/parse/url') return jsonResponse({ code: 0, data: { task_id: 't3' } })
      if (url === 'https://mineru.net/api/v1/agent/parse/t3') return jsonResponse({ code: 0, data: { state: 'failed', err_msg: 'file page count exceeds lightweight API limit', err_code: -30003 } })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(mineruParseUrl('https://example.com/a.pdf', { timeoutMs: 5000 })).rejects.toThrow(/page count exceeds/)
  })

  it('throws when the API envelope reports a non-zero code', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ code: 401, msg: 'rate limited', data: {} }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(mineruParseUrl('https://example.com/a.pdf', { timeoutMs: 5000 })).rejects.toThrow(/rate limited/)
  })
})

describe('mineruParseFile', () => {
  it('submits (signature upload), PUTs the file, then returns the markdown', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mineru-'))
    const pdf = join(tmp, 'doc.pdf')
    writeFileSync(pdf, '%PDF-1.4\n')
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === 'https://mineru.net/api/v1/agent/parse/file') return jsonResponse({ code: 0, data: { task_id: 't2', state: 'waiting-file', file_url: 'https://oss.example/upload' } })
      if (url === 'https://oss.example/upload') { expect(init?.method).toBe('PUT'); return new Response('', { status: 200 }) }
      if (url === 'https://mineru.net/api/v1/agent/parse/t2') return jsonResponse({ code: 0, data: { task_id: 't2', state: 'done', markdown_url: 'https://cdn.example/full.md' } })
      if (url === 'https://cdn.example/full.md') return new Response('parsed markdown', { status: 200 })
      throw new Error(`unexpected ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { markdown } = await mineruParseFile(pdf, { timeoutMs: 10000 })
    expect(markdown).toContain('parsed markdown')
  })

  it('rejects files over the 10 MB lightweight limit', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'mineru-'))
    const pdf = join(tmp, 'big.pdf')
    writeFileSync(pdf, Buffer.alloc(MINERU_MAX_BYTES + 1))
    await expect(mineruParseFile(pdf, { timeoutMs: 5000 })).rejects.toThrow(/10 MB/)
  })
})
