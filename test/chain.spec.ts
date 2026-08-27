import { afterEach, describe, expect, it, vi } from 'vitest'
import { createScholarClient } from '../src/s2/client.js'
import type { ScholarClient } from '../src/s2/client.js'
import { resolveChain, resolveTitle, extractScihubPdf, landingPdfUrl } from '../src/fetch/chain.js'
import type { ChainContext } from '../src/fetch/chain.js'

const fetchMock = vi.fn()

afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => handler(url, init))
  vi.stubGlobal('fetch', fetchMock)
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function baseCtx(overrides: Partial<ChainContext> = {}): ChainContext {
  const s2: ScholarClient = createScholarClient({ minGapMs: 1, timeoutMs: 5000 })
  return {
    doi: '10.1038/s41586-021-03819-2',
    email: 'you@example.com',
    s2,
    institutional: false,
    scihubEnabled: false,
    scihubMirrors: '',
    timeoutMs: 5000,
    ...overrides,
  }
}

describe('resolveChain', () => {
  it('takes the Unpaywall hit and merges metadata', async () => {
    const unpaywallBody = {
      title: 'Highly accurate protein structure prediction with AlphaFold',
      year: 2021,
      journal_name: 'Nature',
      z_authors: [{ family: 'Jumper' }],
      best_oa_location: { url_for_pdf: 'https://www.nature.com/articles/s41586-021-03819-2.pdf' },
    }
    stubFetch((url) => {
      if (url.startsWith('https://api.unpaywall.org/')) return jsonResponse(unpaywallBody)
      if (url.startsWith('https://api.semanticscholar.org/')) return jsonResponse({ error: 'not found' }, 404)
      throw new Error(`unexpected fetch ${url}`)
    })
    const { candidates, sourcesTried, meta } = await resolveChain(baseCtx())
    expect(candidates[0]).toMatchObject({ source: 'unpaywall', pdfUrl: 'https://www.nature.com/articles/s41586-021-03819-2.pdf' })
    expect(meta.title).toBe('Highly accurate protein structure prediction with AlphaFold')
    expect(meta.author).toBe('Jumper')
    expect(sourcesTried).toContain('unpaywall')
    // enrichment: meta unchanged because unpaywall already had it
    expect(sourcesTried).not.toContain('semantic_scholar')
  })

  it('derives an arXiv candidate from an Unpaywall abs landing URL (no url_for_pdf)', async () => {
    const unpaywallBody = {
      title: 'Curriculum Learning: A Survey',
      year: 2022,
      journal_name: 'International Journal of Computer Vision',
      is_oa: true,
      best_oa_location: { url: 'https://arxiv.org/abs/arXiv:2101.10382', url_for_landing_page: 'https://arxiv.org/abs/arXiv:2101.10382', host_type: 'repository', version: 'submittedVersion' },
      oa_locations: [{ url: 'https://arxiv.org/abs/arXiv:2101.10382', url_for_landing_page: 'https://arxiv.org/abs/arXiv:2101.10382', host_type: 'repository' }],
    }
    stubFetch((url) => {
      if (url.startsWith('https://api.unpaywall.org/')) return jsonResponse(unpaywallBody)
      if (url.startsWith('https://api.semanticscholar.org/')) return jsonResponse({ error: 'not found' }, 404)
      throw new Error(`unexpected fetch ${url}`)
    })
    const { candidates, sourcesTried, meta } = await resolveChain(baseCtx())
    expect(sourcesTried).toContain('unpaywall')
    expect(sourcesTried).not.toContain('unpaywall skipped')
    expect(candidates.map((c) => c.source)).toContain('unpaywall')
    expect(candidates[0]!.pdfUrl).toBe('https://arxiv.org/pdf/2101.10382.pdf')
    expect(meta.title).toBe('Curriculum Learning: A Survey')
  })

  it('discovers a PDF from a non-arXiv OA landing page via citation_pdf_url', async () => {
    // A repository (e.g. ChemRxiv-like) landing page is JS-free enough to carry
    // the citation_pdf_url meta tag; the resolver should find it, not assume
    // the host is arXiv.
    stubFetch(() => new Response(
      '<html><head><meta name="citation_pdf_url" content="https://chemrxiv.org/engage/api-gateway/chemrxiv/assets/download/abc123.pdf"></head></html>',
      { status: 200, headers: { 'Content-Type': 'text/html' } },
    ))
    const pdf = await landingPdfUrl('https://chemrxiv.org/engage/chemrxiv/article-details/123', 5000, undefined, { checkDns: false })
    expect(pdf).toBe('https://chemrxiv.org/engage/api-gateway/chemrxiv/assets/download/abc123.pdf')
  })

  it('skips Unpaywall without email and falls through to arXiv via externalIds', async () => {
    const s2Body = {
      title: 'Attention Is All You Need',
      year: 2017,
      venue: 'NeurIPS',
      authors: [{ name: 'Vaswani' }],
      openAccessPdf: {},
      externalIds: { ArXiv: '1706.03762' },
    }
    stubFetch((url) => {
      if (url.startsWith('https://api.semanticscholar.org/')) return jsonResponse(s2Body)
      throw new Error(`unexpected fetch ${url}`)
    })
    const { candidates, sourcesTried, meta } = await resolveChain(baseCtx({ email: '', doi: '10.48550/arXiv.1706.03762' }))
    expect(sourcesTried[0]).toContain('skipped')
    expect(candidates.map((c) => c.source)).toEqual(['arxiv'])
    expect(candidates[0]!.pdfUrl).toBe('https://arxiv.org/pdf/1706.03762.pdf')
    expect(meta.year).toBe(2017)
  })

  it('adds Europe PMC and PMC candidates from PMCID', async () => {
    // s2's openAccessPdf points at a publisher URL (not PMC), so PMC-based
    // candidates are distinct URLs and all join the list.
    const s2Body = {
      externalIds: { PubMedCentral: 'PMC7123456' },
      openAccessPdf: { url: 'https://www.nature.com/articles/s41586-021-03819-2.pdf' },
    }
    stubFetch((url) => {
      if (url.startsWith('https://api.semanticscholar.org/')) return jsonResponse(s2Body)
      throw new Error(`unexpected fetch ${url}`)
    })
    const { candidates } = await resolveChain(baseCtx({ email: '' }))
    const sources = candidates.map((c) => c.source)
    expect(sources).toContain('semantic_scholar')
    expect(sources).toContain('europe_pmc')
    expect(sources).toContain('pmc')
    expect(candidates.find((c) => c.source === 'europe_pmc')!.pdfUrl).toBe('https://europepmc.org/articles/PMC7123456?pdf=render')
  })

  it('queries bioRxiv for 10.1101 DOIs', async () => {
    const biorxivBody = { collection: [{ doi: '10.1101/2020.01.01.123456', version: 2 }] }
    stubFetch((url) => {
      if (url.startsWith('https://api.biorxiv.org/')) return jsonResponse(biorxivBody)
      if (url.startsWith('https://api.semanticscholar.org/')) return jsonResponse({ error: 'nf' }, 404)
      throw new Error(`unexpected fetch ${url}`)
    })
    const { candidates, sourcesTried } = await resolveChain(baseCtx({ email: '', doi: '10.1101/2020.01.01.123456' }))
    expect(sourcesTried).toContain('biorxiv')
    expect(candidates.find((c) => c.source === 'biorxiv')!.pdfUrl).toBe('https://www.biorxiv.org/content/10.1101/2020.01.01.123456v2.full.pdf')
  })

  it('reports not_found-ish empty candidates when every source misses', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://api.unpaywall.org/')) return jsonResponse({ best_oa_location: null })
      if (url.startsWith('https://api.semanticscholar.org/')) return jsonResponse({ error: 'not found' }, 404)
      throw new Error(`unexpected fetch ${url}`)
    })
    const { candidates } = await resolveChain(baseCtx())
    expect(candidates).toHaveLength(0)
  })
})

