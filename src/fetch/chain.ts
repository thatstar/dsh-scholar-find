/**
 * The paper_fetch source chain, reimplemented in TypeScript against the
 * public OA APIs: Unpaywall -> Semantic Scholar -> arXiv -> Europe PMC/PMC ->
 * bioRxiv/medRxiv. Each resolver returns PDF URL candidates plus metadata; the
 * download loop validates and writes. The chain itself relies strictly on the
 * OA sources' own return values — no publisher-guess/pirate fallback. (The
 * caller in service.ts may additionally apply a last-resort title web-search
 * fallback; that lives outside this module.)
 * @module dsh-scholar-find/fetch-chain
 */

import type { ScholarClient } from '../s2/client.js'
import { getPaper } from '../s2/client.js'
import { fetchWithRedirects, isSafeUrl } from './safety.js'
import { timedFetch } from './transport.js'

/** Registered arXiv DOI prefix. The probe lowercases the DOI; the synthesized
 * DOI uses the canonical `arXiv.` casing (see {@link arxivDoi}). */
const ARXIV_DOI_PREFIX = '10.48550/arxiv.'
/** bioRxiv / medRxiv DOI prefix (only 10.1101 registers). */
const BIORXIV_DOI_PREFIX = '10.1101/'
/** DOI-landing-page URL shapes S2 sometimes reports as `openAccessPdf.url`,
 * which are NOT direct PDFs (e.g. https://doi.org/…). */
const DOI_LANDING_URL_RE = /^https?:\/\/(www\.|dx\.)?doi\.org\//i

/** The canonical arXiv DOI for an arXiv id (10.48550/arXiv.<id>). */
export function arxivDoi(arxivId: string): string {
  return `10.48550/arXiv.${arxivId}`
}

/** Direct PDF download URL for an arXiv id. */
export function arxivPdfUrl(arxivId: string): string {
  return `https://arxiv.org/pdf/${arxivId}.pdf`
}

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
  /** Extra diagnostics for the envelope (e.g. mirror detail). */
  detail?: Record<string, string>
}

export interface ChainContext {
  readonly doi: string
  readonly email: string
  readonly s2: ScholarClient
  readonly timeoutMs: number
  readonly signal?: AbortSignal
}

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

  // 2. Semantic Scholar: pdf + externalIds + meta
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
  // S2 sometimes reports a landing / DOI-resolver link as `openAccessPdf.url`
  // (e.g. https://doi.org/…), which is NOT a direct PDF. Skip those so we don't
  // burn a download attempt on a page that can only fail the %PDF gate — the
  // real OA copy is usually reachable via the Europe PMC / PMC / arXiv steps.
  if (s2Pdf && !DOI_LANDING_URL_RE.test(s2Pdf)) {
    sourcesTried.push('semantic_scholar')
    add('semantic_scholar', s2Pdf)
  }

  // Synthesized arXiv DOI form; S2 does not index it — recover from the DOI.
  if (!ext.ArXiv && ctx.doi.toLowerCase().startsWith(ARXIV_DOI_PREFIX)) {
    ext.ArXiv = ctx.doi.slice(ARXIV_DOI_PREFIX.length)
  }

  // 3. arXiv
  if (ext.ArXiv) {
    // Backfill sparse metadata from arXiv's own export API (Atom feed) — once.
    // A DOI synthesized as 10.48550/arXiv.<id>, or an S2 externalId ArXiv, often
    // maps to a paper S2 has no (or a sparse) record for, so fill title / first
    // author / published year from the primary arXiv source when they are still
    // empty. Merge only complements existing values (mergeMeta).
    if (!meta.title || !meta.author || meta.year === undefined) {
      const am = await arxivMetaEnrich(ext.ArXiv, ctx.timeoutMs, ctx.signal)
      if (am) mergeMeta(am)
    }
    sourcesTried.push('arxiv')
    add('arxiv', arxivPdfUrl(ext.ArXiv))
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
  if (ctx.doi.startsWith(BIORXIV_DOI_PREFIX)) {
    sourcesTried.push('biorxiv')
    try {
      const bx = await biorxivResolve(ctx.doi, ctx.timeoutMs, ctx.signal)
      if (bx) add('biorxiv', bx)
    } catch {
      // ignore
    }
  }

  return { candidates, sourcesTried, meta, ext }
}

// ---------------------------------------------------------------------------
// Individual resolvers
// ---------------------------------------------------------------------------

