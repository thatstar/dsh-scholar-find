/**
 * Downloading and library bookkeeping: deterministic filenames,
 * skip-existing, `%PDF` + size validation through the safety gate, and the
 * idempotency sidecar (`<out>/.paper-fetch-idem/<sha256>.json`).
 * @module dsh-scholar-find/fetch-download
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fetchWithRedirects, looksLikePdf, readBodyCapped } from './safety.js'
import type { PaperMeta } from './chain.js'

/** Deterministic filename: {first_author}_{year}_{journal_abbrev}_{title_slug}.pdf */
export function buildFilename(meta: PaperMeta, fallbackTitle: string): string {
  const author = slug((meta.author ?? 'unknown').split(/\s+/).pop() ?? 'unknown', 20)
  const year = String(meta.year ?? 'nd')
  const journal = journalAbbrev(meta.journal)
  const title = slug(meta.title ?? fallbackTitle, 40)
  return [author, year, ...(journal ? [journal] : []), title].join('_') + '.pdf'
}

const STOPWORDS = new Set(['the', 'of', 'and', 'for', 'in', 'on', 'a', 'an', 'to', '&'])

function slug(value: string, max: number): string {
  const s = value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max)
  return s || 'paper'
}

export function journalAbbrev(name: string | undefined, maxLen = 20): string {
  if (!name) return ''
  const words = name.split(/[^A-Za-z0-9]+/).filter((w) => w && !STOPWORDS.has(w.toLowerCase()))
  if (!words.length) return ''
  const abbrev = words.length >= 3
    ? words.map((w) => w[0]!.toUpperCase()).join('')
    : words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join('')
  return abbrev.slice(0, maxLen)
}

export interface DownloadOutcome {
  ok: boolean
  reason?: 'download_network_error' | 'download_not_a_pdf' | 'download_host_not_allowed' | 'download_size_exceeded' | 'download_io_error'
  detail?: string
  skipped?: boolean
}

export interface DownloadOptions {
  readonly timeoutMs: number
  readonly maxBytes: number
  readonly signal?: AbortSignal
  readonly checkDns?: boolean
}

/** Retry on transient 429 with exponential backoff (bioRxiv/publishers burst-throttle). */
const DOWNLOAD_RETRIES = 3

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Download `url` to `dest` with the full safety gate, retrying a transient 429
 * with backoff. Returns an outcome: `ok: false` means the caller may try the
 * next candidate source. The browser UA is applied by the shared transport.
 */
export async function downloadPdf(url: string, dest: string, opts: DownloadOptions): Promise<DownloadOutcome> {
  let lastStatus = 0
  for (let attempt = 0; attempt < DOWNLOAD_RETRIES; attempt++) {
    if (attempt > 0) await sleep(3000 * 2 ** (attempt - 1))
    let r: Response
    try {
      r = await fetchWithRedirects(url, { headers: { Accept: 'application/pdf,*/*;q=0.8' } }, { checkDns: opts.checkDns })
    } catch (e) {
      const code = (e as Error & { code?: string }).code
      if (code === 'host_not_allowed') return { ok: false, reason: 'download_host_not_allowed', detail: (e as Error).message }
      return { ok: false, reason: 'download_network_error', detail: (e as Error).message }
    }
    if (r.status === 429 && attempt < DOWNLOAD_RETRIES - 1) {
      lastStatus = r.status
      continue
    }
    if (!r.ok) return { ok: false, reason: 'download_network_error', detail: `HTTP ${r.status}` }
    const bytes = await readBodyCapped(r, opts.maxBytes, opts.signal)
    if (bytes === null) return { ok: false, reason: 'download_size_exceeded', detail: `response exceeds ${opts.maxBytes} bytes` }
    if (!looksLikePdf(bytes)) return { ok: false, reason: 'download_not_a_pdf', detail: 'response is not a PDF (HTML landing page?)' }
    try {
      await mkdir(dirname(dest), { recursive: true })
      await writeFile(dest, bytes)
    } catch (e) {
      return { ok: false, reason: 'download_io_error', detail: (e as Error).message }
    }
    return { ok: true }
  }
  return { ok: false, reason: 'download_network_error', detail: `HTTP ${lastStatus || 429}` }
}

// ---------------------------------------------------------------------------
// Idempotency sidecar
// ---------------------------------------------------------------------------

function idemPath(outDir: string, key: string): string {
  const safe = createHash('sha256').update(key).digest('hex')
  return join(outDir, '.paper-fetch-idem', `${safe}.json`)
}

export async function idemLoad(outDir: string, key: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(idemPath(outDir, key), 'utf8'))
  } catch {
    return undefined
  }
}

export async function idemStore(outDir: string, key: string, envelope: unknown): Promise<void> {
  try {
    await mkdir(dirname(idemPath(outDir, key)), { recursive: true })
    await writeFile(idemPath(outDir, key), JSON.stringify(envelope, null, 2), 'utf8')
  } catch {
    // best-effort only
  }
}

/** Resolve the output directory: absolute as-is, relative against `base`. */
export function resolveOutDir(pdfOutputDir: string, base: string): string {
  return resolve(base, pdfOutputDir)
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}