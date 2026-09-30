/**
 * Tool-execution tests: the identity-verification surface (finding 4 of the
 * real-world report) — a DOI/paperId taken from a list result must never come
 * back as a confident record when it resolves to a different work.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFor, jsonResponse, makeScholarContext, runTool, stubFetch } from './harness.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('scholar_get_paper — expectedTitle verification', () => {
  it('flags a title mismatch and refuses to bless the identifier', async () => {
    stubFetch((url) => {
      expect(decodeURIComponent(url)).toContain('/paper/DOI:10.1063/1.3506838')
      return jsonResponse({ paperId: 'p1', title: 'Colloidal gelation of hard spheres', year: 2010, externalIds: { DOI: '10.1063/1.3506838' } })
    })
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_get_paper', {
      paperId: 'DOI:10.1063/1.3506838',
      expectedTitle: 'Homogeneous nucleation in metal liquids',
    })
    expect(out.verification).toBe('mismatch')
    expect(out.titleCheck).toMatchObject({ verdict: 'mismatch' })
    expect(out.titleCheck.expected).toBe('Homogeneous nucleation in metal liquids')
    expect(out.titleCheck.actual).toBe('Colloidal gelation of hard spheres')
    expect(out.markdown).toContain('Title mismatch')
    expect(out.markdown).toContain('Do **not** cite this identifier')
  })

  it('confirms the record when the titles agree', async () => {
    stubFetch(() => jsonResponse({ paperId: 'p1', title: 'Array programming with NumPy', externalIds: { DOI: '10.1038/s41586-020-2649-2' } }))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_get_paper', {
      paperId: 'DOI:10.1038/s41586-020-2649-2',
      expectedTitle: 'Array programming with NumPy',
    })
    expect(out.verification).toBe('match')
    expect(out.markdown).toContain('title verified')
    expect(out.markdown).not.toContain('Title mismatch')
  })

  it('reports `unverified` when no expectedTitle was supplied', async () => {
    stubFetch(() => jsonResponse({ paperId: 'p1', title: 'Something', externalIds: {} }))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_get_paper', { paperId: 'DOI:10.1/x' })
    expect(out.verification).toBe('unverified')
    expect(out.titleCheck).toBeUndefined()
  })
})

describe('scholar_match_title — refuses a confident wrong record', () => {
  it('returns matched:false when the best hit is a different work', async () => {
    stubFetch(() => jsonResponse({ data: [{ paperId: 'p2', title: 'Ice nucleation on mineral dust particles', externalIds: { DOI: '10.9999/ice' } }] }))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_match_title', { title: 'Homogeneous nucleation in metal liquids' })
    expect(out.matched).toBe(false)
    expect(out.titleCheck.verdict).toBe('mismatch')
    expect(out.markdown).toContain('No confident match')
    expect(out.markdown).toContain('10.9999/ice')
  })

  it('accepts a near-match (subtitle variant)', async () => {
    stubFetch(() => jsonResponse({
      data: [{ paperId: 'p3', title: 'Homogeneous nucleation in metal liquids: a molecular dynamics study', externalIds: { DOI: '10.1103/x' } }],
    }))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_match_title', { title: 'Homogeneous nucleation in metal liquids' })
    expect(out.matched).toBe(true)
    expect(out.titleCheck.verdict).toBe('near')
  })

  it('reports no match when the API returns nothing', async () => {
    stubFetch(() => jsonResponse({ data: [] }))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_match_title', { title: 'Nonexistent work' })
    expect(out.matched).toBe(false)
    expect(out.markdown).toContain('No Semantic Scholar match')
  })
})

describe('list-result identity caveat', () => {
  it('marks every compact list row unverified and warns in the markdown', async () => {
    stubFetch(() => jsonResponse({
      data: [{ paperId: 'a', title: 'A paper', externalIds: { DOI: '10.1/a' } }],
      total: 1,
    }))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_search_papers', { query: 'nucleation' })
    expect(out.results[0].verification).toBe('unverified')
    expect(out.markdown).toContain('**unverified**')
    expect(out.markdown).toContain('expectedTitle')
  })

  it('omits the caveat when no row carries an identifier', async () => {
    stubFetch(() => jsonResponse({ data: [{ paperId: 'a', title: 'No doi here' }], total: 1 }))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_search_papers', { query: 'x' })
    expect(out.markdown).not.toContain('**unverified**')
  })
})

describe('paper_fetch_* — expected title wiring', () => {
  it('flags a title mismatch in the resolve markdown', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://api.unpaywall.org/')) {
        return jsonResponse({ title: 'Colloidal gelation of hard spheres', year: 2010, journal_name: 'PRL', z_authors: [{ family: 'Doe' }], best_oa_location: { url_for_pdf: 'https://example.com/a.pdf' } })
      }
      if (url.startsWith('https://api.semanticscholar.org/')) return jsonResponse({ error: 'not found' }, 404)
      throw new Error(`unexpected fetch ${url}`)
    })
    const h = makeScholarContext({ unpaywallEmail: 'you@example.com' })
    const out = await runTool(h, 'paper_fetch_resolve', { doi: '10.1063/1.3506838', title: 'Homogeneous nucleation in metal liquids' })
    expect(out.data.ok).toBe(false)
    expect(out.data.result.error.code).toBe('title_mismatch')
    expect(out.markdown).toContain('title_mismatch')
    expect(out.markdown).toContain('pass the DOI')
  })
})

describe('citation/reference coverage + second source', () => {
  const CRED = { resolve: async () => ({ value: 'sciverse-token' }) }

  it('reports a reference list the graph does not serve as not_indexed (not empty)', async () => {
    stubFetch((url) => {
      if (url.includes('/references')) return jsonResponse({ offset: 0, data: [] })
      if (decodeURIComponent(url).includes('fields=title,citationCount,referenceCount')) return jsonResponse({ title: 'Big paper', citationCount: 244, referenceCount: 89 })
      return jsonResponse({ error: 'unexpected ' + url }, 404)
    })
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'scholar_get_references', { paperId: 'DOI:10.1038/s41586-020-2649-2' })
    expect(out.coverage.status).toBe('not_indexed')
    expect(out.coverage.seed_count).toBe(89)
    expect(out.markdown).toContain('NOT indexed')
    expect(out.total).toBe(0)
  })

  it('falls back to the Sciverse relations index when S2 serves nothing', async () => {
    stubFetch((url, init) => {
      if (url.includes('api.sciverse.space/meta-paper-relations')) {
        expect(String(init?.body)).toContain('"unique_id":"paper:10.1038/s41586-020-2649-2"')
        expect(String(init?.body)).toContain('REFERENCES')
        return jsonResponse({ total_count: 89, items: [{ id: '10.1/a', id_type: 'doi', title: 'A cited work' }] })
      }
      if (url.includes('/references')) return jsonResponse({ offset: 0, data: [] })
      if (decodeURIComponent(url).includes('fields=title,citationCount,referenceCount')) return jsonResponse({ title: 'Big paper', citationCount: 244, referenceCount: 89 })
      return jsonResponse({ error: 'unexpected ' + url }, 404)
    })
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'scholar_get_references', { paperId: 'DOI:10.1038/s41586-020-2649-2' })
    expect(out.fallback).toMatchObject({ source: 'sciverse', relation: 'REFERENCES', total: 89 })
    expect(out.fallback.items[0]).toMatchObject({ source: 'sciverse', title: 'A cited work' })
    expect(out.markdown).toContain('Sciverse fallback')
  })

  it('does not call the fallback without a Sciverse token', async () => {
    let sciverseCalls = 0
    stubFetch((url) => {
      if (url.includes('api.sciverse.space')) { sciverseCalls++; return jsonResponse({}) }
      if (url.includes('/references')) return jsonResponse({ offset: 0, data: [] })
      if (decodeURIComponent(url).includes('fields=title,citationCount,referenceCount')) return jsonResponse({ title: 'Big paper', citationCount: 244, referenceCount: 89 })
      return jsonResponse({ error: 'unexpected ' + url }, 404)
    })
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_get_references', { paperId: 'DOI:10.1038/s41586-020-2649-2' })
    expect(out.coverage.status).toBe('not_indexed')
    expect(out.fallback).toBeUndefined()
    expect(sciverseCalls).toBe(0)
  })

  it('labels a short list as partial rather than a total', async () => {
    stubFetch((url) => {
      if (url.includes('/citations')) return jsonResponse({ offset: 0, data: [{ citingPaper: { title: 'C1' } }, { citingPaper: { title: 'C2' } }] })
      if (decodeURIComponent(url).includes('fields=title,citationCount,referenceCount')) return jsonResponse({ title: 'P', citationCount: 244, referenceCount: 89 })
      return jsonResponse({ error: 'unexpected ' + url }, 404)
    })
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'scholar_get_citations', { paperId: 'DOI:10.1/x' })
    expect(out.coverage.status).toBe('partial')
    expect(out.markdown).toContain('2 of 244')
  })

  it('skips the extra count request with checkCoverage:false', async () => {
    let countCalls = 0
    stubFetch((url) => {
      if (decodeURIComponent(url).includes('fields=title,citationCount,referenceCount')) { countCalls++; return jsonResponse({ citationCount: 1, referenceCount: 1 }) }
      if (url.includes('/citations')) return jsonResponse({ offset: 0, data: [{ citingPaper: { title: 'C1' } }] })
      return jsonResponse({ error: 'unexpected ' + url }, 404)
    })
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_get_citations', { paperId: 'DOI:10.1/x', checkCoverage: false })
    expect(countCalls).toBe(0)
    expect(out.coverage.seed_count).toBeNull()
  })
})

describe('sciverse_read_content — doc_id fallback', () => {
  const CRED = { resolve: async () => ({ value: 'sciverse-token' }) }

  it('walks alternate doc_ids and reports which one answered', async () => {
    stubFetch((url) => {
      if (url.includes('/content?')) {
        const docId = new URL(url).searchParams.get('doc_id')
        if (docId === 'missing') return jsonResponse({ error: { biz_code: 12633, code: 'CONTENT_NOT_FOUND', message: '原文不存在' } }, 404)
        return jsonResponse({ text: 'The real full text.', bytes_returned: 19, next_offset: 19 })
      }
      return jsonResponse({ error: 'unexpected ' + url }, 404)
    })
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_read_content', { doc_id: 'missing', alt_doc_ids: ['good'] })
    expect(out.ok).toBe(true)
    expect(out.doc_id_used).toBe('good')
    expect(out.text).toBe('The real full text.')
    expect(out.attempts).toEqual([{ doc_id: 'missing', code: 'content_not_found', retryable: false }])
    expect(out.markdown).toContain('alternate doc_id')
  })

  it('always sends offset/limit and reports the API count field', async () => {
    let seen = ''
    stubFetch((url) => {
      if (url.includes('/content?')) {
        seen = url
        // Live-verified: the API answers with `bytes_returned` (older material
        // calls it `chars_returned`). A LONGER text than the reported count
        // makes the assertion discriminating: the pre-change code fell back to
        // text.length and would report 28 instead of 5.
        return jsonResponse({ text: 'a much longer slice text here', chars_returned: 5, next_offset: 5, more: false })
      }
      return jsonResponse({ error: 'unexpected ' + url }, 404)
    })
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_read_content', { doc_id: 'd1' })
    // An omitted offset makes the API return the whole document and ignore limit.
    expect(new URL(seen).searchParams.get('offset')).toBe('0')
    expect(new URL(seen).searchParams.get('limit')).toBe('4096')
    expect(out.bytes_returned).toBe(5)
    expect(out.next_offset).toBe(5)
    expect(out.markdown).toContain('bytes_returned`=5')
    // Only `more:true` invites a follow-up read.
    expect(out.markdown).not.toContain('continue with offset')
  })

  it('prefers bytes_returned over chars_returned (the live field)', async () => {
    stubFetch((url) => url.includes('/content?')
      ? jsonResponse({ text: 'abc', bytes_returned: 7, chars_returned: 5, next_offset: 7, more: true })
      : jsonResponse({ error: 'unexpected ' + url }, 404))
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_read_content', { doc_id: 'd1' })
    expect(out.bytes_returned).toBe(7)
    expect(out.markdown).toContain('continue with offset=7')
  })

  it('caps the doc_id walk at 3 and still returns a typed envelope', async () => {
    let calls = 0
    stubFetch((url) => {
      if (url.includes('/content?')) { calls++; return jsonResponse({ error: { code: 'CONTENT_NOT_FOUND', message: 'nope' } }, 404) }
      return jsonResponse({ error: 'unexpected ' + url }, 404)
    })
    const h = makeScholarContext({}, { credentials: { resolve: async () => ({ value: 't' }) } })
    const out = await runTool(h, 'sciverse_read_content', { doc_id: 'a', alt_doc_ids: ['b', 'c', 'd', 'e'] })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('content_not_found')
    expect(out.attempts).toHaveLength(3) // primary + 2 alternates at most
    expect(out.skipped_doc_ids).toEqual(['d', 'e']) // truncation is reported, not silent
    expect(out.markdown).toContain('were not tried')
    expect(calls).toBe(3)
  })

  it('stops the walk when the total budget is exhausted and reports it', async () => {
    let clock = 0
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock)
    try {
      stubFetch((url) => {
        if (url.includes('/content?')) {
          clock += 120_000 // this doc_id consumed the whole budget
          return jsonResponse({ error: { code: 'FETCH_FAILED', message: 'upstream' } }, 502)
        }
        return jsonResponse({ error: 'unexpected ' + url }, 404)
      })
      const h = makeScholarContext({}, { credentials: { resolve: async () => ({ value: 't' }) } })
      const out = await runTool(h, 'sciverse_read_content', { doc_id: 'a', alt_doc_ids: ['b'] })
      expect(out.ok).toBe(false)
      expect(out.attempts.map((a: any) => a.code)).toEqual(['content_fetch_failed', 'budget_exhausted'])
      expect(out.markdown).toContain('budget_exhausted')
    } finally {
      now.mockRestore()
    }
  })

  it('returns the typed envelope (not a bare error) when every doc_id fails', async () => {
    stubFetch((url) => {
      if (url.includes('/content?')) return jsonResponse({ error: { code: 'CONTENT_NOT_FOUND', message: 'nope' } }, 404)
      return jsonResponse({ error: 'unexpected ' + url }, 404)
    })
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_read_content', { doc_id: 'a', alt_doc_ids: ['b'] })
    expect(out.ok).toBe(false)
    expect(out.code).toBe('content_not_found')
    expect(out.retryable).toBe(false)
    expect(out.attempts).toHaveLength(2)
    expect(out.markdown).toContain('Tried 2 doc_ids')
  })
})

describe('sciverse_semantic_search — clamped top_k is echoed', () => {
  const CRED = { resolve: async () => ({ value: 't' }) }

  it('echoes the clamped value and omits the key when it was not supplied', async () => {
    stubFetch((url) => url.includes('/agentic-search')
      ? jsonResponse({ hits: [] })
      : jsonResponse({ error: 'unexpected ' + url }, 404))
    const h = makeScholarContext({}, { credentials: CRED })
    const clamped = await runTool(h, 'sciverse_semantic_search', { query: 'q', top_k: 500 })
    expect(clamped.top_k).toBe(100)
    const omitted = await runTool(h, 'sciverse_semantic_search', { query: 'q' })
    expect('top_k' in omitted).toBe(false)
  })
})

describe('sciverse_list_paper_relations — CITATIONS window pre-flight', () => {
  const CRED = { resolve: async () => ({ value: 't' }) }

  it('rejects a >10000 CITATIONS window without calling the gateway', async () => {
    const mock = stubFetch(() => jsonResponse({ items: [], total_count: 0 }))
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_list_paper_relations', { unique_id: 'paper:10.1/x', relation: 'CITATIONS', page: 500, page_size: 50 })
    expect(out.code).toBe('validation_error')
    expect(out.retryable).toBe(false)
    expect(out.markdown).toContain('10000')
    expect(mock).not.toHaveBeenCalled()
  })

  it('lets REFERENCES page past 10000 (the gateway allows it — live-verified)', async () => {
    const mock = stubFetch(() => jsonResponse({ items: [], total_count: 0 }))
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_list_paper_relations', { unique_id: 'paper:10.1/x', relation: 'REFERENCES', page: 500, page_size: 50 })
    expect(out.ok).toBe(true)
    expect(mock).toHaveBeenCalledTimes(1)
  })
})

describe('sciverse_list_paper_relations — rendering', () => {
  const CRED = { resolve: async () => ({ value: 't' }) }

  it('renders an empty-title OpenAlex reference row without an empty bold title', async () => {
    stubFetch(() => jsonResponse({
      total_count: 2,
      items: [
        { title: '', id: 'https://openalex.org/W6739901393', id_type: 'openalex' },
        { title: 'A real citing paper', id: 'paper:10.1/x', id_type: 'sciverse' },
      ],
    }))
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_list_paper_relations', { unique_id: 'paper:10.1/a', relation: 'REFERENCES', page_size: 2 })
    expect(out.markdown).not.toContain('****')
    expect(out.markdown).toContain('https://openalex.org/W6739901393')
    expect(out.markdown).toContain('_no title returned_')
    expect(out.markdown).toContain('**A real citing paper**')
  })
})

describe('sciverse_semantic_search — doc_id_index', () => {
  it('groups a paper that appears under several doc_ids', async () => {
    stubFetch((url) => {
      if (url.includes('/agentic-search')) {
        return jsonResponse({
          hits: [
            { title: 'Paper A', unique_id: 'paper:10.1/a', doc_id: 'd1', chunk: 'one', score: 0.9, offset: 0 },
            { title: 'Paper A', unique_id: 'paper:10.1/a', doc_id: 'd2', chunk: 'two', score: 0.8, offset: 10 },
          ],
        })
      }
      return jsonResponse({ error: 'unexpected ' + url }, 404)
    })
    const h = makeScholarContext({}, { credentials: { resolve: async () => ({ value: 't' }) } })
    const out = await runTool(h, 'sciverse_semantic_search', { query: 'x' })
    expect(out.doc_id_index).toEqual([{ paper_key: 'paper:10.1/a', title: 'Paper A', unique_id: 'paper:10.1/a', doc_ids: ['d1', 'd2'] }])
    expect(out.markdown).toContain('alt_doc_ids')
  })
})

describe('card library path', () => {
  it('returns the canonical card path for a DOI', async () => {
    stubFetch(() => jsonResponse({ paperId: 'p1', title: 'Array programming with NumPy', externalIds: { DOI: '10.1038/s41586-020-2649-2' } }))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_get_paper', { paperId: 'DOI:10.1038/s41586-020-2649-2' })
    expect(out.cardPath).toBe('.scholar/cards/10.1038_s41586-020-2649-2.md')
    expect(out.markdown).toContain('.scholar/cards/10.1038_s41586-020-2649-2.md')
  })

  it('follows the configured output dir and falls back to the arXiv id', async () => {
    stubFetch(() => jsonResponse({ data: [{ paperId: 'p2', title: 'A preprint', externalIds: { ArXiv: '2402.08954' } }] }))
    const h = makeScholarContext({ defaultOutputDir: 'notes/lib' })
    const out = await runTool(h, 'scholar_match_title', { title: 'A preprint' })
    expect(out.matched).toBe(true)
    expect(out.cardPath).toBe('notes/lib/cards/arXiv_2402.08954.md')
  })
})

describe('scholar_format_references', () => {
  const PAPERS = [
    { paperId: 'a', title: 'First work', year: 1935, authors: [{ name: 'Albert Einstein' }, { name: 'Boris Podolsky' }], journal: { name: 'Physical Review', volume: '47', pages: '777-780' }, externalIds: { DOI: '10.1103/PhysRev.47.777' }, publicationTypes: ['JournalArticle'] },
    { paperId: 'b', title: 'Second work', year: 2021, authors: [{ name: 'Jane Doe' }], venue: 'Nature', externalIds: { DOI: '10.1/y' } },
  ]

  it('resolves ids through S2 and emits the style entries plus a footnote block', async () => {
    stubFetch((url) => {
      if (url.includes('/paper/batch')) return jsonResponse(PAPERS)
      return jsonResponse({ error: 'unexpected ' + url }, 404)
    })
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_format_references', { ids: ['DOI:10.1103/PhysRev.47.777', 'DOI:10.1/y'], style: 'gb-t-7714-2015' })
    expect(out.count).toBe(2)
    expect(out.style).toBe('gb-t-7714-2015')
    expect(out.entries[0].text).toContain('EINSTEIN A, PODOLSKY B')
    expect(out.entries[0].text).toContain('[J]')
    expect(out.footnote_block).toContain('[^1]: ')
    expect(out.footnote_block.split('\n')[1]).toBe('')
    expect(out.markdown).toContain('FIRST-MENTION ONLY')
  })

  it('formats explicit items without touching the network', async () => {
    const fetchSpy = stubFetch(() => jsonResponse({ error: 'should not be called' }, 500))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_format_references', {
      items: [{ authors: ['Jane Doe'], title: 'A study', venue: 'Nature', year: 2020, doi: '10.1/x' }],
      style: 'apa-7',
      start_index: 4,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(out.entries[0].index).toBe(4)
    expect(out.entries[0].text).toContain('Doe, J.')
  })

  it('warns about ids with no record instead of dropping them silently', async () => {
    stubFetch((url) => (url.includes('/paper/batch') ? jsonResponse([PAPERS[1], null]) : jsonResponse({ error: 'x' }, 404)))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_format_references', { ids: ['10.1/y', '10.9/missing'], style: 'ieee' })
    expect(out.count).toBe(2)
    expect(out.warnings.join(' ')).toContain('10.9/missing')
  })

  it('refuses to format a batch row that is a different paper', async () => {
    // The batch endpoint mirrors request order, but a shifted row would attach
    // another paper's authors/title to this id — a fabricated citation.
    stubFetch((url) => (url.includes('/paper/batch')
      ? jsonResponse([{ paperId: 'z', title: 'A completely different work', externalIds: { DOI: '10.9999/other' } }])
      : jsonResponse({ error: 'x' }, 404)))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_format_references', { ids: ['DOI:10.1038/wanted'], style: 'apa-7' })
    expect(out.count).toBe(1)
    expect(out.entries[0].text).not.toContain('A completely different work')
    expect(out.entries[0].text).toContain('10.1038/wanted')
    expect(out.warnings.join(' ')).toContain('different record')
  })

  it('accepts a batch row whose identifier matches, and skips the check for unverifiable id forms', async () => {
    stubFetch((url) => (url.includes('/paper/batch')
      ? jsonResponse([
          { paperId: 'p1', title: 'Right paper', externalIds: { DOI: '10.1038/wanted' } },
          { paperId: 'p2', title: 'Corpus row', externalIds: {} },
        ])
      : jsonResponse({ error: 'x' }, 404)))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_format_references', { ids: ['DOI:10.1038/wanted', 'CorpusId:123'], style: 'ieee' })
    expect(out.warnings).toEqual([])
    expect(out.entries[0].text).toContain('Right paper')
    expect(out.entries[1].text).toContain('Corpus row')
  })

  it('validates the input and defaults the style', async () => {
    const h = makeScholarContext()
    const empty = await runTool(h, 'scholar_format_references', {})
    expect(empty.count).toBe(0)
    expect(empty.markdown).toContain('needs `ids` or `items`')

    const fetchSpy = stubFetch(() => jsonResponse({ error: 'no' }, 500))
    const fallback = await runTool(h, 'scholar_format_references', { items: [{ title: 'T', year: 2020 }] })
    expect(fallback.style).toBe('gb-t-7714-2015')
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('scholar_export_bibtex — unresolvable ids', () => {
  it('exports what resolved and reports the null row instead of throwing', async () => {
    // Live-verified: S2 /paper/batch answers `null` in the position it cannot
    // resolve (an earlier version threw on `null.citationStyles`).
    stubFetch(() => jsonResponse([
      { paperId: 'a', title: 'A', citationStyles: { bibtex: '@article{a, title={A}}' } },
      null,
    ]))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_export_bibtex', { ids: ['DOI:10.1/a', 'DOI:10.9999/nope'] })
    expect(out.count).toBe(1)
    expect(out.unresolved).toEqual(['DOI:10.9999/nope'])
    expect(out.bibtex).toContain('@article{a')
    const rendered = h.byName.get('scholar_export_bibtex')!.output.render({}, out) as Array<{ text?: string }>
    expect(rendered[0]?.text).toContain('not resolved by Semantic Scholar')
    expect(rendered[0]?.text).toContain('DOI:10.9999/nope')
  })

  it('counts only ids that produced an entry (a record without citationStyles is not a success)', async () => {
    stubFetch(() => jsonResponse([{ paperId: 'a', title: 'A' }])) // resolved, but no citationStyles
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_export_bibtex', { ids: ['DOI:10.1/a'] })
    expect(out.count).toBe(0)
    expect(out.unresolved).toEqual(['DOI:10.1/a'])
    expect(out.bibtex).toBe('')
    const rendered = h.byName.get('scholar_export_bibtex')!.output.render({}, out) as Array<{ text?: string }>
    expect(rendered[0]?.text).toContain('No BibTeX entries available.')
    expect(rendered[0]?.text).toContain('not resolved by Semantic Scholar')
  })

  it('still renders plain text when nothing resolved', async () => {
    stubFetch(() => jsonResponse([null]))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_export_bibtex', { ids: ['DOI:10.1/nope'] })
    const rendered = h.byName.get('scholar_export_bibtex')!.output.render({}, out) as Array<{ text?: string }>
    expect(out.count).toBe(0)
    expect(rendered[0]?.text).toContain('No BibTeX entries available.')
    expect(rendered[0]?.text).toContain('1 id(s) not resolved')
  })
})

describe('discovery triage (fields / OA / off-topic)', () => {
  function stubSearch(rows: unknown[]): void {
    stubFetch(() => jsonResponse({ data: rows, total: rows.length }))
  }

  it('carries venue, field-of-study and OA on every row and in the markdown', async () => {
    stubSearch([{ paperId: 'a', title: 'Metal-liquid nucleation', venue: 'PRL', year: 2020, externalIds: { DOI: '10.1/a' }, fieldsOfStudy: ['Materials Science'], isOpenAccess: true, publicationTypes: ['JournalArticle'] }])
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_search_papers', { query: 'metal-liquid nucleation' })
    expect(out.results[0]).toMatchObject({ fieldsOfStudy: ['Materials Science'], isOpenAccess: true, publicationTypes: ['JournalArticle'] })
    expect(out.markdown).toContain('**Fields:** Materials Science')
    expect(out.markdown).toContain('**Open access:** yes')
  })

  it('flags a narrow query\'s zero-overlap hits without dropping them', async () => {
    stubSearch([
      { paperId: 'a', title: 'Metal-liquid nucleation kinetics', externalIds: { DOI: '10.1/a' } },
      { paperId: 'b', title: 'Deep learning for polymer informatics', externalIds: { DOI: '10.1/b' } },
    ])
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_search_papers', { query: 'metal-liquid nucleation' })
    expect(out.offTopic).toBe(1)
    expect(out.results.map((r: any) => r.offTopic)).toEqual([false, true])
    expect(out.total).toBe(2)
    expect(out.markdown).toContain('flagged `offTopic`')
  })

  it('drops them only with strictTopic:true', async () => {
    stubSearch([
      { paperId: 'a', title: 'Metal-liquid nucleation kinetics', externalIds: { DOI: '10.1/a' } },
      { paperId: 'b', title: 'Deep learning for polymer informatics', externalIds: { DOI: '10.1/b' } },
    ])
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_search_papers', { query: 'metal-liquid nucleation', strictTopic: true })
    expect(out.total).toBe(1)
    expect(out.results).toHaveLength(1)
    expect(out.markdown).toContain('already dropped')
  })

  it('does not flag anything for a broad query', async () => {
    stubSearch([{ paperId: 'b', title: 'Deep learning for polymer informatics', externalIds: { DOI: '10.1/b' } }])
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_search_papers', { query: 'crystallization' })
    expect(out.offTopic).toBe(0)
    expect(out.results[0].offTopic).toBe(false)
  })
})

describe('sciverse_search_papers triage', () => {
  const CRED = { resolve: async () => ({ value: 't' }) }

  it('renders the default OA + venue-type evidence', async () => {
    // Shape mirrors a real /meta-search row (live-verified: access_is_oa and
    // publication_venue_type are part of the default response).
    stubFetch(() => jsonResponse({
      total_count: 1,
      results: [{
        unique_id: 'paper:10.1/a', title: 'A paper', publication_published_year: 2021,
        publication_venue_name_unified: 'J. Test', doi: '10.1/a', access_is_oa: false,
        publication_venue_type: 'journal', metadata_type: 'paper',
      }],
    }))
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_search_papers', { query: 'nucleation' })
    expect(out.markdown).toContain('closed · journal')
  })

  it('unions a requested projection with the identity fields (upstream projection is replacive)', async () => {
    let body: any
    stubFetch((_url, init) => {
      body = JSON.parse(String(init?.body))
      return jsonResponse({ total_count: 1, results: [{ unique_id: 'paper:10.1/a', title: 'A paper', doi: '10.1/a', primary_topic: { display_name: 'Nucleation' }, access_is_oa: true }] })
    })
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_search_papers', { query: 'nucleation', fields: ['primary_topic'] })
    // The caller's field survives AND the identity fields are unioned back in.
    expect(body.fields).toContain('primary_topic')
    expect(body.fields).toEqual(expect.arrayContaining(['unique_id', 'title', 'doi', 'author', 'doc_id']))
    expect(out.markdown).toContain('OA · Nucleation')
  })

  it('leaves an unprojected call unprojected (no fields in the request body)', async () => {
    let body: any
    stubFetch((_url, init) => {
      body = JSON.parse(String(init?.body))
      return jsonResponse({ total_count: 1, results: [{ unique_id: 'paper:10.1/a', title: 'A paper', access_is_oa: true, abstract: 'kept' }] })
    })
    const h = makeScholarContext({}, { credentials: CRED })
    await runTool(h, 'sciverse_search_papers', { query: 'nucleation' })
    expect(body.fields).toBeUndefined()
  })

  it('never renders the literal string "undefined" for a row without an id', async () => {
    stubFetch(() => jsonResponse({ total_count: 1, results: [{ title: 'Anonymous row' }] }))
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_search_papers', { query: 'x' })
    expect(out.markdown).not.toContain('undefined')
    expect(out.markdown).toContain('no id returned')
  })

  it('renders the live string-shaped access_is_oa evidence (not a JSON boolean)', async () => {
    // Live-verified row shape: access_is_oa is the STRING "false"/"true"/"unknown",
    // access_oa_status carries the readable value, and `type` is an array.
    stubFetch(() => jsonResponse({
      total_count: 2,
      results: [
        { unique_id: 'paper:10.1/closed', title: 'Closed work', access_is_oa: 'false', access_oa_status: 'closed', publication_venue_type: 'journal', type: ['article'] },
        { unique_id: 'paper:10.1/open', title: 'Open work', access_is_oa: 'true', access_oa_status: 'gold', publication_venue_type: 'journal' },
      ],
    }))
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_search_papers', { query: 'nucleation' })
    expect(out.markdown).toContain('closed · journal')
    // R16: keep the specific OA flavour instead of collapsing it to a bare "OA".
    expect(out.markdown).toContain('OA (gold) · journal')
  })

  it('rejects a page window above 10000 with a typed validation error (no API call)', async () => {
    const mock = stubFetch(() => jsonResponse({ total_count: 1, results: [] }))
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_search_papers', { query: 'graphene', page: 500, page_size: 50 })
    expect(out.code).toBe('validation_error')
    expect(out.retryable).toBe(false)
    expect(out.markdown).toContain('25000')
    expect(out.markdown).toContain('10000')
    expect(mock).not.toHaveBeenCalled()
  })

  it('renders authors-collection rows instead of paper-shaped "untitled" rows', async () => {
    // Live-verified row shape (collection=authors): display_name, summary_stats.h_index,
    // an OpenAlex `id`, and NO unique_id.
    stubFetch(() => jsonResponse({
      total_count: 1,
      results: [{
        works_count: 2, id: 'https://openalex.org/A5007174815', display_name: 'James Hinton Hinton',
        cited_by_count: 0, last_known_institutions: [], summary_stats: { h_index: 0, i10_index: 0 },
        orcid: '', relevance_score: 7.47,
      }],
    }))
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_search_papers', { collection: 'authors', query: 'hinton' })
    expect(out.markdown).toContain('James Hinton Hinton')
    expect(out.markdown).toContain('0 h-index')
    expect(out.markdown).toContain('2 works')
    expect(out.markdown).toContain('https://openalex.org/A5007174815')
    expect(out.markdown).toContain('1 authors')
    expect(out.markdown).not.toContain('untitled')
  })

  it('renders sources-collection rows (issn array / issn_l, is_oa) ', async () => {
    // Live-verified row shape (collection=sources).
    stubFetch(() => jsonResponse({
      total_count: 1,
      results: [{
        is_core: true, works_count: 447855, type: 'journal', id: 'https://openalex.org/S137773608',
        issn: ['0028-0836', '1476-4687'], issn_l: '0028-0836', host_organization_name: 'Nature Portfolio',
        display_name: 'Nature', cited_by_count: 26663584, is_oa: false,
      }],
    }))
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_search_papers', { collection: 'sources', query: 'nature' })
    expect(out.markdown).toContain('Nature')
    expect(out.markdown).toContain('ISSN 0028-0836')
    expect(out.markdown).toContain('closed')
    expect(out.markdown).toContain('447855 works')
    expect(out.markdown).not.toContain('untitled')
  })

  it('falls back to a row\'s scalar evidence when an entity row has no known name field', async () => {
    stubFetch(() => jsonResponse({ total_count: 1, results: [{ some_source_field: 'ISSN 1234-5678', inst_id: 'S1' }] }))
    const h = makeScholarContext({}, { credentials: CRED })
    const out = await runTool(h, 'sciverse_search_papers', { collection: 'sources', query: 'x' })
    expect(out.markdown).toContain('source row')
    expect(out.markdown).toContain('some_source_field: ISSN 1234-5678')
    expect(out.markdown).not.toContain('untitled')
    expect(out.markdown).not.toContain('no id returned')
  })
})

describe('harness sanity', () => {
  it('exposes the workspace cwd to tools', async () => {
    stubFetch(() => jsonResponse({ paperId: 'p', title: 'T', externalIds: {} }))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_list_library', {}, execFor('/tmp/ws-x'))
    expect(out.root).toBe('/tmp/ws-x/.scholar')
  })
})
