import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  normalizeArxivId,
  parseArxivPage,
  pageVersion,
  articleToMarkdown,
  articleToHtml,
  arxivGetFulltext,
  arxivFileName,
  ArxivInputError,
  ARXIV_HTML_BASE,
} from '../src/arxiv/html.js'

const fetchMock = vi.fn()
afterEach(() => {
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

function htmlResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

/** A small LaTeXML-style page covering every mapping branch. */
const FIXTURE_PAGE = `<!doctype html>
<html><head><title>x</title><script>var a = 1 &lt; 2;</script></head>
<body>
<header class="arxiv-html-header"><nav class="html-header-nav">arXiv chrome</nav></header>
<div class="ltx_page_content">
<div>arXiv:2402.08954v1 [cs.DL] 14 Feb 2024</div>
<article class="ltx_document ltx_authors_1line">
<h1 class="ltx_title ltx_title_document">A Test Paper</h1>
<div class="ltx_authors"><span class="ltx_creator ltx_role_author"><span class="ltx_personname">Alice</span><span id="id1" class="ltx_note ltx_note_frontmatter ltx_thanks_contribution ltx_role_thanks"><sup class="ltx_note_mark">†</sup><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">†</sup><span class="ltx_note_type">thanks: </span>Equal contribution.</span></span></span></span><sup class="ltx_note_mark">1</sup><span class="ltx_note ltx_role_footnotemark"><span class="ltx_note_content">1</span></span></span> <span class="ltx_creator ltx_role_author"><span class="ltx_personname">Bob</span></span><span class="ltx_author_notes"><span class="ltx_author_notes_content">thankful footnote</span></span></div>
<section class="ltx_section">
<h2 class="ltx_title ltx_title_section">0.1 Introduction</h2>
<p class="ltx_p">We study <math class="ltx_Math" alttext="f(x) = x^2" display="inline"><semantics><mi>f</mi></semantics></math> and results AT&amp;T follow <span class="ltx_note ltx_note_footnote ltx_role_footnote"><sup class="ltx_note_mark">†</sup><span class="ltx_note_outer"><span class="ltx_note_content">body footnote text</span></span></span>.</p>
<p class="ltx_p">We show <math class="ltx_Math" alttext="\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}" display="block"><semantics><mrow><mo>∑</mo></mrow><annotation encoding="application/x-tex">\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}</annotation></semantics></math> here.</p>
<ul class="ltx_list"><li class="ltx_item"><p class="ltx_p">• First point</p></li><li class="ltx_item"><p class="ltx_p">Second point</p></li></ul>
<figure id="Ch0.F1" class="ltx_figure"><img src="2402.08954v1/fig.png" id="F1.g1" class="ltx_graphics" alt="A figure" width="300" height="200"/><figcaption class="ltx_caption"><span class="ltx_tag">Figure 1:</span> Architecture</figcaption></figure>
<table class="ltx_tabular"><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>
<figure id="S4.T1" class="ltx_table"><figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table 1: </span> Data caption</figcaption><table class="ltx_tabular"><tr><th>X</th><th>Y</th></tr><tr><td>10</td><td>20</td></tr></table></figure>
<table class="ltx_equation ltx_eqn_table"><tr><td class="ltx_eqn_cell"><math class="ltx_Math" alttext="E=mc^2" display="block"><semantics><mrow><mi>E</mi></mrow></semantics></math></td><td class="ltx_eqn_cell"><span class="ltx_tag">(1)</span></td></tr></table>
</section>
</article>
</div>
<footer>footer chrome</footer>
</body></html>`

describe('normalizeArxivId', () => {
  it('accepts new-style ids with and without a version', () => {
    expect(normalizeArxivId('2402.08954')).toBe('2402.08954')
    expect(normalizeArxivId('2402.08954v2')).toBe('2402.08954v2')
  })

  it('accepts old-style ids (with optional category dot)', () => {
    expect(normalizeArxivId('hep-ex/0307015')).toBe('hep-ex/0307015')
    expect(normalizeArxivId('math.GT/0501001v3')).toBe('math.GT/0501001v3')
  })

  it('strips abs/pdf/html URLs and the arXiv: prefix', () => {
    expect(normalizeArxivId('https://arxiv.org/abs/2402.08954')).toBe('2402.08954')
    expect(normalizeArxivId('http://arxiv.org/pdf/2402.08954v2')).toBe('2402.08954v2')
    expect(normalizeArxivId('https://arxiv.org/html/hep-ex/0307015v1')).toBe('hep-ex/0307015v1')
    expect(normalizeArxivId('arXiv:2402.08954v3')).toBe('2402.08954v3')
    expect(normalizeArxivId(' 2402.08954 ')).toBe('2402.08954')
  })

  it('rejects non-arXiv inputs', () => {
    for (const bad of ['', '10.1038/s41586-021-03819-2', 'not-an-id', 'https://example.com/x', '2402']) {
      expect(() => normalizeArxivId(bad)).toThrow(ArxivInputError)
    }
  })
})

describe('parseArxivPage / pageVersion', () => {
  it('finds the article and the document title', () => {
    const page = parseArxivPage(FIXTURE_PAGE)
    expect(page.article.tag).toBe('article')
    expect(page.title).toBe('A Test Paper')
  })

  it('extracts the resolved version from the page header line', () => {
    expect(pageVersion(FIXTURE_PAGE)).toBe('2402.08954v1')
    expect(pageVersion('<html><body><p>no version here</p></body></html>')).toBeUndefined()
  })

  it('degrades to the whole body when no article exists', () => {
    const page = parseArxivPage('<html><body><p>just text</p></body></html>')
    expect(page.article.tag).toBe('body')
    expect(articleToMarkdown(page.article)).toBe('just text')
  })
})

describe('articleToMarkdown', () => {
  const page = parseArxivPage(FIXTURE_PAGE)
  const md = articleToMarkdown(page.article)

  it('renders the document title and section headings', () => {
    expect(md).toContain('# A Test Paper')
    expect(md).toContain('## 0.1 Introduction')
  })

  it('renders inline math as $...$ and body footnotes as [^n] references', () => {
    expect(md).toContain('We study $f(x) = x^2$ and results AT&T follow [^1].')
    expect(md).toContain('## Footnotes')
    expect(md).toContain('[^1]: body footnote text')
    expect(md).not.toContain('body footnote text.')
  })

  it('renders display math as a $$...$$ block', () => {
    expect(md).toContain('$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$')
  })

  it('renders lists, stripping the bullet glyph', () => {
    expect(md).toContain('- First point')
    expect(md).toContain('- Second point')
  })

  it('renders figures with absolute image URLs and the caption', () => {
    expect(md).toContain(`![A figure](${ARXIV_HTML_BASE}/2402.08954v1/fig.png)`)
    expect(md).toContain('*Figure 1: Architecture*')
  })

  it('renders real tables as markdown tables', () => {
    expect(md).toContain('| A | B |')
    expect(md).toContain('| --- | --- |')
    expect(md).toContain('| 1 | 2 |')
  })

  it('renders table-figures (figure.ltx_table) with their data rows and caption', () => {
    expect(md).toContain('| X | Y |')
    expect(md).toContain('| 10 | 20 |')
    expect(md).toContain('*Table 1: Data caption*')
  })

  it('renders equation tables as one display-math block with the tag', () => {
    expect(md).toContain('$$\nE=mc^2  (1)\n$$')
  })

  it('drops frontmatter notes (thanks), footnotemarks, note marks/labels, and the page chrome', () => {
    expect(md).toContain('Alice Bob')
    expect(md).not.toContain('thankful footnote')
    expect(md).not.toContain('thanks: ')
    expect(md).not.toContain('Equal contribution')
    expect(md).not.toContain('footnotemark')
    expect(md).not.toContain('†')
    expect(md).not.toContain('arXiv chrome')
    expect(md).not.toContain('footer chrome')
    expect(md).not.toContain('<script')
  })
})

describe('articleToHtml', () => {
  it('serializes the article with chrome dropped and entities re-escaped', () => {
    const html = articleToHtml(parseArxivPage(FIXTURE_PAGE).article)
    expect(html).toContain('<article class="ltx_document ltx_authors_1line">')
    expect(html).toContain('AT&amp;T')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('arXiv chrome')
  })
})

describe('arxivGetFulltext — pipeline', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'arxiv-'))
  const baseInput = {
    baseDir: tmp,
    defaultOutputDir: '.scholar',
    timeoutMs: 5000,
  }

  it('reports available:false on HTTP 404', async () => {
    fetchMock.mockResolvedValue(htmlResponse('Not Found', 404))
    vi.stubGlobal('fetch', fetchMock)
    const r = await arxivGetFulltext({ ...baseInput, arxivId: '2402.08954', save: true, md: true })
    expect(r).toMatchObject({ ok: true, available: false, arxivId: '2402.08954' })
  })

  it('saves markdown to <root>/md/<id>.md and returns the path', async () => {
    fetchMock.mockResolvedValue(htmlResponse(FIXTURE_PAGE, 200))
    vi.stubGlobal('fetch', fetchMock)
    const r = await arxivGetFulltext({ ...baseInput, arxivId: '2402.08954', save: true, md: true })
    expect(r).toMatchObject({ ok: true, available: true, format: 'markdown', version: '2402.08954v1', title: 'A Test Paper' })
    if (!('path' in r) || !r.path) throw new Error('expected a saved path')
    expect(r.path).toBe(join(tmp, '.scholar', 'md', '2402.08954.md'))
    expect(existsSync(r.path)).toBe(true)
    expect(readFileSync(r.path, 'utf8')).toContain('# A Test Paper')
  })

  it('saves article-scoped html to <root>/html/<id>.html when md=false', async () => {
    fetchMock.mockResolvedValue(htmlResponse(FIXTURE_PAGE, 200))
    vi.stubGlobal('fetch', fetchMock)
    const r = await arxivGetFulltext({ ...baseInput, arxivId: '2402.08954', save: true, md: false })
    if (!('path' in r) || !r.path) throw new Error('expected a saved path')
    expect(r).toMatchObject({ ok: true, available: true, format: 'html' })
    expect(r.path).toBe(join(tmp, '.scholar', 'html', '2402.08954.html'))
    expect(readFileSync(r.path, 'utf8')).toContain('<article')
    expect(readFileSync(r.path, 'utf8')).not.toContain('<script')
  })

  it('returns the full content inline when save=false', async () => {
    fetchMock.mockResolvedValue(htmlResponse(FIXTURE_PAGE, 200))
    vi.stubGlobal('fetch', fetchMock)
    const r = await arxivGetFulltext({ ...baseInput, arxivId: '2402.08954', save: false, md: true })
    expect(r).toMatchObject({ ok: true, available: true, format: 'markdown' })
    if (!('content' in r)) throw new Error('expected inline content')
    expect(r.content).toContain('# A Test Paper')
    expect(r.path).toBeUndefined()
  })

  it('truncates inline content with maxChars', async () => {
    fetchMock.mockResolvedValue(htmlResponse(FIXTURE_PAGE, 200))
    vi.stubGlobal('fetch', fetchMock)
    const r = await arxivGetFulltext({ ...baseInput, arxivId: '2402.08954', save: false, md: true, maxChars: 40 })
    if (!('content' in r)) throw new Error('expected inline content')
    expect(r.content!.length).toBeLessThanOrEqual(40)
    expect(r.truncated).toBe(true)
    expect(r.chars).toBeGreaterThan(40)
  })

  it('maps a transport failure to a retryable envelope', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'))
    vi.stubGlobal('fetch', fetchMock)
    const r = await arxivGetFulltext({ ...baseInput, arxivId: '2402.08954', save: true, md: true })
    expect(r).toMatchObject({ ok: false, code: 'network_error', retryable: true })
  })

  it('maps invalid input to a non-retryable validation envelope', async () => {
    const r = await arxivGetFulltext({ ...baseInput, arxivId: '10.1038/foo', save: true, md: true })
    expect(r).toMatchObject({ ok: false, code: 'validation_error', retryable: false })
  })
})

describe('arxivFileName', () => {
  it('sanitises the slash in old-style ids', () => {
    expect(arxivFileName('hep-ex/0307015', 'markdown')).toBe('hep-ex_0307015.md')
    expect(arxivFileName('2402.08954v2', 'html')).toBe('2402.08954v2.html')
  })
})
