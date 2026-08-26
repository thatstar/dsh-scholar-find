import { describe, expect, it } from 'vitest'
import { isLosslessJson, sanitizeForOutput } from '../src/util/sanitize.js'
import { compactPapers } from '../src/s2/format.js'

describe('sanitizeForOutput', () => {
  it('drops object values that are undefined', () => {
    expect(sanitizeForOutput({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' })
  })

  it('drops array elements that are undefined and densifies sparse arrays', () => {
    const sparse = new Array(2) // holes
    sparse[0] = 1
    expect(sanitizeForOutput([undefined, 1, 'x', undefined])).toEqual([1, 'x'])
    expect(sanitizeForOutput(sparse)).toEqual([1])
  })

  it('drops NaN / Infinity and normalises -0 to 0', () => {
    expect(sanitizeForOutput({ a: NaN, b: Infinity, c: -Infinity, d: -0, e: 0 })).toEqual({ d: 0, e: 0 })
  })

  it('cleans nested structures recursively', () => {
    const value = {
      ok: true,
      data: { total: 2, results: [{ title: 'A', year: 2021, venue: undefined, comments: undefined }] },
      meta: { token: undefined, order: [1, undefined, 3] },
    }
    const out = sanitizeForOutput(value) as any
    expect(out).toEqual({
      ok: true,
      data: { total: 2, results: [{ title: 'A', year: 2021 }] },
      meta: { order: [1, 3] },
    })
    expect(isLosslessJson(out)).toBe(true)
  })

  it('returns null when nothing remains', () => {
    expect(sanitizeForOutput(undefined)).toBeNull()
    expect(sanitizeForOutput({ a: undefined })).toEqual({})
  })
})

describe('compactPapers', () => {
  it('produces lossless values even with sparse S2 fields', () => {
    const papers = [
      {
        paperId: 'abc',
        title: 'A paper',
        year: 2021,
        citationCount: 5,
        authors: [{ name: undefined }, { name: 'Alice' }],
        venue: undefined,
        externalIds: {},
        tldr: undefined,
      },
    ] as any
    const out = compactPapers(papers)
    expect(out).toEqual([{
      paperId: 'abc',
      title: 'A paper',
      year: 2021,
      citationCount: 5,
      authors: ['Alice'],
      venue: null,
      doi: null,
      tldr: null,
    }])
    expect(isLosslessJson(out)).toBe(true)
    expect(JSON.stringify(out)).not.toContain('undefined')
  })
})