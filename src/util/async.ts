/**
 * Shared async primitives for the plugin: one abort-aware `sleep` used by every
 * client (S2 pacing/backoff, download retry backoff, MinerU poll loop, Cloak
 * challenge polling) so cancellation semantics are consistent across the codebase.
 * @module dsh-scholar-find/async
 */

/**
 * Resolve after `ms` milliseconds, or reject immediately (with `signal.reason`)
 * when the signal aborts — including the already-aborted case. This is the
 * abort-aware superset of a bare `setTimeout` sleep: callers that do not pass a
 * signal get plain timers.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'))
      return
    }
    const onAbort = (): void => {
      clearTimeout(t)
      reject(signal?.reason ?? new Error('aborted'))
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Run a best-effort operation: surface failures as `undefined` (fail-closed)
 * but log one diagnostic line so silent drops never look like success. Used for
 * the deliberately optional side effects (idempotency sidecar, credential
 * resolution) where a failure must not crash the request but should be audible.
 */
export async function bestEffort<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    console.warn(`[dsh-scholar-find] ${label} failed (best-effort): ${(e as Error).message}`)
    return undefined
  }
}