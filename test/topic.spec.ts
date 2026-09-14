import { describe, expect, it } from 'vitest'
import { isNarrowQuery, significantTokens, topicOverlap } from '../src/topic.js'

describe('significantTokens', () => {
  it('drops stopwords, boolean syntax and single characters', () => {
    expect(significantTokens('the effect of +metal-liquid nucleation on ice')).toEqual(['metal', 'liquid', 'nucleation', 'ice'])
  })

  it('deduplicates and keeps first-seen order', () => {
    expect(significantTokens('nucleation nucleation ice')).toEqual(['nucleation', 'ice'])
  })

  it('returns nothing for a query made only of stopwords', () => {
    expect(significantTokens('a study of the effect')).toEqual([])
  })
})

describe('isNarrowQuery', () => {
  it('is true for a multi-term topical query', () => {
    expect(isNarrowQuery('metal-liquid nucleation')).toBe(true)
  })

  it('is false for a single-term or OR-grouped query', () => {
    expect(isNarrowQuery('nucleation')).toBe(false)
    expect(isNarrowQuery('nucleation | crystallization')).toBe(false)
    expect(isNarrowQuery('a study of the effect')).toBe(false)
  })
})

describe('topicOverlap', () => {
  const query = 'metal-liquid nucleation'

  it('keeps an on-topic hit', () => {
    const overlap = topicOverlap(query, { title: 'Homogeneous nucleation in metal liquids' })
    expect(overlap.offTopic).toBe(false)
    expect(overlap.matched).toEqual(['metal', 'liquid', 'nucleation'])
    expect(overlap.ratio).toBe(1)
  })

  it('flags the off-topic hits the real report saw (ice nucleation, polymer informatics)', () => {
    expect(topicOverlap(query, { title: 'Ice nucleation on mineral dust particles' }).offTopic).toBe(false) // shares "nucleation"
    expect(topicOverlap(query, { title: 'Deep learning for polymer informatics' }).offTopic).toBe(true)
    expect(topicOverlap(query, { title: 'Pharmaceutical crystallization scale-up' }).offTopic).toBe(true)
  })

  it('counts venue, field-of-study and abstract as evidence', () => {
    expect(topicOverlap(query, { title: 'A generic title', fieldsOfStudy: ['Materials Science'], abstract: 'metal liquid interfaces' }).offTopic).toBe(false)
    expect(topicOverlap(query, { title: 'A generic title', venue: 'Journal of Nucleation' }).matched).toEqual(['nucleation'])
  })

  it('matches plural/derivational variants but not unrelated prefixes', () => {
    expect(topicOverlap('nucleation rates', { title: 'Nucleation rate measurements' }).offTopic).toBe(false)
    expect(topicOverlap('gelation', { title: 'Gel electrophoresis of proteins' }).offTopic).toBe(false) // prefix rule
  })

  it('never flags when the query is broad (nothing to compare against)', () => {
    expect(topicOverlap('crystallization', { title: 'Unrelated' }).offTopic).toBe(false)
    expect(topicOverlap('nucleation | growth', { title: 'Unrelated' }).offTopic).toBe(false)
  })

  it('reports the ratio for partially-matching hits', () => {
    const overlap = topicOverlap(query, { title: 'Nucleation phenomena' })
    expect(overlap.ratio).toBeCloseTo(1 / 3)
    expect(overlap.offTopic).toBe(false)
  })
})
