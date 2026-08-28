/**
 * Orchestration for the paper_fetch tools: resolve-only, single download, and
 * batch with idempotency. Produces the stable JSON envelopes the tools return.
 * @module dsh-scholar-find/fetch-service
 */

import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import type { ScholarClient } from '../s2/client.js'
import { maxBytesOf, timeoutMsOf, type ScholarSettings } from '../settings.js'
import { arxivPdfUrl, resolveChain, resolveTitle, type ChainContext } from './chain.js'
import { buildFilename, downloadPdf, fileExists, idemLoad, idemStore, resolveOutDir } from './download.js'
import { codeOf, makeError, type EnvelopeError, type FetchItemResult } from './envelope.js'
import { isSafeUrl } from './safety.js'
import { resolveProxyUrl } from './transport.js'

export interface WebSearchHit {
  url: string
  title?: string
  snippet?: string
}

export interface FetchRuntime {
  readonly settings: ScholarSettings
  readonly s2: ScholarClient
  readonly baseDir: string
  readonly signal?: AbortSignal
  /** Optional DSH web search (`ctx.web.search`); unset disables the last-resort
   * title-search fallback. */
  readonly searchWeb?: (query: string, maxResults: number, signal?: AbortSignal) => Promise<WebSearchHit[]>
}

/** Last-resort web-search results to consider. */
const WEB_SEARCH_MAX_RESULTS = 10
/** How many candidate URLs the web fallback actually tries to download. */
const WEB_FALLBACK_MAX_TRIES = 5

/** Strip common DOI URL prefixes so users can paste bare links. */
export function normalizeDoi(doi: string): string {
  let out = doi.trim()
  for (const prefix of ['https://doi.org/', 'http://doi.org/', 'https://dx.doi.org/', 'http://dx.doi.org/', 'doi.org/', 'dx.doi.org/', 'doi:']) {
    if (out.startsWith(prefix)) {
      out = out.slice(prefix.length)
      break
    }
  }
  return out
}

const DOI_PATTERN = /^10\..+\/.+$/

export function isValidDoi(doi: string): boolean {
  return DOI_PATTERN.test(doi)
}

function chainContext(rt: FetchRuntime, doi: string): ChainContext {
  return {
    doi,
    email: rt.settings.unpaywallEmail.trim(),
    s2: rt.s2,
    timeoutMs: timeoutMsOf(rt.settings.fetchTimeoutSec),
    signal: rt.signal,
  }
}

// ---------------------------------------------------------------------------
// FetchItemResult builders — every branch of resolveOne/fetchOne goes through
// these so the envelope shape (and one-off fields like `skipped`) is defined in
// exactly one place.
// ---------------------------------------------------------------------------

type ResultSeed = {
  success: boolean
  source: string | null
  pdfUrl: string | null
  file: string | null
  meta: Record<string, unknown>
  sourcesTried: readonly string[]
  skipped?: boolean
  skipReason?: string
  error?: EnvelopeError
}

function item(doi: string, seed: ResultSeed): FetchItemResult {
  return { doi, ...seed }
}

function validationFailure(doi: string, explainExpected: boolean): FetchItemResult {
  return item(doi, {
    success: false,
    source: null,
    pdfUrl: null,
    file: null,
    meta: {},
    sourcesTried: [],
    error: makeError('validation_error', explainExpected ? `Not a valid DOI: ${doi} (expected 10.xxxx/xxxx)` : `Not a valid DOI: ${doi}`),
  })
}

function resolveFailure(doi: string, e: unknown): FetchItemResult {
  return item(doi, {
    success: false,
    source: null,
    pdfUrl: null,
    file: null,
    meta: {},
    sourcesTried: ['resolve_error'],
    error: makeError('resolve_network_error', `Metadata resolvers failed: ${(e as Error).message}`),
  })
}

function notFound(doi: string, meta: Record<string, unknown>, sourcesTried: readonly string[]): FetchItemResult {
  return item(doi, {
    success: false,
    source: null,
    pdfUrl: null,
    file: null,
    meta,
    sourcesTried,
    error: makeError('not_found', 'No open-access PDF found', 'OA availability changes over time; retry after embargo lifts or a preprint appears'),
  })
}

function webSearchSuccess(doi: string, href: string, file: string | null, meta: Record<string, unknown>, sourcesTried: readonly string[]): FetchItemResult {
  return item(doi, {
    success: true,
    source: 'web_search',
    pdfUrl: href,
    file,
    meta,
    sourcesTried,
  })
}

function candidateSuccess(doi: string, source: string | null, pdfUrl: string | null, file: string | null, meta: Record<string, unknown>, sourcesTried: readonly string[], skip?: { skipReason: string }): FetchItemResult {
  return item(doi, {
    success: true,
    source,
    pdfUrl,
    file,
    meta,
    sourcesTried,
    ...(skip ? { skipped: true, skipReason: skip.skipReason } : {}),
  })
}

