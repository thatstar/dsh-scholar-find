/**
 * The paper_fetch source chain, reimplemented in TypeScript against the
 * public OA APIs: Unpaywall -> Semantic Scholar -> arXiv -> Europe PMC/PMC ->
 * bioRxiv/medRxiv -> publisher direct (institutional opt-in) -> Sci-Hub
 * (opt-in, off by decision). Each resolver returns PDF URL candidates plus
 * metadata; the download loop validates and writes.
 * @module dsh-scholar-find/fetch-chain
 */

import type { ScholarClient } from '../s2/client.js'
import { getPaper } from '../s2/client.js'
import { fetchWithRedirects, isSafeUrl } from './safety.js'

export interface PaperMeta {
  title?: string
  year?: number | string
  author?: string
  journal?: string
}

export interface SourceResolution {
  /** Human-readable source label of the hit. */
  source: string
  /** Candidate PDF URL. */
  pdfUrl: string
  /** Metadata merged so far (title/year/author/journal). */
  meta: PaperMeta
  /** External ids learned along the way (ArXiv, PubMedCentral, DOI). */
  ext: Record<string, string>
  /** Extra diagnostics for the envelope (e.g. Sci-Hub mirror). */
  detail?: Record<string, string>
}

export interface ChainContext {
  readonly doi: string
  readonly email: string
  readonly s2: ScholarClient
  readonly institutional: boolean
  readonly scihubEnabled: boolean
  readonly scihubMirrors: string
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

const DEFAULT_SCIHUB_MIRRORS = ['sci-hub.ru', 'sci-hub.st', 'sci-hub.su', 'sci-hub.box', 'sci-hub.red', 'sci-hub.al', 'sci-hub.mk', 'sci-hub.ee']

/**
 * Resolve one DOI to the ordered candidate list (URL + source + merged meta),
 * following the documented chain. Never downloads; the caller does that.
 */
export async function resolveChain(ctx: ChainContext): Promise<{ candidates: SourceResolution[]; sourcesTried: readonly string[]; meta: PaperMeta; ext: Record<string, string> }> {
  const sourcesTried: string[] = []
  const candidates: SourceResolution[] = []
  const meta: PaperMeta = {}
  let ext: Record<string, string> = {}

  const mergeMeta = (m: PaperMeta | undefined): void => {
    if (!m) return
    if (m.title && !meta.title) meta.title = m.title
    if (m.year !== undefined && m.year !== null && meta.year === undefined) meta.year = m.year
    if (m.author && !meta.author) meta.author = m.author
    if (m.journal && !meta.journal) meta.journal = m.journal
  }

  const add = (source: string, pdfUrl: string | undefined, extra?: Partial<SourceResolution>): void => {
    if (!pdfUrl) return
    if (candidates.some((c) => c.pdfUrl === pdfUrl)) return
    candidates.push({ source, pdfUrl, meta: { ...meta }, ext: { ...ext }, ...extra })
  }

  // 1. Unpaywall (requires email)
  if (ctx.email) {
    sourcesTried.push('unpaywall')
    try {
      const up = await unpaywallResolve(ctx.doi, ctx.email, ctx.timeoutMs, ctx.signal)
      if (up) {
        mergeMeta(up.meta)
        for (const c of up.candidates) add(c.source, c.pdfUrl)
      }
    } catch {
      // transport failure — recorded implicitly by the caller via sourcesTried
    }
  } else {
    sourcesTried.push('unpaywall skipped (no email)')
  }

  // 2. Semantic Scholar: pdf + externalIds + meta (also lazy cache)
  let s2Pdf: string | undefined
  let s2Ext: Record<string, string> = {}
  try {
    const d = await getPaper(ctx.s2, `DOI:${ctx.doi}`, 'title,year,authors,openAccessPdf,externalIds,venue')
    s2Pdf = d.openAccessPdf?.url
    s2Ext = d.externalIds ?? {}
    mergeMeta({ title: d.title, year: d.year, author: d.authors?.[0]?.name, journal: d.venue })
  } catch {
    // 404 / transport: continue with other sources
  }
  if (Object.keys(s2Ext).length) ext = { ...ext, ...s2Ext }
  if (s2Pdf) {
    sourcesTried.push('semantic_scholar')
    add('semantic_scholar', s2Pdf)
  }

  // Synthesized arXiv DOI form; S2 does not index it — recover from the DOI.
  if (!ext.ArXiv && ctx.doi.toLowerCase().startsWith('10.48550/arxiv.')) {
    ext.ArXiv = ctx.doi.slice('10.48550/arxiv.'.length)
  }

  // 3. arXiv
  if (ext.ArXiv) {
    sourcesTried.push('arxiv')
    add('arxiv', `https://arxiv.org/pdf/${ext.ArXiv}.pdf`)
  }

  // PMCID may be in externalIds or recoverable from an S2 PDF url.
  let pmcid = ext.PubMedCentral
  if (!pmcid) {
    const m = /\/pmc\/articles\/(PMC\d+)/i.exec(s2Pdf ?? '')
    if (m?.[1]) pmcid = m[1]
  }

  // 4. Europe PMC first (bypasses NCBI's JS challenge), then PMC
  if (pmcid) {
    sourcesTried.push('europe_pmc', 'pmc')
    add('europe_pmc', `https://europepmc.org/articles/${pmcid}?pdf=render`)
    add('pmc', `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`)
  }

  // 5. bioRxiv / medRxiv (10.1101 only)
  if (ctx.doi.startsWith('10.1101/')) {
    sourcesTried.push('biorxiv')
    try {
      const bx = await biorxivResolve(ctx.doi, ctx.timeoutMs, ctx.signal)
      if (bx) add('biorxiv', bx)
    } catch {
      // ignore
    }
  }

  // 6. Publisher direct (institutional opt-in)
  if (ctx.institutional) {
    sourcesTried.push('publisher_direct')
    for (const [publisher, url] of publisherCandidates(ctx.doi, ctx.timeoutMs)) {
      add('publisher_direct', url, { detail: { publisher } })
    }
  }

  // 7. Sci-Hub (opt-in, off by default per decision)
  if (ctx.scihubEnabled) {
    sourcesTried.push('scihub')
    const hit = await scihubResolve(ctx.doi, ctx.scihubMirrors, ctx.timeoutMs, ctx.signal)
    if (hit) add('scihub', hit.url, { detail: { mirror: hit.mirror } })
  }

  return { candidates, sourcesTried, meta, ext }
}

// ---------------------------------------------------------------------------
// Individual resolvers
// ---------------------------------------------------------------------------

async function jsonGet(url: string, timeoutMs: number, signal?: AbortSignal, headers?: Record<string, string>): Promise<any> {
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal })
    const text = await r.text()
    let body: any
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = null
    }
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return body
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/** Extract an arXiv id from an arXiv abs/pdf URL (tolerates a stray `arXiv:` token). */
export function arxivIdFromUrl(url: string): string | undefined {
  const m = /arxiv\.org\/(?:abs|pdf)\/([^/?#]+)/i.exec(url)
  if (!m?.[1]) return undefined
  const id = m[1].replace(/^arXiv:/i, '')
  return id || undefined
}

/** Standard HTML signals that point at an article's actual PDF. */
const PDF_URL_SIGNALS = [
  /<meta[^>]+name=["']citation_pdf_url["'][^>]+content=["']([^"']+)["']/i, // academic convention; VERIFIED live on arXiv + Springer only
  /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/pdf["'][^>]+href=["']([^"']+)["']/i,
  /\shref=["']([^"']+\.pdf)["']/i, // first anchor with a .pdf href
] as const

/**
 * Best-effort fallback: discover the actual PDF URL for an OA *landing page*
 * (Unpaywall gives `url_for_landing_page` when it has no stable direct PDF
 * link). Reads `citation_pdf_url`, an application/pdf alternate <link>, or the
 * first .pdf anchor. This is ONLY verified on arXiv (resolved directly) and
 * Springer. NOT reliable for PMC/bioRxiv/ChemRxiv (JS-rendered or no meta tag)
 * — those are covered by the chain's dedicated resolvers (Europe PMC,
 * bioRxiv API), not by this fallback. Returns undefined on any failure.
 */
export async function landingPdfUrl(url: string, timeoutMs: number, signal?: AbortSignal, opts: { checkDns?: boolean } = {}): Promise<string | undefined> {
  const arxiv = arxivIdFromUrl(url)
  if (arxiv) return `https://arxiv.org/pdf/${arxiv}.pdf`

  if (!isSafeUrl(url).ok) return undefined
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => controller.abort(new Error('landing timeout')), timeoutMs)
  let html = ''
  try {
    const r = await fetchWithRedirects(url, { headers: { Accept: 'text/html,application/xhtml+xml' }, signal: controller.signal }, { checkDns: opts.checkDns })
    if (!r.ok) return undefined
    // PDFs can be big; a landing page rarely is. Cap the read.
    html = await r.text()
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }

  for (const re of PDF_URL_SIGNALS) {
    const m = re.exec(html)
    if (m?.[1]) {
      try {
        return new URL(m[1], url).toString()
      } catch {
        return m[1]
      }
    }
  }
  return undefined
}

/** Unpaywall v2: collect OA PDF candidates from every OA location. */
async function unpaywallResolve(doi: string, email: string, timeoutMs: number, signal?: AbortSignal): Promise<{ candidates: Array<{ source: 'unpaywall'; pdfUrl: string }>; meta: PaperMeta } | undefined> {
  const d = await jsonGet(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`, timeoutMs, signal)
  const meta: PaperMeta = {
    title: d.title,
    year: d.year,
    author: d.z_authors?.[0]?.family,
    journal: d.journal_name,
  }
  const locs: any[] = [d.best_oa_location, ...(d.oa_locations ?? [])].filter(Boolean)
  const candidates: Array<{ source: 'unpaywall'; pdfUrl: string }> = []
  const seen = new Set<string>()

  // Pass 1 — a direct PDF URL (cheap; no extra fetch).
  for (const loc of locs) {
    const direct = loc.url_for_pdf
    if (direct && !seen.has(direct)) {
      seen.add(direct)
      candidates.push({ source: 'unpaywall', pdfUrl: direct })
    }
  }
  // Pass 2 — no direct PDF anywhere: discover one from the best landing pages.
  if (candidates.length === 0) {
    for (const loc of locs.slice(0, 3)) {
      const landing = loc.url_for_landing_page || loc.url
      if (!landing) continue
      const pdf = await landingPdfUrl(landing, timeoutMs, signal)
      if (pdf && !seen.has(pdf)) {
        seen.add(pdf)
        candidates.push({ source: 'unpaywall', pdfUrl: pdf })
      }
    }
  }
  return { candidates, meta }
}

async function biorxivResolve(doi: string, timeoutMs: number, signal?: AbortSignal): Promise<string | undefined> {
  for (const server of ['biorxiv', 'medrxiv']) {
    try {
      const d = await jsonGet(`https://api.biorxiv.org/details/${server}/${doi}`, timeoutMs, signal)
      const coll = d.collection ?? []
      if (coll.length) {
        const latest = coll[coll.length - 1]
        return `https://www.${server}.org/content/10.1101/${latest.doi.split('/').pop()}v${latest.version ?? 1}.full.pdf`
      }
    } catch {
      // try the other server
    }
  }
  return undefined
}

/** Publisher-direct URL templates by DOI prefix (institutional mode). */
export function publisherCandidates(doi: string, timeoutMs: number): Array<[publisher: string, url: string]> {
  const suffix = doi.slice(doi.indexOf('/') + 1)
  const out: Array<[string, string]> = []
  const templates: Record<string, [string, string]> = {
    '10.1038/': ['nature', `https://www.nature.com/articles/${suffix}.pdf`],
    '10.1126/': ['science', `https://www.science.org/doi/pdf/${doi}`],
    '10.1002/': ['wiley', `https://onlinelibrary.wiley.com/doi/pdf/${doi}`],
    '10.1007/': ['springer', `https://link.springer.com/content/pdf/${doi}.pdf`],
    '10.1021/': ['acs', `https://pubs.acs.org/doi/pdf/${doi}`],
    '10.1073/': ['pnas', `https://www.pnas.org/doi/pdf/${doi}`],
    '10.1056/': ['nejm', `https://www.nejm.org/doi/pdf/${doi}`],
    '10.1177/': ['sage', `https://journals.sagepub.com/doi/pdf/${doi}`],
    '10.1080/': ['tandf', `https://www.tandfonline.com/doi/pdf/${doi}`],
  }
  for (const [prefix, entry] of Object.entries(templates)) {
    if (doi.startsWith(prefix)) {
      out.push(entry)
      return out
    }
  }
  return out
}

const SCIHUB_NOT_FOUND = /(?:please try to search again using doi|article not found in .*database)/i

/** Sci-Hub resolve: iframe/embed extraction from the mirror's HTML page. */
async function scihubResolve(doi: string, mirrorsEnv: string, timeoutMs: number, signal?: AbortSignal): Promise<{ url: string; mirror: string } | undefined> {
  const mirrors = mirrorsEnv
    ? mirrorsEnv.split(',').map((s) => s.trim()).filter(Boolean)
    : DEFAULT_SCIHUB_MIRRORS
  for (const mirror of mirrors) {
    try {
      const controller = new AbortController()
      const onAbort = () => controller.abort(signal?.reason)
      signal?.addEventListener('abort', onAbort, { once: true })
      const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
      let html = ''
      try {
        const r = await fetch(`https://${mirror}/${doi}`, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' } })
        html = await r.text()
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      }
      if (SCIHUB_NOT_FOUND.test(html)) return undefined // shared corpus: give up
      const pdf = extractScihubPdf(html, `https://${mirror}`)
      if (pdf) return { url: pdf, mirror }
    } catch {
      // try next mirror
    }
  }
  return undefined
}

/** Pull the PDF src out of a Sci-Hub page (iframe/embed). */
export function extractScihubPdf(html: string, base: string): string | undefined {
  const re = /<(?:iframe|embed)\b[^>]*\bsrc=["']([^"']+)["']/gi
  let m: RegExpExecArray | null
  let fallback: string | undefined
  while ((m = re.exec(html)) !== null) {
    const src = m[1]!
    if (!src || src.startsWith('data:')) continue
    const url = src.startsWith('//') ? `https:${src}` : src.startsWith('/') ? `${base}${src}` : src
    if (/\.pdf/i.test(url)) return url
    if (fallback === undefined) fallback = url
  }
  return fallback
}

// ---------------------------------------------------------------------------
// Title resolution: Crossref -> Semantic Scholar match, with confidence flags
// ---------------------------------------------------------------------------

export interface TitleResolution {
  query: string
  resolver: 'crossref' | 'semantic_scholar'
  resolversTried: readonly string[]
  resolvedDoi: string
  resolvedTitle?: string
  matchScore?: number
  candidates: unknown[]
  lowConfidence: boolean
  lowConfidenceReason?: string
}

const MIN_TITLE_LEN = 6
const TITLE_SCORE_MIN = 40
const TITLE_GAP_MIN = 3

/** Resolve a paper title to a DOI. Crossref primary, S2 match fallback. */
export async function resolveTitle(
  title: string,
  ctx: { email: string; s2: ScholarClient; timeoutMs: number; signal?: AbortSignal },
): Promise<{ doi: string | undefined; resolution: TitleResolution }> {
  const q = title.trim()
  const resolversTried: string[] = []
  const empty: TitleResolution = { query: q, resolver: 'crossref', resolversTried, resolvedDoi: '', candidates: [], lowConfidence: true, lowConfidenceReason: 'no_match' }

  if (q.length < MIN_TITLE_LEN) return { doi: undefined, resolution: empty }

  // Pass 1 — Crossref with mailto politeness.
  resolversTried.push('crossref')
  let crCandidates: any[] = []
  let crTop: any
  try {
    const params = new URLSearchParams({ 'query.title': q, rows: '3', select: 'DOI,title,score,author,issued,container-title' })
    if (ctx.email) params.set('mailto', ctx.email)
    const d = await jsonGet(`https://api.crossref.org/works?${params.toString()}`, ctx.timeoutMs, ctx.signal)
    crCandidates = ((d.message ?? {}).items ?? []).map((it: any) => {
      const issued = (((it.issued ?? {})['date-parts'] ?? [[null]])[0] ?? [null])[0]
      return {
        doi: it.DOI,
        title: (it.title ?? [])[0],
        year: typeof issued === 'number' ? issued : undefined,
        author: (it.author ?? [])[0]?.family ?? (it.author ?? [])[0]?.name,
        journal: (it['container-title'] ?? [])[0],
        score: it.score,
      }
    })
    crTop = crCandidates[0]
  } catch {
    // resolver unavailable — try S2
  }

  const crScore: number | undefined = crTop?.score
  const crGap: number | undefined = crCandidates.length >= 2 && typeof crScore === 'number' && typeof crCandidates[1].score === 'number'
    ? crScore - crCandidates[1].score
    : undefined
  const crLowReason: string | undefined = crTop?.doi
    ? crScore !== undefined && crScore < TITLE_SCORE_MIN
      ? 'score_below_threshold'
      : crGap !== undefined && crGap < TITLE_GAP_MIN
        ? 'ambiguous_runner_up'
        : undefined
    : 'no_match'

  if (crTop?.doi && !crLowReason) {
    return {
      doi: crTop.doi,
      resolution: {
        query: q,
        resolver: 'crossref',
        resolversTried,
        resolvedDoi: crTop.doi,
        resolvedTitle: crTop.title,
        matchScore: crScore,
        candidates: crCandidates,
        lowConfidence: false,
      },
    }
  }

  // Pass 2 — Semantic Scholar match (covers arXiv-only papers).
  resolversTried.push('semantic_scholar')
  try {
    const d = await ctx.s2.request('GET', 'https://api.semanticscholar.org/graph/v1/paper/search/match', { query: q, fields: 'title,authors,year,venue,externalIds' })
    const top = (d.data ?? [])[0]
    if (top) {
      const ext = top.externalIds ?? {}
      let doi = ext.DOI
      if (!doi && ext.ArXiv) doi = `10.48550/arXiv.${ext.ArXiv}`
      if (doi) {
        return {
          doi,
          resolution: {
            query: q,
            resolver: 'semantic_scholar',
            resolversTried,
            resolvedDoi: doi,
            resolvedTitle: top.title,
            candidates: crCandidates.length ? crCandidates : [{ title: top.title, doi }],
            lowConfidence: false,
            ...(crTop?.doi ? { lowConfidenceReason: crLowReason } : {}),
          } as TitleResolution,
        }
      }
    }
  } catch {
    // S2 unavailable
  }

  // Pass 3 — low-confidence Crossref pick.
  if (crTop?.doi) {
    return {
      doi: crTop.doi,
      resolution: {
        query: q,
        resolver: 'crossref',
        resolversTried,
        resolvedDoi: crTop.doi,
        resolvedTitle: crTop.title,
        matchScore: crScore,
        candidates: crCandidates,
        lowConfidence: true,
        lowConfidenceReason: crLowReason,
      },
    }
  }

  return { doi: undefined, resolution: empty }
}