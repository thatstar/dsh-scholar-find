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

describe('harness sanity', () => {
  it('exposes the workspace cwd to tools', async () => {
    stubFetch(() => jsonResponse({ paperId: 'p', title: 'T', externalIds: {} }))
    const h = makeScholarContext()
    const out = await runTool(h, 'scholar_list_library', {}, execFor('/tmp/ws-x'))
    expect(out.root).toBe('/tmp/ws-x/.scholar')
  })
})
