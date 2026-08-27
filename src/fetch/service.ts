/**
 * Orchestration for the paper_fetch tools: resolve-only, single download, and
 * batch with idempotency. Produces the stable JSON envelopes the tools return.
 * @module dsh-scholar-find/fetch-service
 */

import { join } from 'node:path'
import { readdir } from 'node:fs/promises'
import type { ScholarClient } from '../s2/client.js'
import type { ScholarSettings } from '../settings.js'
import { resolveChain, resolveTitle, type ChainContext, type SourceResolution } from './chain.js'
import { buildFilename, downloadPdf, fileExists, idemLoad, idemStore, resolveOutDir } from './download.js'
import { makeError, type EnvelopeError, type FetchItemResult } from './envelope.js'
import { isSafeUrl } from './safety.js'

export interface FetchRuntime {
  readonly settings: ScholarSettings
  readonly s2: ScholarClient
  readonly baseDir: string
  readonly signal?: AbortSignal
}

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
    institutional: rt.settings.institutionalEnabled,
    scihubEnabled: rt.settings.scihubEnabled,
    scihubMirrors: rt.settings.scihubMirrors,
    timeoutMs: rt.settings.fetchTimeoutSec * 1000,
    signal: rt.signal,
  }
}

/** Resolve one DOI to candidates (no download). */
export async function resolveOne(rt: FetchRuntime, doi: string): Promise<FetchItemResult> {
  const normalized = normalizeDoi(doi)
  if (!isValidDoi(normalized)) {
    return {
      doi: normalized,
      success: false,
      source: null,
      pdfUrl: null,
      file: null,
      meta: {},
      sourcesTried: [],
      error: makeError('validation_error', `Not a valid DOI: ${normalized} (expected 10.xxxx/xxxx)`),
    }
  }
  let chain
  try {
    chain = await resolveChain(chainContext(rt, normalized))
  } catch (e) {
    return {
      doi: normalized,
      success: false,
      source: null,
      pdfUrl: null,
      file: null,
      meta: {},
      sourcesTried: ['resolve_error'],
      error: makeError('resolve_network_error', `Metadata resolvers failed: ${(e as Error).message}`),
    }
  }
  if (!chain.candidates.length) {
    const err = makeError('not_found', 'No open-access PDF found', 'OA availability changes over time; retry after embargo lifts or a preprint appears')
    if (!rt.settings.institutionalEnabled) {
      err.suggest_institutional = true
      err.reason = 'No OA copy found. If your institution subscribes to this paper, enable institutional mode in the plugin settings.'
    }
    return {
      doi: normalized,
      success: false,
      source: null,
      pdfUrl: null,
      file: null,
      meta: { ...chain.meta },
      sourcesTried: chain.sourcesTried,
      error: err,
    }
  }
  const first = chain.candidates[0]!
  return {
    doi: normalized,
    success: true,
    source: first.source,
    pdfUrl: first.pdfUrl,
    file: null,
    meta: { ...chain.meta },
    sourcesTried: chain.sourcesTried,
  }
}

export interface DownloadOptions {
  overwrite?: boolean
  checkDns?: boolean
}

