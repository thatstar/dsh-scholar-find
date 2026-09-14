import { describe, expect, it } from 'vitest'
import { computeCoverage } from '../src/coverage.js'

describe('computeCoverage', () => {
  it('reports not_indexed when the record claims entries the API does not serve', () => {
    const c = computeCoverage({ returned: 0, requestedCap: 100, hasMore: false, seedCount: 89, kind: 'references' })
    expect(c.status).toBe('not_indexed')
    expect(c.complete).toBe(false)
    expect(c.label).toContain('89')
    expect(c.label).toContain('NOT indexed')
  })

  it('reports empty only when the record itself reports none', () => {
    const c = computeCoverage({ returned: 0, requestedCap: 100, hasMore: false, seedCount: 0 })
    expect(c.status).toBe('empty')
    expect(c.complete).toBe(true)
  })

  it('does not call an unverifiable zero list empty', () => {
    const c = computeCoverage({ returned: 0, requestedCap: 100, hasMore: false })
    expect(c.status).toBe('empty')
    // No count was available: the label must not imply a real total.
    expect(c.label).toContain('index gap')
  })

  it('reports truncated when the requested cap was hit', () => {
    const capped = computeCoverage({ returned: 100, requestedCap: 100, hasMore: true, seedCount: 22302, kind: 'citing papers' })
    expect(capped.status).toBe('truncated')
    expect(capped.label).toContain('100 of 22302')
    expect(capped.label).toContain('not the total')

    const exactlyCap = computeCoverage({ returned: 100, requestedCap: 100, hasMore: false, seedCount: 22302 })
    expect(exactlyCap.status).toBe('truncated')
  })

  it('reports partial when the list is short of the record count without hitting the cap', () => {
    const c = computeCoverage({ returned: 2, requestedCap: 100, hasMore: false, seedCount: 244, kind: 'citing papers' })
    expect(c.status).toBe('partial')
    expect(c.complete).toBe(false)
    expect(c.label).toContain('2 of 244')
    expect(c.label).toContain('not the total')
  })

  it('reports complete when the list matches the record count', () => {
    const c = computeCoverage({ returned: 89, requestedCap: 100, hasMore: false, seedCount: 89 })
    expect(c.status).toBe('complete')
    expect(c.complete).toBe(true)
  })

  it('reports complete-with-caveat when no count was available and the list was not capped', () => {
    const c = computeCoverage({ returned: 12, requestedCap: 100, hasMore: false })
    expect(c.status).toBe('complete')
    expect(c.label).toContain('no total')
  })

  it('keeps the raw numbers for the model', () => {
    const c = computeCoverage({ returned: 2, requestedCap: 100, hasMore: true, seedCount: 244 })
    expect(c).toMatchObject({ returned: 2, requestedCap: 100, hasMore: true, seedCount: 244, status: 'truncated' })
  })
})