function downloadFailure(doi: string, source: string, reason: string, detail: string | undefined, meta: Record<string, unknown>, sourcesTried: readonly string[]): FetchItemResult {
  return item(doi, {
    success: false,
    source,
    pdfUrl: null,
    file: null,
    meta,
    sourcesTried,
    error: makeError(codeOf(reason), `Download failed from ${source}: ${reason}${detail ? ` (${detail})` : ''}`),
  })
}

/** Guarded/unreachable failure (e.g. no candidate could be downloaded): same
 * envelope shape via a builder so it cannot drift from the others. */
function genericFailure(doi: string, meta: Record<string, unknown>, sourcesTried: readonly string[], message: string, reason?: string): FetchItemResult {
  return item(doi, {
    success: false,
    source: null,
    pdfUrl: null,
    file: null,
    meta,
    sourcesTried,
    error: makeError('not_found', message, reason),
  })
}

/** Candidate PDF URLs from a title web-search: direct `.pdf` links + arXiv `abs` → `pdf`. */
function webCandidateUrls(hits: readonly WebSearchHit[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  const push = (u: string): void => {
    const x = u.trim()
    if (x && !seen.has(x)) {
      seen.add(x)
      out.push(x)
    }
  }
  for (const hit of hits) {
    const u = hit.url
    if (!u) continue
    if (/\.pdf(?:\?.*)?$/i.test(u)) push(u)
    const arx = u.match(/arxiv\.org\/abs\/([^/?#]+)/)
    const arxId = arx?.[1]
    if (arxId) push(arxivPdfUrl(arxId))
  }
  return out
}

/** Search the paper title for candidate free-PDF URLs (no download). Empty on
 * no title / no web capability / search error. */
async function webCandidates(rt: FetchRuntime, meta: { title?: string }): Promise<string[]> {
  if (!rt.searchWeb || !meta.title) return []
  let hits: WebSearchHit[]
  try {
    hits = await rt.searchWeb(`${meta.title} pdf`, WEB_SEARCH_MAX_RESULTS, rt.signal)
  } catch {
    return [] // web capability unavailable — skip the fallback
  }
  return webCandidateUrls(hits)
}

/** Last-resort fallback: web-search the title for a free PDF and try to fetch it
 * (direct -> CloakBrowser -> fail). Returns the winning URL or nothing. */
async function tryWebSearch(
  rt: FetchRuntime,
  meta: { title?: string },
  dest: string,
  opts: DownloadOptions,
): Promise<{ href: string; source: string } | undefined> {
  const urls = (await webCandidates(rt, meta)).slice(0, WEB_FALLBACK_MAX_TRIES)
  for (const href of urls) {
    const gate = isSafeUrl(href)
    if (!gate.ok) continue
    const outcome = await downloadPdf(href, dest, {
      timeoutMs: timeoutMsOf(rt.settings.fetchTimeoutSec),
      maxBytes: maxBytesOf(rt.settings.maxPdfSizeMb),
      signal: rt.signal,
      checkDns: opts.checkDns,
      cloakEnabled: rt.settings.cloakEnabled,
      proxyUrl: resolveProxyUrl(rt.settings.proxyUrl),
    })
    if (outcome.ok) return { href, source: 'web_search' }
  }
  return undefined
}

/** Resolve one DOI to candidates (no download). */
export async function resolveOne(rt: FetchRuntime, doi: string): Promise<FetchItemResult> {
  const normalized = normalizeDoi(doi)
  if (!isValidDoi(normalized)) return validationFailure(normalized, true)
  let chain
  try {
    chain = await resolveChain(chainContext(rt, normalized))
  } catch (e) {
    return resolveFailure(normalized, e)
  }
  const meta = { ...chain.meta }
  const tried = chain.sourcesTried
  if (!chain.candidates.length) {
    // Last-resort automatic fallback: web-search the title and report the first
    // likely free-PDF URL (no download). Only then report a clean not_found.
    const webUrl = (await webCandidates(rt, chain.meta))[0]
    if (webUrl) return webSearchSuccess(normalized, webUrl, null, meta, [...tried, 'web_search'])
    return notFound(normalized, meta, tried)
  }
  const first = chain.candidates[0]!
  return candidateSuccess(normalized, first.source, first.pdfUrl, null, meta, tried)
}

export interface DownloadOptions {
  overwrite?: boolean
  checkDns?: boolean
}

/** Resolve then download; tries every candidate until one validates. */
export async function fetchOne(rt: FetchRuntime, doi: string, opts: DownloadOptions = {}): Promise<FetchItemResult> {
  const normalized = normalizeDoi(doi)
  if (!isValidDoi(normalized)) return validationFailure(normalized, false)
  let chain
  try {
    chain = await resolveChain(chainContext(rt, normalized))
  } catch (e) {
    return resolveFailure(normalized, e)
  }

  const outDir = resolveOutDir(rt.settings.pdfOutputDir, rt.baseDir)

  const fname = buildFilename(chain.meta, normalized)
  const dest = join(outDir, fname)
  const meta = { ...chain.meta }
  const tried = chain.sourcesTried

  // No candidate source yielded a PDF URL. Last-resort automatic fallback: web-
  // search the title for a free PDF; only then report a clean not_found.
  if (!chain.candidates.length) {
    const hit = await tryWebSearch(rt, chain.meta, dest, opts)
    if (hit) return webSearchSuccess(normalized, hit.href, dest, meta, [...tried, 'web_search'])
    return notFound(normalized, meta, tried)
  }

  const exists = await fileExists(dest)
  if (exists && !opts.overwrite) {
    const first = chain.candidates[0]!
    return candidateSuccess(normalized, first.source, first.pdfUrl, dest, meta, tried, { skipReason: 'file_exists' })
  }

  const failures: Array<{ source: string; reason: string; detail?: string }> = []
  for (const cand of chain.candidates) {
    const gate = isSafeUrl(cand.pdfUrl)
    if (!gate.ok) {
      failures.push({ source: cand.source, reason: 'download_host_not_allowed', detail: gate.reason })
      continue
    }
    const outcome = await downloadPdf(cand.pdfUrl, dest, {
      timeoutMs: timeoutMsOf(rt.settings.fetchTimeoutSec),
      maxBytes: maxBytesOf(rt.settings.maxPdfSizeMb),
      signal: rt.signal,
      checkDns: opts.checkDns,
      cloakEnabled: rt.settings.cloakEnabled,
      proxyUrl: resolveProxyUrl(rt.settings.proxyUrl),
    })
    if (outcome.ok) return candidateSuccess(normalized, cand.source, cand.pdfUrl, dest, meta, tried)
    failures.push({ source: cand.source, reason: outcome.reason ?? 'download_network_error', detail: outcome.detail })
  }

  // Last-resort automatic fallback: if every OA candidate's download failed,
  // web-search the title for a free PDF.
  const hit = await tryWebSearch(rt, chain.meta, dest, opts)
  if (hit) return webSearchSuccess(normalized, hit.href, dest, meta, [...tried, 'web_search'])

  if (failures.length === 0) {
    // Defensive: should be unreachable (candidates was non-empty above), but
    // never index an empty list.
    return genericFailure(normalized, meta, tried, 'No candidate could be downloaded', 'All resolved URLs were unusable')
  }

  const last = failures[failures.length - 1]!
  return downloadFailure(normalized, last.source, last.reason, last.detail, meta, tried)
}

/** Batch fetch with per-item results, summary, and retry hints. */
export async function fetchBatch(rt: FetchRuntime, dois: readonly string[], opts: DownloadOptions & { idempotencyKey?: string } = {}): Promise<unknown> {
  const outDir = resolveOutDir(rt.settings.pdfOutputDir, rt.baseDir)

  if (opts.idempotencyKey) {
    const cached = await idemLoad(outDir, opts.idempotencyKey)
    if (cached !== undefined) return cached
  }

  const results: FetchItemResult[] = []
  for (const doi of dois) {
    results.push(await fetchOne(rt, doi, opts))
  }

  const succeeded = results.filter((r) => r.success).length
  const ok: boolean | 'partial' = succeeded === results.length ? true : succeeded === 0 ? false : 'partial'
  const failed = results.filter((r) => !r.success)
  // Model-actionable retry hint: there is NO `paper-fetch` CLI — the retry path
  // is the `paper_fetch_batch` DSH tool (or paper_fetch_download for one DOI).
  // A fresh idempotencyKey (or overwrite: true) is needed to actually re-download;
  // reusing the batch's key would replay the cached (failed) envelope.
  const next = failed.length
    ? [`Retry with paper_fetch_batch (dois: ${failed.map((r) => r.doi).join(', ')}; use a new idempotencyKey or overwrite to re-download)`]
    : []

  const envelope = {
    ok,
    data: {
      results,
      summary: { total: results.length, succeeded, failed: failed.length },
      next,
    },
    meta: {
      requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
      sourcesTried: [...new Set(results.flatMap((r) => r.sourcesTried))].sort(),
      unpaywallSkipped: !rt.settings.unpaywallEmail.trim(),
      schemaVersion: '0.1.0',
    },
  }

  if (opts.idempotencyKey) await idemStore(outDir, opts.idempotencyKey, envelope)
  return envelope
}

/** List PDFs already in the library directory. */
export async function listLibrary(rt: FetchRuntime): Promise<Array<{ file: string; path: string }>> {
  const outDir = resolveOutDir(rt.settings.pdfOutputDir, rt.baseDir)
  let entries: string[]
  try {
    entries = await readdir(outDir)
  } catch {
    return []
  }
  return entries
    .filter((f) => f.endsWith('.pdf'))
    .sort()
    .map((file) => ({ file, path: join(outDir, file) }))
}

/** Resolve a title to a DOI (Crossref first, S2 fallback). */
export async function resolveTitleToDoi(rt: FetchRuntime, title: string): Promise<{ doi: string | undefined; resolution: any }> {
  const { doi, resolution } = await resolveTitle(title, { email: rt.settings.unpaywallEmail.trim(), s2: rt.s2, timeoutMs: timeoutMsOf(rt.settings.fetchTimeoutSec), signal: rt.signal })
  return { doi, resolution }
}
