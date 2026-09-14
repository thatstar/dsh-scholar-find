/**
 * Typed error envelopes for the sciverse_* tools (pure).
 *
 * The Open Platform answers with a nested error body
 * (`{"error":{"biz_code":12633,"code":"CONTENT_NOT_FOUND","message":"原文不存在"}}`)
 * and, for full text it cannot serve, a `502 FETCH_FAILED`. Both used to reach
 * the model as a bare `Error: Sciverse API 502: {…}` — no code, no retry
 * verdict, no next step. This module turns them into the plugin's standard
 * envelope (`code` / `retryable` / `retry_after_hours` + a `markdown` sentence
 * that names the fallback channel).
 * @module dsh-scholar-find/sciverse/errors
 */

import { isRetryableSciverseError, SciverseHttpError } from './client.js'

// Re-exported so callers have one errors surface; the implementation lives in
// ./client.ts to keep the module dependency one-way (client -> payload only).
export { isRetryableSciverseError }

/** The plugin's typed error envelope for a sciverse_* tool failure. */
export type SciverseErrorEnvelope = {
  ok: false
  code: string
  retryable: boolean
  retry_after_hours?: number
  /** Upstream HTTP status, when the failure was an HTTP error. */
  status?: number
  /** The upstream business code verbatim (e.g. CONTENT_NOT_FOUND). */
  upstream_code?: string
  markdown: string
}

/** Upstream business code: the paper's full text is not stored for this doc_id. */
export const SCIVERSE_CODE_CONTENT_NOT_FOUND = 'CONTENT_NOT_FOUND'
/** Upstream business code: the platform could not fetch the paper's full text. */
export const SCIVERSE_CODE_FETCH_FAILED = 'FETCH_FAILED'

/** The channel ladder for full-text retrieval (used by the error markdown). */
const CONTENT_FALLBACK_HINT =
  'Try another doc_id for the same paper (pass `alt_doc_ids`; `sciverse_semantic_search` lists them in `doc_id_index`), then `arxiv_get_fulltext` for arXiv works, then `scholar_get_paper_snippets` — do not loop on the same doc_id.'

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * Map any thrown sciverse error to the plugin's envelope. Unknown failures
 * degrade to a retryable `network_error` (never a silent empty success).
 */
export function sciverseEnvelope(e: unknown, label: string): SciverseErrorEnvelope {
  if (e instanceof SciverseHttpError) {
    const upstream = e.code
    const base = { status: e.status, ...(upstream ? { upstream_code: upstream } : {}) }
    if (upstream === SCIVERSE_CODE_CONTENT_NOT_FOUND) {
      return {
        ok: false,
        code: 'content_not_found',
        retryable: false,
        ...base,
        markdown: `Sciverse has no stored full text for this doc_id (${label}). ${CONTENT_FALLBACK_HINT}`,
      }
    }
    if (upstream === SCIVERSE_CODE_FETCH_FAILED || e.status === 502 || e.status === 504) {
      return {
        ok: false,
        code: 'content_fetch_failed',
        retryable: true,
        retry_after_hours: 1,
        ...base,
        markdown: `Sciverse could not fetch the paper's full text upstream (${e.status}${upstream ? ` ${upstream}` : ''}, ${label}) — already retried. ${CONTENT_FALLBACK_HINT}`,
      }
    }
    if (e.status === 401 || e.status === 403) {
      return { ok: false, code: 'forbidden', retryable: false, ...base, markdown: `Sciverse rejected the token (${e.status}${upstream ? ` ${upstream}` : ''}). Re-enter the "Sciverse API token" in Settings → Plugins → Plugin configuration.` }
    }
    if (e.status === 404) {
      return { ok: false, code: 'not_found', retryable: false, ...base, markdown: `Sciverse has no record for this ${label} request (404${upstream ? ` ${upstream}` : ''}). Check the identifier.` }
    }
    if (e.status === 429) {
      return { ok: false, code: 'rate_limited', retryable: true, retry_after_hours: 1, ...base, markdown: `Sciverse rate limit reached (429, ~30 requests/minute per endpoint). Back off ~60s before retrying ${label}.` }
    }
    if (e.status >= 500) {
      return { ok: false, code: 'server_error', retryable: true, retry_after_hours: 1, ...base, markdown: `Sciverse server error (${e.status}${upstream ? ` ${upstream}` : ''}) during ${label} — transient; retry later.` }
    }
    return { ok: false, code: 'api_error', retryable: false, ...base, markdown: `Sciverse request rejected (${e.status}${upstream ? ` ${upstream}` : ''}) during ${label}. Not retryable — check the arguments and token.` }
  }

  const msg = messageOf(e)
  if (/abort/i.test(msg)) {
    return { ok: false, code: 'aborted', retryable: false, markdown: `Sciverse ${label} was cancelled.` }
  }
  if (isRetryableSciverseError(e)) {
    return { ok: false, code: 'timeout', retryable: true, markdown: `Sciverse ${label} failed: ${msg}. Transient — retry once before switching channel.` }
  }
  return { ok: false, code: 'network_error', retryable: true, retry_after_hours: 1, markdown: `Sciverse ${label} failed: ${msg}` }
}

/**
 * True when another doc_id for the SAME paper is worth trying: the artifact is
 * missing or upstream could not fetch it. A bad token or a rate limit is not a
 * per-doc_id problem.
 */
export function shouldTryAlternateDocId(envelope: SciverseErrorEnvelope): boolean {
  return envelope.code === 'content_not_found' || envelope.code === 'content_fetch_failed'
}