describe('resolveTitle', () => {
  it('accepts a confident Crossref match', async () => {
    const crossrefBody = {
      message: {
        items: [
          { DOI: '10.1038/s41586-021-03819-2', title: ['Highly accurate protein structure prediction with AlphaFold'], score: 90.1, issued: { 'date-parts': [[2021]] } },
          { DOI: '10.9999/x', title: ['Other'], score: 10.0 },
        ],
      },
    }
    stubFetch((url) => {
      if (url.startsWith('https://api.crossref.org/')) return jsonResponse(crossrefBody)
      throw new Error(`unexpected fetch ${url}`)
    })
    const client = createScholarClient({ minGapMs: 1 })
    const { doi, resolution } = await resolveTitle('Highly accurate protein structure prediction with AlphaFold', { email: 'you@example.com', s2: client, timeoutMs: 5000 })
    expect(doi).toBe('10.1038/s41586-021-03819-2')
    expect(resolution.lowConfidence).toBe(false)
    expect(resolution.resolver).toBe('crossref')
  })

  it('falls back to Semantic Scholar for arXiv-only papers and synthesizes the arXiv DOI', async () => {
    stubFetch((url) => {
      if (url.startsWith('https://api.crossref.org/')) return jsonResponse({ message: { items: [] } })
      if (url.startsWith('https://api.semanticscholar.org/')) {
        return jsonResponse({ data: [{ title: 'Attention Is All You Need', year: 2017, authors: [{ name: 'Vaswani' }], venue: 'NeurIPS', externalIds: { ArXiv: '1706.03762' } }] })
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    const client = createScholarClient({ minGapMs: 1 })
    const { doi, resolution } = await resolveTitle('Attention Is All You Need', { email: '', s2: client, timeoutMs: 5000 })
    expect(doi).toBe('10.48550/arXiv.1706.03762')
    expect(resolution.resolver).toBe('semantic_scholar')
  })

  it('flags low confidence when Crossref score is weak and S2 misses', async () => {
    const crossrefBody = {
      message: {
        items: [{ DOI: '10.9999/weak', title: ['Some Paper'], score: 12.0 }],
      },
    }
    stubFetch((url) => {
      if (url.startsWith('https://api.crossref.org/')) return jsonResponse(crossrefBody)
      if (url.startsWith('https://api.semanticscholar.org/')) return jsonResponse({ data: [] })
      throw new Error(`unexpected fetch ${url}`)
    })
    const client = createScholarClient({ minGapMs: 1 })
    const { doi, resolution } = await resolveTitle('Some Paper', { email: '', s2: client, timeoutMs: 5000 })
    expect(doi).toBe('10.9999/weak')
    expect(resolution.lowConfidence).toBe(true)
    expect(resolution.lowConfidenceReason).toBe('score_below_threshold')
  })
})

describe('extractScihubPdf', () => {
  it('extracts iframe srcs, relative against the mirror base', () => {
    const html = '<html><iframe id="pdf" src="/downloads/abc123.pdf"></iframe></html>'
    expect(extractScihubPdf(html, 'https://sci-hub.ru')).toBe('https://sci-hub.ru/downloads/abc123.pdf')
  })

  it('handles protocol-relative srcs', () => {
    const html = '<embed src="//cdn.example.com/x.pdf">'
    expect(extractScihubPdf(html, 'https://sci-hub.ru')).toBe('https://cdn.example.com/x.pdf')
  })
})
