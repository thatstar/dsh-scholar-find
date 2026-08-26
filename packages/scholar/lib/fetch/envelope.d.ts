/**
 * Result envelopes and error classes for the paper_fetch tools. Structured so
 * the model can route retries deterministically: some errors are retryable
 * now, some only later, some never.
 * @module dsh-scholar/fetch-envelope
 */
/** Retry hints in hours per error code (recommendations for the model). */
export declare const RETRY_AFTER_HOURS: Readonly<Record<string, number>>;
export type ErrorCode = 'validation_error' | 'not_found' | 'resolve_network_error' | 'title_resolve_failed' | 'download_network_error' | 'download_not_a_pdf' | 'download_host_not_allowed' | 'download_size_exceeded' | 'download_io_error' | 'internal_error';
export interface EnvelopeError {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    retry_after_hours?: number;
    reason?: string;
    suggest_institutional?: boolean;
}
/** One per-DOI outcome inside a paper_fetch result. */
export interface FetchItemResult {
    doi: string;
    success: boolean;
    source: string | null;
    pdfUrl: string | null;
    file: string | null;
    meta: Record<string, unknown>;
    sourcesTried: readonly string[];
    skipped?: boolean;
    skipReason?: string;
    via?: string;
    error?: EnvelopeError;
}
/** Build a standard error object with the retry map applied. */
export declare function makeError(code: ErrorCode, message: string, reason?: string): EnvelopeError;
