/**
 * Typed-envelope tests for the sciverse_* tools. Real failures arrive as a
 * nested error body (`{"error":{"code":"CONTENT_NOT_FOUND",…}}`) or a 502 and
 * used to reach the model as an opaque `Error: Sciverse API 502: {…}`.
 */
import { describe, expect, it } from 'vitest'
import { SciverseHttpError } from '../src/sciverse/client.js'
import { isRetryableSciverseError, sciverseEnvelope, shouldTryAlternateDocId, SCIVERSE_CODE_CONTENT_NOT_FOUND, SCIVERSE_CODE_FETCH_FAILED } from '../src/sciverse/errors.js'

describe('sciverseEnvelope', () => {
  it('maps CONTENT_NOT_FOUND to a non-retryable content_not_found with the channel ladder', () => {
    const env = sciverseEnvelope(new SciverseHttpError(404, SCIVERSE_CODE_CONTENT_NOT_FOUND, '原文不存在'), 'read_content')
    expect(env).toMatchObject({ ok: false, code: 'content_not_found', retryable: false, status: 404, upstream_code: SCIVERSE_CODE_CONTENT_NOT_FOUND })
    expect(env.markdown).toContain('alt_doc_ids')
    expect(env.markdown).toContain('arxiv_get_fulltext')
    expect(env.markdown).toContain('scholar_get_paper_snippets')
  })

  it('maps a 502 FETCH_FAILED to a retryable content_fetch_failed', () => {
    const env = sciverseEnvelope(new SciverseHttpError(502, SCIVERSE_CODE_FETCH_FAILED, 'upstream fetch failed'), 'read_content')
    expect(env).toMatchObject({ code: 'content_fetch_failed', retryable: true, retry_after_hours: 1, status: 502 })
    expect(env.markdown).toContain('already retried')
  })

  it('maps auth, rate-limit, 404 and 5xx statuses', () => {
    expect(sciverseEnvelope(new SciverseHttpError(401, undefined, 'unauthorized'), 'x')).toMatchObject({ code: 'forbidden', retryable: false })
    expect(sciverseEnvelope(new SciverseHttpError(403, undefined, 'forbidden'), 'x')).toMatchObject({ code: 'forbidden', retryable: false })
    expect(sciverseEnvelope(new SciverseHttpError(429, undefined, 'slow down'), 'x')).toMatchObject({ code: 'rate_limited', retryable: true, retry_after_hours: 1 })
    expect(sciverseEnvelope(new SciverseHttpError(404, undefined, 'nope'), 'x')).toMatchObject({ code: 'not_found', retryable: false })
    expect(sciverseEnvelope(new SciverseHttpError(500, undefined, 'boom'), 'x')).toMatchObject({ code: 'server_error', retryable: true })
    expect(sciverseEnvelope(new SciverseHttpError(422, 'BAD_FIELD', 'bad'), 'x')).toMatchObject({ code: 'api_error', retryable: false, upstream_code: 'BAD_FIELD' })
  })

  it('degrades transport errors to a retryable envelope and cancellations to non-retryable', () => {
    expect(sciverseEnvelope(new Error('sciverse x: timeout after 60000ms'), 'x')).toMatchObject({ code: 'timeout', retryable: true })
    expect(sciverseEnvelope(new Error('fetch failed'), 'x')).toMatchObject({ code: 'timeout', retryable: true })
    expect(sciverseEnvelope(new Error('The operation was aborted'), 'x')).toMatchObject({ code: 'aborted', retryable: false })
    const weird = sciverseEnvelope(new Error('something else'), 'x')
    expect(weird.ok).toBe(false)
    expect(weird.markdown).toContain('something else')
  })

  it('always produces the lossless envelope shape', () => {
    const env = sciverseEnvelope(new Error('x'), 'label')
    expect(env).toHaveProperty('ok', false)
    expect(typeof env.code).toBe('string')
    expect(typeof env.retryable).toBe('boolean')
    expect(typeof env.markdown).toBe('string')
  })
})

describe('isRetryableSciverseError / shouldTryAlternateDocId', () => {
  it('retries transient transport failures only', () => {
    expect(isRetryableSciverseError(new Error('socket hang up'))).toBe(true)
    expect(isRetryableSciverseError(new Error('EAI_AGAIN'))).toBe(true)
    expect(isRetryableSciverseError(new SciverseHttpError(500, undefined, 'x'))).toBe(true)
    expect(isRetryableSciverseError(new SciverseHttpError(400, undefined, 'x'))).toBe(false)
    expect(isRetryableSciverseError(new TypeError('Cannot read properties of undefined'))).toBe(false)
  })

  it('tries another doc_id only for a per-artifact failure', () => {
    expect(shouldTryAlternateDocId({ ok: false, code: 'content_not_found', retryable: false, markdown: '' })).toBe(true)
    expect(shouldTryAlternateDocId({ ok: false, code: 'content_fetch_failed', retryable: true, markdown: '' })).toBe(true)
    expect(shouldTryAlternateDocId({ ok: false, code: 'forbidden', retryable: false, markdown: '' })).toBe(false)
    expect(shouldTryAlternateDocId({ ok: false, code: 'rate_limited', retryable: true, markdown: '' })).toBe(false)
  })
})
