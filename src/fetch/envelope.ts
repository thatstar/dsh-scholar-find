/**
 * Result envelopes and error classes for the paper_fetch tools. Structured so
 * the model can route retries deterministically: some errors are retryable
 * now, some only later, some never.
 * @module dsh-scholar-find/fetch-envelope
 */

/** Retry hints in hours per error code (recommendations for the model). */
export const RETRY_AFTER_HOURS: Readonly<Record<string, number>> = {
  not_found: 168,
  resolve_network_error: 1,
  download_network_error: 1,
  download_size_exceeded: 24,
  download_io_error: 1,
}

export type ErrorCode =
  | 'validation_error'
  | 'not_found'
  | 'resolve_network_error'
  | 'title_resolve_failed'
  | 'download_network_error'
  | 'download_not_a_pdf'
  | 'download_host_not_allowed'
  | 'download_size_exceeded'
  | 'download_io_error'
  | 'internal_error'

export interface EnvelopeError {
  code: ErrorCode
  message: string
  retryable: boolean
  retry_after_hours?: number
  reason?: string
}

/** One per-DOI outcome inside a paper_fetch result. */
export interface FetchItemResult {
  doi: string
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

/** Build a standard error object with the retry map applied. */
export function makeError(code: ErrorCode, message: string, reason?: string): EnvelopeError {
  const retryable = code !== 'validation_error' && code !== 'download_not_a_pdf' && code !== 'download_host_not_allowed' && code !== 'title_resolve_failed' && code !== 'internal_error'
  const err: EnvelopeError = { code, message, retryable }
  if (reason) err.reason = reason
  const hours = RETRY_AFTER_HOURS[code]
  if (retryable && hours !== undefined) err.retry_after_hours = hours
  return err
}

/**
 * Map a download failure `reason` (as produced by `DownloadOutcome`) to its
 * envelope `ErrorCode`. Single source of truth for the download-error enum;
 * unrecognized reasons fall back to `download_network_error`.
 */
export function codeOf(reason: string): ErrorCode {
  switch (reason) {
    case 'download_not_a_pdf': return 'download_not_a_pdf'
    case 'download_host_not_allowed': return 'download_host_not_allowed'
    case 'download_size_exceeded': return 'download_size_exceeded'
    case 'download_io_error': return 'download_io_error'
    default: return 'download_network_error'
  }
}