async function jsonGet(url: string, timeoutMs: number, signal?: AbortSignal, headers?: Record<string, string>): Promise<any> {
  const r = await timedFetch(url, { headers: { Accept: 'application/json', ...headers } }, { timeoutMs, signal })
  const text = await r.text()
  let body: any
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return body
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
  if (arxiv) return arxivPdfUrl(arxiv)

  if (!isSafeUrl(url).ok) return undefined
  let html = ''
  try {
    const r = await timedFetch(url, { headers: { Accept: 'text/html,application/xhtml+xml' } }, {
      timeoutMs,
      signal,
      errorLabel: 'landing timeout',
      fetchImpl: (u, i) => fetchWithRedirects(u, i, { checkDns: opts.checkDns }),
    })
    if (!r.ok) return undefined
    html = await r.text()
  } catch {
    return undefined
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

/** Decode common XML entities in an arXiv Atom feed text node. `&amp;` decodes
 * last so `&amp;lt;` becomes `&lt;` (a literal string) rather than `<`. */
function decodeFeedEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * Extract (title, first author, published year) from the first `<entry>` of an
 * arXiv Atom feed. Scoped to the entry so the feed-level `<title>` never
 * shadows the paper title. Returns undefined when nothing useful is found.
 */
export function parseArxivFeed(xml: string): PaperMeta | undefined {
  const entry = /<entry[^>]*>([\s\S]*?)<\/entry>/i.exec(xml)?.[1]
  if (!entry) return undefined
  const meta: PaperMeta = {}

  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(entry)?.[1]
  if (title) meta.title = decodeFeedEntities(title.replace(/\s+/g, ' ').trim())

  const author = /<author[^>]*>[\s\S]*?<name[^>]*>([\s\S]*?)<\/name>/i.exec(entry)?.[1]
  if (author) meta.author = decodeFeedEntities(author.replace(/\s+/g, ' ').trim())

  const published = /<published>(\d{4})-.+?<\/published>/i.exec(entry)?.[1]
  if (published) meta.year = Number(published)

  if (meta.title === undefined && meta.author === undefined && meta.year === undefined) return undefined
  return meta
}

/**
 * Backfill metadata for a known arXiv id from arXiv's export API (Atom feed).
 * Invoked once per chain when a source produced an arXiv id but
 * meta.title/author/year are still sparse — e.g. a DOI synthesized as
 * 10.48550/arXiv.<id> (S2 has no record for some arXiv-only preprints) or an
 * S2 externalId ArXiv with a sparse record. Returns the discovered fields, or
 * undefined on any transport / parse failure (callers treat it as optional).
 */
export async function arxivMetaEnrich(arxivId: string, timeoutMs: number, signal?: AbortSignal): Promise<PaperMeta | undefined> {
  const url = `http://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`
  try {
    const r = await timedFetch(url, { headers: { Accept: 'application/atom+xml,application/xml,text/xml' } }, {
      timeoutMs,
      signal,
      errorLabel: `arxiv meta timeout after ${timeoutMs}ms`,
    })
    if (!r.ok) return undefined
    return parseArxivFeed(await r.text())
  } catch {
    return undefined
  }
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
        return `https://www.${server}.org/content/${BIORXIV_DOI_PREFIX}${latest.doi.split('/').pop()}v${latest.version ?? 1}.full.pdf`
      }
    } catch {
      // try the other server
    }
  }
  return undefined
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
/** Minimum Jaccard similarity between the query title and a resolved title to
 * accept the match — Crossref's fuzzy title search can surface a different paper
 * that still clears TITLE_SCORE_MIN, so we also require the titles to look alike. */
const TITLE_SIMILARITY_MIN = 0.5

/** Normalized token set (lowercase, alphanumeric) for title similarity. */
function titleTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean))
}

/** Jaccard similarity between two titles (0..1). Exact/close titles -> high. */
function titleSimilarity(a: string, b: string): number {
  const A = titleTokens(a)
  const B = titleTokens(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  const union = A.size + B.size - inter
  return union ? inter / union : 0
}

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
  const crSimilar = crTop?.title ? titleSimilarity(q, crTop.title) : 0
  const crLowReason: string | undefined = crTop?.doi
    ? crSimilar < TITLE_SIMILARITY_MIN
      ? 'title_mismatch'
      : crScore !== undefined && crScore < TITLE_SCORE_MIN
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
    if (top && titleSimilarity(q, top.title ?? '') >= TITLE_SIMILARITY_MIN) {
      const ext = top.externalIds ?? {}
      let doi = ext.DOI
      if (!doi && ext.ArXiv) doi = arxivDoi(ext.ArXiv)
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

  // Pass 3 — low-confidence Crossref pick. Only when the top result at least
  // title-matches: a `title_mismatch` is a DIFFERENT paper (Crossref's fuzzy
  // search can surface one), so never hand back its DOI — report it unresolved
  // so the caller can ask the user for a DOI instead.
  if (crTop?.doi && crLowReason !== 'title_mismatch') {
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

  return {
    doi: undefined,
    resolution: {
      ...empty,
      lowConfidence: true,
      lowConfidenceReason: crTop?.doi ? crLowReason ?? 'no_match' : 'no_match',
    },
  }
}