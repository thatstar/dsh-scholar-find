import { describe, expect, it } from 'vitest'
import {
  CARD_HEADERS,
  cardIsComplete,
  citationKeyFromLine,
  citationLine,
  evidenceLine,
  mergeCard,
  parseCard,
  renderNewCard,
  summarizeCard,
  type CardMeta,
} from '../src/cardstore.js'

const DATE = '2026-02-12'

const META: CardMeta = {
  identifier: '10.1/x',
  title: 'A study of things',
  authors: ['Ada Lovelace', 'Alan Turing', 'Grace Hopper', 'Barbara Liskov'],
  year: 2020,
  venue: 'Journal of Things',
  abstract: 'We study things.',
  keywords: ['things', 'studies'],
}

const entry = (title: string, doi?: string, year = 1999) => ({ title, doi, year, authors: ['Someone Else'] })

const cite = (entries: ReturnType<typeof entry>[], coverage = '2 of 2 references') => ({ entries, coverage })

/** Occurrences of a substring — used to prove a merge appended instead of duplicating. */
const count = (text: string, needle: string): number => text.split(needle).length - 1

describe('renderNewCard / parseCard', () => {
  it('renders every section the memory skill defines', () => {
    const card = renderNewCard(META, DATE)
    for (const header of Object.values(CARD_HEADERS)) expect(card).toContain(header)
    expect(card).toContain('# DOI: 10.1/x')
    expect(card).toContain('- **Authors**: Ada Lovelace, Alan Turing, Grace Hopper et al.')
    expect(card).toContain('- **Keywords**: things, studies')
    // Both citation sections start on the placeholder seed, as the skill requires.
    expect(card.match(/^-\n/gm)).toHaveLength(2)
  })

  it('round-trips the fields it renders', () => {
    const parsed = parseCard(renderNewCard(META, DATE))
    expect(parsed.recognized).toBe(true)
    expect(parsed.identifier).toBe('10.1/x')
    expect(parsed.title).toBe('A study of things')
    expect(parsed.authors).toEqual(['Ada Lovelace', 'Alan Turing', 'Grace Hopper'])
    expect(parsed.year).toBe('2020')
    expect(parsed.venue).toBe('Journal of Things')
    expect(parsed.keywords).toEqual(['things', 'studies'])
    expect(parsed.backtrack).toEqual([])
    expect(parsed.evidence).toEqual([])
  })

  it('reports unrecognized files instead of treating them as cards', () => {
    const parsed = parseCard('# just a note\n\nsome prose\n')
    expect(parsed.recognized).toBe(false)
    expect(cardIsComplete(parsed)).toBe(false)
    expect(summarizeCard('# just a note\n', 'note.md').recognized).toBe(false)
  })
})

describe('evidence lines', () => {
  it('binds doc_id, offset, page and the verbatim quote', () => {
    const line = evidenceLine({ quote: 'the flux  was  42', docId: 'abc123', offset: 12, page: 3, finding: 'baseline' }, '10.1/x', DATE)
    expect(line).toBe('- [abc123 | offset 12 | page 3] "the flux  was  42" — baseline (2026-02-12)')
  })

  it('names a source even with no doc_id (arXiv / local PDF reads)', () => {
    expect(evidenceLine({ quote: 'q', source: 'arXiv:2402.08954', page: 7 }, '10.1/x', DATE))
      .toBe('- [arXiv:2402.08954 | page 7] "q" (2026-02-12)')
    // No doc_id AND no explicit source: the card's own identifier is the source,
    // never a bare "[offset 3]" that names nothing.
    expect(evidenceLine({ quote: 'q', offset: 3 }, '10.1/x', DATE)).toBe('- [10.1/x | offset 3] "q" (2026-02-12)')
  })
})

