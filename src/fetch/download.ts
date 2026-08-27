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
import { cloakFetchPdf } from './cloak.js'
import type { PaperMeta } from './chain.js'

/** Max length for the title portion of the canonical filename. */
const TITLE_MAX_LEN = 50

/** Deterministic canonical filename: {first author}-{year}-{title(≤50, spaces→_)}.pdf */
export function buildFilename(meta: PaperMeta, fallbackTitle: string): string {
  // First author's surname; blank/whitespace author falls back to 'unknown'.
  const author = slug(meta.author?.trim() ? meta.author.trim().split(/\s+/).pop()! : 'unknown', 20)
  const year = String(meta.year ?? 'nd')
  // Slug the title into underscore-separated tokens, then cap the length and
  // drop any trailing underscore left by the cut so it reads cleanly.
  const title = slug(meta.title ?? fallbackTitle, TITLE_MAX_LEN).replace(/_+$/, '') || 'paper'
  return [author, year, title].filter(Boolean).join('-') + '.pdf'
}

function slug(value: string, max: number): string {
  const s = value.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, max)
  return s || 'paper'
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
  /** Operator-opted-in CloakBrowser fallback for Cloudflare/WAF-blocked PDFs. */
  readonly cloakEnabled?: boolean
  /** Proxy URL for the CloakBrowser (e.g. `http://127.0.0.1:10808`); unset = direct. */
  readonly proxyUrl?: string
}

/** Retry on transient 429 with exponential backoff (bioRxiv/publishers burst-throttle). */
const DOWNLOAD_RETRIES = 3
/** Base delay for the 429 backoff; each retry doubles it (3 s, 6 s, 12 s…). */
const RETRY_BACKOFF_BASE_MS = 3000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function writePdf(dest: string, bytes: Uint8Array): Promise<DownloadOutcome> {
  try {
    await mkdir(dirname(dest), { recursive: true })
    await writeFile(dest, bytes)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: 'download_io_error', detail: (e as Error).message }
  }
}

/**
 * Download `url` to `dest` with the full safety gate, retrying a transient 429
 * with backoff. When the operator has opted in (`cloakEnabled`) and the direct
 * route is Cloudflare/WAF-blocked (403/429 or a non-PDF interstitial), fall back
 * to a CloakBrowser in-page fetch. Returns an outcome: `ok: false` means the
 * caller may try the next candidate source.
 */
export async function downloadPdf(url: string, dest: string, opts: DownloadOptions): Promise<DownloadOutcome> {
  let lastStatus = 0
  let outcome: DownloadOutcome | undefined
  for (let attempt = 0; attempt < DOWNLOAD_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RETRY_BACKOFF_BASE_MS * 2 ** (attempt - 1))
    let r: Response
    try {
      r = await fetchWithRedirects(url, { headers: { Accept: 'application/pdf,*/*;q=0.8' } }, { checkDns: opts.checkDns })
    } catch (e) {
      const code = (e as Error & { code?: string }).code
      if (code === 'host_not_allowed') return { ok: false, reason: 'download_host_not_allowed', detail: (e as Error).message }
      // Transport error — not a Cloudflare block; cloak won't help.
      return { ok: false, reason: 'download_network_error', detail: (e as Error).message }
    }
    // Transient rate-limit: retry with backoff.
    if (r.status === 429 && attempt < DOWNLOAD_RETRIES - 1) {
      lastStatus = r.status
      continue
    }
    if (!r.ok) {
      lastStatus = r.status
      outcome = { ok: false, reason: 'download_network_error', detail: `HTTP ${r.status}` }
      break // blocked (e.g. 403 Cloudflare) — go to cloak fallback, no more retries
    }
    const bytes = await readBodyCapped(r, opts.maxBytes, opts.signal)
    if (bytes === null) {
      outcome = { ok: false, reason: 'download_size_exceeded', detail: `response exceeds ${opts.maxBytes} bytes` }
      break
    }
    if (looksLikePdf(bytes)) return writePdf(dest, bytes)
    // Non-PDF (HTML interstitial / landing) — cloak fallback below.
    outcome = { ok: false, reason: 'download_not_a_pdf', detail: 'response is not a PDF (HTML landing page?)' }
    break
  }

  // Operator-opted-in CloakBrowser fallback for Cloudflare/WAF-gated PDFs.
  if (opts.cloakEnabled) {
    const cloak = await cloakFetchPdf(url, opts.timeoutMs, opts.proxyUrl)
    if (cloak.ok && cloak.bytes) {
      if (!looksLikePdf(cloak.bytes)) return { ok: false, reason: 'download_not_a_pdf', detail: 'cloak returned non-PDF' }
      if (cloak.bytes.length > opts.maxBytes) return { ok: false, reason: 'download_size_exceeded', detail: `cloak response exceeds ${opts.maxBytes} bytes` }
      return writePdf(dest, cloak.bytes)
    }
    // Direct fetch and CloakBrowser both failed — report clearly that no PDF
    // could be obtained.
    return { ok: false, reason: 'download_network_error', detail: `no PDF fetched (direct & CloakBrowser both failed): ${cloak.detail ?? 'unknown'}` }
  }

  return outcome ?? { ok: false, reason: 'download_network_error', detail: `HTTP ${lastStatus || 429}` }
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