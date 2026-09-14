import { describe, expect, it } from 'vitest'
import { cardFilename, cardIdentifier, cardPath, cardSlug } from '../src/cards.js'

describe('cardSlug', () => {
  it('keeps DOI form, replacing the slash', () => {
    expect(cardSlug('10.1063/1.3506838')).toBe('10.1063_1.3506838')
    expect(cardSlug('10.1038/s41586-021-03819-2')).toBe('10.1038_s41586-021-03819-2')
  })

  it('covers the other filesystem-unsafe characters', () => {
    const slug = cardSlug('10.1002/(SICI)1099-0844(199912)17:4<261::AID-CBF840>3.0.CO;2-1')
    expect(slug).toBe('10.1002_SICI_1099-0844_199912_17_4_261_AID-CBF840_3.0.CO_2-1')
    expect(slug).not.toMatch(/[/:<>"|?*\s]/)
  })

  it('keeps the arXiv form distinguishable from a DOI', () => {
    expect(cardSlug('arXiv:2402.08954')).toBe('arXiv_2402.08954')
    expect(cardSlug('DOI:10.1038/s41586-021-03819-2')).toBe('DOI_10.1038_s41586-021-03819-2')
  })

  it('collapses runs and trims edges', () => {
    expect(cardSlug('  a//b::c  ')).toBe('a_b_c')
    expect(cardSlug('...weird...')).toBe('weird')
  })

  it('falls back to a stable hashed name when nothing is usable', () => {
    const a = cardSlug('***')
    const b = cardSlug('***')
    expect(a).toMatch(/^card_[0-9a-f]{8}$/)
    expect(a).toBe(b)
    expect(a).not.toBe(cardSlug('///'))
    expect(cardSlug('')).toMatch(/^card_[0-9a-f]{8}$/)
  })
})

describe('cardFilename / cardPath', () => {
  it('appends the .md extension', () => {
    expect(cardFilename('10.1063/1.3506838')).toBe('10.1063_1.3506838.md')
  })

  it('builds the workspace-relative card path under the configured output dir', () => {
    expect(cardPath('.scholar', '10.1103/jwmw-3lds')).toBe('.scholar/cards/10.1103_jwmw-3lds.md')
    expect(cardPath('out/', '10.1/x')).toBe('out/cards/10.1_x.md')
    expect(cardPath('', '10.1/x')).toBe('.scholar/cards/10.1_x.md')
  })
})

describe('cardIdentifier', () => {
  it('prefers the DOI', () => {
    expect(cardIdentifier({ externalIds: { DOI: '10.1/a', ArXiv: '2402.08954' }, paperId: 'p' })).toBe('10.1/a')
  })

  it('falls back to a prefixed arXiv id, then the paperId', () => {
    expect(cardIdentifier({ externalIds: { ArXiv: '2402.08954' }, paperId: 'p' })).toBe('arXiv:2402.08954')
    expect(cardIdentifier({ externalIds: {}, paperId: 'CorpusId:123' })).toBe('CorpusId:123')
  })

  it('returns undefined for an empty record', () => {
    expect(cardIdentifier(undefined)).toBeUndefined()
    expect(cardIdentifier({ externalIds: {} })).toBeUndefined()
  })
})