/** Resolve then download; tries every candidate until one validates. */
export async function fetchOne(rt: FetchRuntime, doi: string, opts: DownloadOptions = {}): Promise<FetchItemResult> {
  const normalized = normalizeDoi(doi)
  if (!isValidDoi(normalized)) {
    return {
      doi: normalized,
      success: false,
      source: null,
      pdfUrl: null,
      file: null,
      meta: {},
      sourcesTried: [],
      error: makeError('validation_error', `Not a valid DOI: ${normalized}`),
    }
  }
  let chain
  try {
    chain = await resolveChain(chainContext(rt, normalized))
  } catch (e) {
    return {
      doi: normalized,
      success: false,
      source: null,
      pdfUrl: null,
      file: null,
      meta: {},
      sourcesTried: ['resolve_error'],
      error: makeError('resolve_network_error', `Metadata resolvers failed: ${(e as Error).message}`),
    }
  }

  const outDir = resolveOutDir(rt.settings.pdfOutputDir, rt.baseDir)

  // No candidate source yielded a PDF URL. Report a clean not_found rather
  // than falling through to the (empty) download loop and crashing on
  // `failures[length-1]`.
  if (!chain.candidates.length) {
    const err = makeError('not_found', 'No open-access PDF found', 'OA availability changes over time; retry after embargo lifts or a preprint appears')
    if (!rt.settings.institutionalEnabled) {
      err.suggest_institutional = true
      err.reason = 'No OA copy found. If your institution subscribes to this paper, enable institutional mode in the plugin settings.'
    }
    return {
      doi: normalized,
      success: false,
      source: null,
      pdfUrl: null,
      file: null,
      meta: { ...chain.meta },
      sourcesTried: chain.sourcesTried,
      error: err,
    }
  }

  const fname = buildFilename(chain.meta, normalized)
  const dest = join(outDir, fname)

  const exists = await fileExists(dest)
  if (exists && !opts.overwrite) {
    return {
      doi: normalized,
      success: true,
      source: chain.candidates[0]?.source ?? null,
      pdfUrl: chain.candidates[0]?.pdfUrl ?? null,
      file: dest,
      meta: { ...chain.meta },
      sourcesTried: chain.sourcesTried,
      skipped: true,
      skipReason: 'file_exists',
    }
  }

  const failures: Array<{ source: string; reason: string; detail?: string }> = []
  for (const cand of chain.candidates) {
    const gate = isSafeUrl(cand.pdfUrl)
    if (!gate.ok) {
      failures.push({ source: cand.source, reason: 'download_host_not_allowed', detail: gate.reason })
      continue
    }
    const outcome = await downloadPdf(cand.pdfUrl, dest, {
      timeoutMs: rt.settings.fetchTimeoutSec * 1000,
      maxBytes: rt.settings.maxPdfSizeMb * 1024 * 1024,
      signal: rt.signal,
      checkDns: opts.checkDns,
      cloakEnabled: rt.settings.cloakEnabled,
    })
    if (outcome.ok) {
      return {
        doi: normalized,
        success: true,
        source: cand.source,
        pdfUrl: cand.pdfUrl,
        file: dest,
        meta: { ...chain.meta },
        sourcesTried: chain.sourcesTried,
        ...(cand.detail ? { via: cand.detail.mirror ? 'scihub' : cand.detail.publisher ? 'publisher_direct' : undefined } : {}),
      }
    }
    failures.push({ source: cand.source, reason: outcome.reason ?? 'download_network_error', detail: outcome.detail })
  }

  if (failures.length === 0) {
    // Defensive: should be unreachable (candidates was non-empty above), but
    // never index an empty list.
    const err = makeError('not_found', 'No candidate could be downloaded', 'All resolved URLs were unusable')
    return {
      doi: normalized,
      success: false,
      source: null,
      pdfUrl: null,
      file: null,
      meta: { ...chain.meta },
      sourcesTried: chain.sourcesTried,
      error: err,
    }
  }

  const last = failures[failures.length - 1]!
  const code = (() => {
    switch (last.reason) {
      case 'download_not_a_pdf': return 'download_not_a_pdf' as const
      case 'download_host_not_allowed': return 'download_host_not_allowed' as const
      case 'download_size_exceeded': return 'download_size_exceeded' as const
      case 'download_io_error': return 'download_io_error' as const
      default: return 'download_network_error' as const
    }
  })()
  return {
    doi: normalized,
    success: false,
    source: last.source,
    pdfUrl: null,
    file: null,
    meta: { ...chain.meta },
    sourcesTried: chain.sourcesTried,
    error: makeError(code, `Download failed from ${last.source}: ${last.reason}${last.detail ? ` (${last.detail})` : ''}`),
  }
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
  const next = failed.length
    ? failed.length === 1
      ? [`paper-fetch ${failed[0]!.doi} --out ${outDir}`]
      : [`printf %s ${JSON.stringify(failed.map((r) => r.doi).join('\n') + '\n')} | paper-fetch --batch - --out ${outDir}`]
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
  const { doi, resolution } = await resolveTitle(title, { email: rt.settings.unpaywallEmail.trim(), s2: rt.s2, timeoutMs: rt.settings.fetchTimeoutSec * 1000, signal: rt.signal })
  return { doi, resolution }
}

/** Check whether a candidate URL is usable for previewing (safety gate only). */
export function previewCandidate(c: SourceResolution): { source: string; pdfUrl: string; safe: boolean; reason?: string } {
  const gate = isSafeUrl(c.pdfUrl)
  return { source: c.source, pdfUrl: c.pdfUrl, safe: gate.ok, reason: gate.reason }
}