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
  | 'title_mismatch'
  | 'source_title_conflict'
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
  /** true when the PDF URL was fetched/validated; false for an unverified
   * web-search hit in a resolve-only call. */
  verified?: boolean
  error?: EnvelopeError
}

/** Codes that will not get better on a retry (bad input, or a wrong paper). */
const NON_RETRYABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'validation_error', 'download_not_a_pdf', 'download_host_not_allowed',
  'title_resolve_failed', 'title_mismatch', 'source_title_conflict', 'internal_error',
])

/** Build a standard error object with the retry map applied. */
export function makeError(code: ErrorCode, message: string, reason?: string): EnvelopeError {
  const retryable = !NON_RETRYABLE.has(code)
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