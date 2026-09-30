import { describe, expect, it } from 'vitest'
import { describeTitleCheck, normalizeTitle, TITLE_MATCH_MIN, titleAccepted, titleSimilarity, titleTokens, titleVariants, titleVerdict } from '../src/verify.js'

describe('normalizeTitle / titleTokens', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normalizeTitle('  Classical  Nucleation: Theory & Practice! ')).toBe('classical nucleation theory practice')
    expect([...titleTokens('A/B testing')]).toEqual(['a', 'b', 'testing'])
  })

  it('yields an empty token set for punctuation-only input', () => {
    expect(titleTokens('— —').size).toBe(0)
  })

  it('keeps non-ASCII letters instead of deleting them', () => {
    // The ASCII-only tokenizer deleted every CJK character, so a Chinese title
    // normalized to '' and scored 0 against ITSELF — a `mismatch`, the refusing
    // verdict, for every Chinese work (.notes/78 R1b).
    expect(normalizeTitle('注意力机制综述')).toBe('注意力机制综述')
    expect(titleSimilarity('注意力机制综述', '注意力机制综述')).toBe(1)
    expect(titleVerdict('注意力机制综述', '注意力机制综述').verdict).toBe('match')
  })

  it('separates near-identical from unrelated CJK titles (character bigrams)', () => {
    const same = titleSimilarity('注意力机制综述', '注意力机制研究综述')
    const other = titleSimilarity('注意力机制综述', '蛋白质折叠预测')
    expect(same).toBeGreaterThanOrEqual(0.5)
    expect(other).toBeLessThan(0.5)
    expect(titleAccepted(titleVerdict('注意力机制综述', '注意力机制研究综述'))).toBe(true)
    expect(titleVerdict('注意力机制综述', '蛋白质折叠预测').verdict).toBe('mismatch')
  })

  it('recognises a bilingual RAG title against its monolingual record (.notes/78 §11)', () => {
    // Live: the Sciverse RAG endpoint renders `中文标题 | English title` while its
    // metadata index stores one language, so a literal comparison called the
    // SAME paper a mismatch (10.19678/j.issn.1000-3428.0063687).
    const zh = '基于倒金字塔深度学习网络的三维医学图像分割'
    const en = '3D Medical Image Segmentation Based on Inverted Pyramid Deep Learning Network'
    expect(titleVerdict(`${zh}  |  ${en}`, en).verdict).toBe('match')
    expect(titleVerdict(`${zh}  |  ${en}`, zh).verdict).toBe('match')
    expect(titleVerdict(en, `${zh}  |  ${en}`).verdict).toBe('match')
    // A different work is still a mismatch through every variant.
    expect(titleVerdict(`${zh}  |  ${en}`, 'Protein structure prediction with transformers').verdict).toBe('mismatch')
  })

  it('does not split on "/" — a short variant would match unrelated titles', () => {
    expect(titleVariants('A/B testing')).toEqual(['A/B testing'])
    expect(titleVerdict('A/B testing', 'A').verdict).toBe('mismatch')
  })

  it('still tokenizes spaced scripts as words, mixing with CJK runs', () => {
    expect(titleTokens('Café 注意力')).toEqual(new Set(['café', '注意', '意力']))
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
