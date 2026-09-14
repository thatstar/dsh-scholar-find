import { describe, expect, it } from 'vitest'
import { apaAuthor, CITATION_STYLES, footnoteBlock, formatReference, formatReferences, gbAuthor, ieeeAuthor, referenceMetaFromS2Paper } from '../src/cite.js'

const EPR = {
  authors: ['Albert Einstein', 'Boris Podolsky', 'Nathan Rosen', 'Paul Ehrenfest'],
  title: 'Can Quantum-Mechanical Description of Physical Reality Be Considered Complete?',
  venue: 'Physical Review',
  year: 1935,
  volume: '47',
  issue: '10',
  pages: '777-780',
  doi: '10.1103/PhysRev.47.777',
  type: 'journal' as const,
}

describe('name rendering', () => {
  it('renders family-first for GB/T 7714', () => {
    expect(gbAuthor('Albert Einstein')).toBe('EINSTEIN A')
    expect(gbAuthor('Y. Zhang')).toBe('ZHANG Y')
    expect(gbAuthor('张三')).toBe('张三')
  })

  it('renders initials-first for APA and IEEE', () => {
    expect(apaAuthor('Albert Einstein')).toBe('Einstein, A.')
    expect(ieeeAuthor('Albert Einstein')).toBe('A. Einstein')
  })
})

describe('formatReference', () => {
  it('emits a GB/T 7714-2015 journal entry with the [J] marker and 等 for >3 authors', () => {
    const entry = formatReference(EPR, 'gb-t-7714-2015')
    expect(entry).toContain('EINSTEIN A, PODOLSKY B, ROSEN N, 等.')
    expect(entry).toContain('[J]')
    expect(entry).toContain('Physical Review, 1935, 47(10): 777-780.')
    expect(entry).toContain('DOI: 10.1103/PhysRev.47.777.')
  })

  it('uses the [M]/[C] markers for books and conference papers', () => {
    expect(formatReference({ title: 'A book', type: 'book' }, 'gb-t-7714-2015')).toContain('[M]')
    expect(formatReference({ title: 'A paper', type: 'conference' }, 'gb-t-7714-2015')).toContain('[C]')
  })

  it('emits APA 7 with the ampersand and the DOI link', () => {
    const entry = formatReference(EPR, 'apa-7')
    expect(entry).toContain('Einstein, A., Podolsky, B., Rosen, N., & Ehrenfest, P.')
    expect(entry).toContain('(1935).')
    expect(entry).toContain('Physical Review, 47(10), 777-780.')
    expect(entry).toContain('https://doi.org/10.1103/PhysRev.47.777')
  })

  it('emits IEEE with the quoted title and vol/no/pp', () => {
    const entry = formatReference(EPR, 'ieee')
    expect(entry).toContain('"Can Quantum-Mechanical Description of Physical Reality Be Considered Complete?,"')
    expect(entry).toContain('vol. 47, no. 10, pp. 777-780, 1935.')
  })

  it('emits Nature with et al. and the year in parentheses', () => {
    const entry = formatReference(EPR, 'nature')
    expect(entry).toContain('Einstein, A., et al.')
    expect(entry).toContain('(1935).')
  })

  it('passes through supplied BibTeX and otherwise generates a valid entry', () => {
    expect(formatReference({ ...EPR, bibtex: '@article{x, title={T}}' }, 'bibtex')).toBe('@article{x, title={T}}')
    const generated = formatReference(EPR, 'bibtex')
    expect(generated).toContain('@article{Einstein1935Can,')
    expect(generated).toContain('author = {Albert Einstein and Boris Podolsky and Nathan Rosen and Paul Ehrenfest}')
    expect(generated).toContain('doi = {10.1103/PhysRev.47.777}')
  })

  it('degrades gracefully on sparse metadata', () => {
    expect(formatReference({ title: 'Bare title' }, 'gb-t-7714-2015')).toContain('Bare title')
    const apa = formatReference({ title: 'Bare title' }, 'apa-7')
    expect(apa).toContain('(n.d.)')
    expect(formatReference({}, 'ieee')).toContain('Untitled')
  })

  it('covers every declared style', () => {
    for (const style of CITATION_STYLES) {
      expect(formatReference(EPR, style).length, style).toBeGreaterThan(10)
    }
  })
})

describe('formatReferences / footnoteBlock', () => {
  it('numbers from startIndex in first-reference order', () => {
    const entries = formatReferences([{ title: 'A' }, { title: 'B' }], 'apa-7', 3)
    expect(entries.map((e) => e.index)).toEqual([3, 4])
  })

  it('separates definitions with a BLANK line (CommonMark paragraphs)', () => {
    const entries = formatReferences([{ title: 'A' }, { title: 'B' }], 'apa-7')
    const block = footnoteBlock(entries)
    const lines = block.split('\n')
    expect(lines[0]).toMatch(/^\[\^1\]: /)
    expect(lines[1]).toBe('')
    expect(lines[2]).toMatch(/^\[\^2\]: /)
  })

  it('keeps a single entry on one line even if the text wrapped', () => {
    const block = footnoteBlock(formatReferences([{ title: 'A\n multi-line title' }], 'nature'))
    expect(block.split('\n')).toHaveLength(1)
  })

  it('defaults startIndex to 1', () => {
    expect(formatReferences([{ title: 'A' }], 'ieee')[0]!.index).toBe(1)
  })
})

describe('referenceMetaFromS2Paper', () => {
  it('maps journal metadata, DOI and type', () => {
    const meta = referenceMetaFromS2Paper({
      title: 'T', year: 2021, authors: [{ name: 'A B' }, { name: 'C D' }],
      journal: { name: 'J. Test', volume: '1', pages: '2-3' },
      externalIds: { DOI: '10.1/x' }, publicationTypes: ['JournalArticle'],
    })
    expect(meta).toMatchObject({ title: 'T', year: 2021, authors: ['A B', 'C D'], venue: 'J. Test', volume: '1', pages: '2-3', doi: '10.1/x', type: 'journal' })
  })

  it('classifies books and conference papers', () => {
    expect(referenceMetaFromS2Paper({ publicationTypes: ['Book'] }).type).toBe('book')
    expect(referenceMetaFromS2Paper({ publicationTypes: ['Conference'] }).type).toBe('conference')
  })

  it('handles an empty record', () => {
    expect(referenceMetaFromS2Paper(null)).toEqual({})
  })
})
