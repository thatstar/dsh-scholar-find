/**
 * Result envelopes and error classes for the paper_fetch tools. Structured so
 * the model can route retries deterministically: some errors are retryable
 * now, some only later, some never.
 * @module dsh-scholar/fetch-envelope
 */
/** Retry hints in hours per error code (recommendations for the model). */
export const RETRY_AFTER_HOURS = {
    not_found: 168,
    resolve_network_error: 1,
    download_network_error: 1,
    download_size_exceeded: 24,
    download_io_error: 1,
};
/** Build a standard error object with the retry map applied. */
export function makeError(code, message, reason) {
    const retryable = code !== 'validation_error' && code !== 'download_not_a_pdf' && code !== 'download_host_not_allowed' && code !== 'title_resolve_failed' && code !== 'internal_error';
    const err = { code, message, retryable };
    if (reason)
        err.reason = reason;
    const hours = RETRY_AFTER_HOURS[code];
    if (retryable && hours !== undefined)
        err.retry_after_hours = hours;
    return err;
}
//# sourceMappingURL=envelope.js.map