describe('mergeCard — create', () => {
  it('creates a complete card from one call', () => {
    const { markdown, created, delta } = mergeCard(undefined, {
      meta: META,
      evidence: [{ quote: 'quoted text', docId: 'd1', offset: 30, finding: 'the key result' }],
      backtrack: cite([entry('Ref A', '10.2/a'), entry('Ref B', '10.2/b')]),
      forwardtrack: cite([entry('Cite A', '10.3/a')], '1 citing paper'),
    }, DATE)
    expect(created).toBe(true)
    expect(delta).toMatchObject({ evidence: 1, backtrack: 2, forwardtrack: 1, evaluation: 0 })
    expect(markdown).toContain(`# DOI: 10.1/x`)
    expect(markdown).toContain('- [d1 | offset 30] "quoted text" — the key result (2026-02-12)')
    expect(markdown).toContain('- Ref A (1999). Someone Else. DOI: 10.2/a')
    expect(markdown).toContain('- coverage: 2 of 2 references')
    // The seed is consumed, not left behind next to real entries.
    expect(markdown).not.toMatch(/^-\n/m)
    expect(cardIsComplete(parseCard(markdown))).toBe(true)
  })

  it('records a zero-row answer explicitly instead of leaving the seed blank', () => {
    const { markdown } = mergeCard(undefined, {
      meta: META,
      evidence: [{ quote: 'q', docId: 'd1' }],
      backtrack: { entries: [], coverage: 'the record reports 89 references but the API serves none — the list is NOT indexed, not empty' },
      forwardtrack: { entries: [], coverage: 'no citing papers (the record reports none)' },
    }, DATE)
    expect(markdown).toContain('- no citation data (S2: the record reports 89 references')
    expect(markdown).toContain('- no citation data (S2: no citing papers')
    // An explicit no-data line counts as populated: the completeness rule is
    // about honesty, not about having rows.
    expect(cardIsComplete(parseCard(markdown))).toBe(true)
  })

  it('is incomplete without evidence or without a citation section', () => {
    const noEvidence = mergeCard(undefined, { meta: META, backtrack: cite([entry('A', '10.2/a')]), forwardtrack: cite([entry('B', '10.3/b')]) }, DATE)
    expect(cardIsComplete(parseCard(noEvidence.markdown))).toBe(false)
    const noCitations = mergeCard(undefined, { meta: META, evidence: [{ quote: 'q', docId: 'd1' }] }, DATE)
    expect(cardIsComplete(parseCard(noCitations.markdown))).toBe(false)
  })
})

