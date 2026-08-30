import { describe, expect, it } from 'vitest'
import {
  buildEvidenceItem,
  normalizeText,
  pickEvidenceHit,
  resolveYearRange,
  topByCitation,
  topVenues,
  verifyQuoteInSlice,
} from '../src/sciverse/aggregate.js'

describe('resolveYearRange', () => {
  it('defaults to the last 5 years ending in the current year', () => {
    const r = resolveYearRange(undefined, undefined)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.yearTo).toBe(new Date().getFullYear())
    expect(r.yearFrom).toBe(r.yearTo - 4)
    expect(r.years).toHaveLength(5)
  })

  it('respects explicit bounds and caps the span', () => {
    const r = resolveYearRange(2020, 2024)
    expect(r).toEqual({ ok: true, yearFrom: 2020, yearTo: 2024, years: [2020, 2021, 2022, 2023, 2024] })
    const capped = resolveYearRange(2010, 2024)
    expect(capped.ok).toBe(false)
    if (!capped.ok) expect(capped.error).toMatch(/10-year cap/)
  })

  it('rejects inverted and out-of-range years', () => {
    const inverted = resolveYearRange(2025, 2020)
    expect(inverted.ok).toBe(false)
    if (!inverted.ok) expect(inverted.error).toMatch(/year_from/)
    const oob = resolveYearRange(1700, 2020, 10)
    expect(oob.ok).toBe(false)
    if (!oob.ok) expect(oob.error).toMatch(/1800/)
  })
})

describe('topByCitation', () => {
  it('sorts descending by citation_count and caps to n', () => {
    const papers = [
      { title: 'a', citation_count: 5 },
      { title: 'b', citation_count: 40 },
      { title: 'c', citation_count: 12 },
    ]
    const top = topByCitation(papers, 2)
    expect(top.map((p) => p.title)).toEqual(['b', 'c'])
  })

  it('treats missing citation_count as zero and maps to the compact shape', () => {
    const top = topByCitation([
      { unique_id: 'paper:x', title: 'x', publication_venue_name_unified: 'Nature', publication_published_year: 2022, doi: '10.1/x', citation_count: 7 },
      { unique_id: 'paper:y', title: 'y' },
    ], 5)
    expect(top[0]).toEqual({ unique_id: 'paper:x', title: 'x', citation_count: 7, venue: 'Nature', year: 2022, doi: '10.1/x' })
    expect(top[1]?.citation_count).toBeUndefined()
    expect(top[1]?.venue).toBeUndefined()
  })
})

describe('topVenues', () => {
  it('counts normalized venue names and keeps the most frequent, skipping blanks', () => {
    const venues = topVenues([
      { publication_venue_name_unified: 'Nature' },
      { publication_venue_name_unified: 'Nature' },
      { publication_venue_name_unified: 'ICML' },
      { publication_venue_name_unified: '' },
      {},
    ], 5)
    expect(venues).toEqual([
      { venue: 'Nature', count: 2 },
      { venue: 'ICML', count: 1 },
    ])
  })

  it('caps the list and breaks ties alphabetically', () => {
    const three = topVenues([{ publication_venue_name_unified: 'A' }, { publication_venue_name_unified: 'B' }], 1)
    expect(three).toEqual([{ venue: 'A', count: 1 }])
  })
})

describe('pickEvidenceHit', () => {
  it('returns the best-scoring hit and matched when it clears minScore', () => {
    const { hit, matched } = pickEvidenceHit([{ score: 0.4 }, { score: 0.81 }], 0.6)
    expect(hit).toMatchObject({ score: 0.81 })
    expect(matched).toBe(true)
  })

  it('reports matched=false when the best hit is below threshold', () => {
    const { hit, matched } = pickEvidenceHit([{ score: 0.2 }, { score: 0.59 }], 0.6)
    expect(hit?.score).toBe(0.59)
    expect(matched).toBe(false)
  })

  it('handles an empty hit list', () => {
    expect(pickEvidenceHit([], 0.6)).toEqual({ hit: undefined, matched: false })
  })
})

describe('verifyQuoteInSlice', () => {
  it('normalizes whitespace and case before comparing', () => {
    expect(verifyQuoteInSlice('AlphaFold2   achieves  atomic\naCcuRacy', 'alphafold2 achieves atomic accuracy')).toBe(true)
  })

  it('accepts a quote that contains the slice and rejects foreign text', () => {
    expect(verifyQuoteInSlice('short slice', 'prefix short slice suffix')).toBe(true)
    expect(verifyQuoteInSlice('completely different text', 'unrelated quote')).toBe(false)
    expect(verifyQuoteInSlice('', 'quote')).toBe(false)
    expect(verifyQuoteInSlice('some text', '')).toBe(false)
  })
})

describe('buildEvidenceItem', () => {
  it('maps hit fields, rounds confidence, and truncates the quote', () => {
    const item = buildEvidenceItem('my claim', {
      chunk_id: 'c1',
      doc_id: 'd1',
      offset: 42,
      page_no: 7,
      title: 'Some Paper',
      score: 0.8333,
      chunk: 'x'.repeat(900),
      source_type: 'pdf',
    }, { matched: true, verified: true, quoteMax: 600 })
    expect(item.claim).toBe('my claim')
    expect(item.doc_id).toBe('d1')
    expect(item.offset).toBe(42)
    expect(item.page_no).toBe(7)
    expect(item.confidence).toBe(0.83)
    expect(item.score).toBe(0.8333)
    expect(item.quote).toHaveLength(600)
    expect(item.verified).toBe(true)
    expect(item.matched).toBe(true)
    expect(item.source_type).toBe('pdf')
  })

  it('falls back to abstract as the quote and omits absent fields', () => {
    const item = buildEvidenceItem('claim', { chunk: undefined, abstract: 'fallback text', score: 0.5 }, { matched: false, verified: false })
    expect(item.quote).toBe('fallback text')
    expect(item.doc_id).toBeUndefined()
    expect(item.page_no).toBeUndefined()
    expect(item.confidence).toBe(0.5)
  })
})

describe('normalizeText', () => {
  it('collapses whitespace and lower-cases', () => {
    expect(normalizeText('  AlphaFold2\n\tachieves ACCURACY  ')).toBe('alphafold2 achieves accuracy')
  })
})
