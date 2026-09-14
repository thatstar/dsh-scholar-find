import { describe, expect, it } from 'vitest'
import { describeTitleCheck, normalizeTitle, TITLE_MATCH_MIN, titleAccepted, titleSimilarity, titleTokens, titleVerdict } from '../src/verify.js'

describe('normalizeTitle / titleTokens', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeTitle('  Classical  Nucleation: Theory & Practice! ')).toBe('classical nucleation theory practice')
    expect([...titleTokens('A/B testing')]).toEqual(['a', 'b', 'testing'])
  })

  it('yields an empty token set for punctuation-only input', () => {
    expect(titleTokens('— —').size).toBe(0)
  })
})

describe('titleSimilarity', () => {
  it('is 1 for identical titles modulo case/punctuation', () => {
    expect(titleSimilarity('Deep Learning', 'deep learning.')).toBe(1)
  })

  it('is 0 when either side has no tokens', () => {
    expect(titleSimilarity('', 'Deep Learning')).toBe(0)
    expect(titleSimilarity('...', 'Deep Learning')).toBe(0)
  })

  it('separates a same-work subtitle variant from a different work', () => {
    const same = titleSimilarity(
      'Homogeneous nucleation in metal liquids',
      'Homogeneous nucleation in metal liquids: a molecular dynamics study',
    )
    const other = titleSimilarity(
      'Homogeneous nucleation in metal liquids',
      'Ice nucleation on mineral dust particles',
    )
    expect(same).toBeGreaterThan(other)
    expect(same).toBeGreaterThanOrEqual(0.5)
    expect(other).toBeLessThan(0.5)
  })
})

describe('titleVerdict', () => {
  it('reports match for the same work', () => {
    const c = titleVerdict('Array programming with NumPy', 'Array programming with NumPy')
    expect(c).toMatchObject({ verdict: 'match', similarity: 1 })
    expect(titleAccepted(c)).toBe(true)
  })

  it('reports near for a subtitle/abbreviation variant', () => {
    const c = titleVerdict(
      'Homogeneous nucleation in metal liquids',
      'Homogeneous nucleation in metal liquids: a molecular dynamics study',
    )
    expect(c.verdict).toBe('near')
    expect(titleAccepted(c)).toBe(true)
  })

  it('reports mismatch for an unrelated paper (the fabricated-citation case)', () => {
    const c = titleVerdict('Homogeneous nucleation in metal liquids', 'Colloidal gelation of hard spheres')
    expect(c.verdict).toBe('mismatch')
    expect(titleAccepted(c)).toBe(false)
    expect(describeTitleCheck(c)).toContain('TITLE MISMATCH')
  })

  it('never treats a missing title as a pass', () => {
    expect(titleVerdict('Some title', undefined)).toMatchObject({ verdict: 'unknown', similarity: 0 })
    expect(titleVerdict(undefined, 'Some title').verdict).toBe('unknown')
    expect(titleVerdict('', '').verdict).toBe('unknown')
    expect(titleAccepted(titleVerdict('Some title', ''))).toBe(false)
  })

  it('carries the compared titles for the model to report', () => {
    const c = titleVerdict('Expected work', 'Different work entirely')
    expect(c.expected).toBe('Expected work')
    expect(c.actual).toBe('Different work entirely')
  })

  it('uses the documented band boundaries', () => {
    expect(TITLE_MATCH_MIN).toBeGreaterThan(0.5)
    expect(describeTitleCheck({ verdict: 'unknown', similarity: 0 })).toContain('unverified')
    expect(describeTitleCheck({ verdict: 'match', similarity: 0.9 })).toContain('verified')
  })
})