describe('mergeCard — append-only update', () => {
  const base = mergeCard(undefined, {
    meta: META,
    evidence: [{ quote: 'first quote', docId: 'd1', offset: 1 }],
    backtrack: cite([entry('Ref A', '10.2/a')]),
    forwardtrack: cite([entry('Cite A', '10.3/a')]),
  }, DATE).markdown

  it('appends new rows and never re-adds an existing one', () => {
    const second = mergeCard(base, {
      meta: META,
      evidence: [{ quote: 'first quote', docId: 'd1', offset: 1 }, { quote: 'second quote', docId: 'd2', offset: 9 }],
      backtrack: cite([entry('Ref A', '10.2/a'), entry('Ref B', '10.2/b')]),
      forwardtrack: cite([entry('Cite A', '10.3/a')]),
    }, DATE)
    expect(second.created).toBe(false)
    expect(second.delta.evidence).toBe(1)
    expect(second.delta.backtrack).toBe(1)
    expect(second.delta.forwardtrack).toBe(0)
    expect(second.delta.duplicates).toBe(3)
    expect(count(second.markdown, 'first quote')).toBe(1)
    expect(count(second.markdown, 'Ref A (1999)')).toBe(1)
    expect(second.markdown).toContain('second quote')
    expect(second.markdown).toContain('Ref B (1999)')
  })

  it('dedupes citation rows by DOI, not by the rendered line', () => {
    const first = mergeCard(base, { meta: META, backtrack: cite([entry('Ref A renamed', '10.2/a')]) }, DATE)
    expect(first.delta.backtrack).toBe(0)
    expect(count(first.markdown, 'Ref A')).toBe(1)
  })

  it('keeps every byte it does not own (prose, notes, extra headings)', () => {
    const withNote = `${base}\n## Session notes\n- a hand-written remark\n`
    const after = mergeCard(withNote, { meta: META, evidence: [{ quote: 'fresh', docId: 'd9' }] }, DATE)
    expect(after.markdown).toContain('## Session notes\n- a hand-written remark')
    expect(after.markdown).toContain('fresh')
  })

  it('refreshes the single coverage status line in place and completes the keywords', () => {
    const after = mergeCard(base, {
      meta: { ...META, keywords: ['things', 'studies', 'memory'] },
      backtrack: cite([entry('Ref C', '10.2/c')], 'updated label: 3 of 3 references'),
      forwardtrack: cite([entry('Cite A', '10.3/a')]),
    }, DATE)
    expect(after.delta.keywords).toBe(true)
    expect(after.markdown).toContain('memory')
    expect(after.markdown).toContain('- coverage: updated label: 3 of 3 references')
    expect(count(after.markdown, '- coverage:')).toBe(2) // one per citation section
    expect(count(after.markdown, '**Keywords**')).toBe(1)
  })

  it('backfills a Basic Information hole but never overwrites a recorded value', () => {
    const blank = renderNewCard({ identifier: '10.1/x' }, DATE)
    const filled = mergeCard(blank, { meta: { ...META, title: 'A study of things' } }, DATE).markdown
    expect(filled).toContain('- **Title**: A study of things')
    const kept = mergeCard(filled, { meta: { ...META, title: 'A DIFFERENT TITLE' } }, DATE).markdown
    expect(kept).toContain('- **Title**: A study of things')
    expect(kept).not.toContain('A DIFFERENT TITLE')
  })

  it('appends the evaluation line it is given', () => {
    const after = mergeCard(base, { meta: META, evaluation: '- [v2 | 2026-02-13] re-checked via scholar_card_save' }, DATE)
    expect(after.delta.evaluation).toBe(1)
    expect(after.markdown).toContain('- [v2 | 2026-02-13] re-checked via scholar_card_save')
    expect(after.markdown).toContain('- [v1 | 2026-02-12] card created')
  })
})

describe('citationLine / keys / summary', () => {
  it('renders a stable one-line entry and a recoverable dedupe key', () => {
    const line = citationLine({ title: 'Deep things', year: 2021, authors: ['A B'], doi: '10.5/Z' })
    expect(line).toBe('- Deep things (2021). A B. DOI: 10.5/Z')
    expect(citationKeyFromLine(line)).toBe('doi:10.5/z')
    expect(citationKeyFromLine('- No DOI here (2001). X.')).toBe('title:no doi here')
  })

  it('summarizes a card for the report-time recall', () => {
    const markdown = mergeCard(undefined, {
      meta: META,
      evidence: [{ quote: 'q1', docId: 'd1' }, { quote: 'q2', docId: 'd2' }],
      backtrack: cite([entry('Ref A', '10.2/a')]),
      forwardtrack: cite([entry('Cite A', '10.3/a')]),
    }, DATE).markdown
    const s = summarizeCard(markdown, '10.1_x.md')
    expect(s).toMatchObject({ file: '10.1_x.md', identifier: '10.1/x', title: 'A study of things', evidence: 2, backtrack: 1, forwardtrack: 1, complete: true, recognized: true })
    expect(s.keywords).toEqual(['things', 'studies'])
    expect(s.lastEvaluation).toContain('card created')
  })

  it('does not count a prose bullet in the evidence tally', () => {
    const withProse = renderNewCard(META, DATE).replace('## Evidence List', '## Evidence List\n- a note that is not evidence')
    expect(summarizeCard(withProse, 'x.md').evidence).toBe(0)
  })
})
