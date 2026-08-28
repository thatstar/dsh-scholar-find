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
import { getPaper, ScholarHttpError } from '../s2/client.js'
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
function arxivDoi(arxivId: string): string {
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
 * Mutable state threaded through the chain steps. Steps run in a fixed order
 * and each consumes what earlier steps produced: `ext` from the S2 step feeds
 * the arXiv step, `s2Pdf` (the S2 openAccessPdf, only when it is a real PDF
 * URL) feeds the PMC step, and `meta` accumulates from every source.
 */
interface ChainState {
  meta: PaperMeta
  ext: Record<string, string>
  candidates: SourceResolution[]
  sourcesTried: string[]
  /** S2 `openAccessPdf.url` when it is a direct PDF (landing links excluded). */
  s2Pdf?: string
}

function mergeMeta(state: ChainState, m: PaperMeta | undefined): void {
  if (!m) return
  if (m.title && !state.meta.title) state.meta.title = m.title
  if (m.year !== undefined && m.year !== null && state.meta.year === undefined) state.meta.year = m.year
  if (m.author && !state.meta.author) state.meta.author = m.author
  if (m.journal && !state.meta.journal) state.meta.journal = m.journal
}

/** Is this a NORMAL miss (HTTP 404 / not-found), as opposed to a transport or
 * resolver failure? A 404 from Unpaywall/S2/bioRxiv means "no (OA) record for
 * this DOI" — expected for many papers, so it is not surfaced as an error. */
function isNotFound(e: unknown): boolean {
  if (e instanceof ScholarHttpError) return e.status === 404
  const msg = (e as Error).message ?? ''
  return msg.includes('404') || msg.includes('not found')
}

function addCandidate(state: ChainState, source: string, pdfUrl: string | undefined, extra?: Partial<SourceResolution>): void {
  if (!pdfUrl) return
  if (state.candidates.some((c) => c.pdfUrl === pdfUrl)) return
  state.candidates.push({ source, pdfUrl, meta: { ...state.meta }, ext: { ...state.ext }, ...extra })
}

/**
 * Resolve one DOI to the ordered candidate list (URL + source + merged meta),
 * following the documented chain. Never downloads; the caller does that.
 */
export async function resolveChain(ctx: ChainContext): Promise<{ candidates: SourceResolution[]; sourcesTried: readonly string[]; meta: PaperMeta; ext: Record<string, string> }> {
  const state: ChainState = { meta: {}, ext: {}, candidates: [], sourcesTried: [] }
  await stepUnpaywall(ctx, state)
  await stepSemanticScholar(ctx, state)
  await stepArxiv(ctx, state)
  await stepPmc(ctx, state)
  await stepBiorxiv(ctx, state)
  return { candidates: state.candidates, sourcesTried: state.sourcesTried, meta: state.meta, ext: state.ext }
}

// Each step is a named function over (ctx, state) so the ordering dependency is
// explicit (the driver awaits them in sequence) and each source is testable in
// isolation through the shared state.

/** 1. Unpaywall (requires email). */
async function stepUnpaywall(ctx: ChainContext, state: ChainState): Promise<void> {
  if (!ctx.email) {
    state.sourcesTried.push('unpaywall skipped (no email)')
    return
  }
  state.sourcesTried.push('unpaywall')
  try {
    const up = await unpaywallResolve(ctx.doi, ctx.email, ctx.timeoutMs, ctx.signal)
    if (up) {
      mergeMeta(state, up.meta)
      for (const c of up.candidates) addCandidate(state, c.source, c.pdfUrl)
    }
  } catch (e) {
    // A 404 is a normal miss; anything else is a resolver/transport failure
    // worth distinguishing from "skipped" in the envelope.
    if (!isNotFound(e)) state.sourcesTried.push('unpaywall_error')
  }
}

/** 2. Semantic Scholar: pdf + externalIds + meta. */
async function stepSemanticScholar(ctx: ChainContext, state: ChainState): Promise<void> {
  let s2Pdf: string | undefined
  let s2Ext: Record<string, string> = {}
  try {
    const d = await getPaper(ctx.s2, `DOI:${ctx.doi}`, 'title,year,authors,openAccessPdf,externalIds,venue')
    s2Pdf = d.openAccessPdf?.url
    s2Ext = d.externalIds ?? {}
    mergeMeta(state, { title: d.title, year: d.year, author: d.authors?.[0]?.name, journal: d.venue })
  } catch (e) {
    // 404 = no S2 record (common for arXiv-only preprints) — a normal miss.
    // Any other failure is surfaced distinctly so the envelope shows the
    // resolver errored rather than merely finding nothing.
    if (!isNotFound(e)) state.sourcesTried.push('semantic_scholar_error')
  }
  if (Object.keys(s2Ext).length) state.ext = { ...state.ext, ...s2Ext }
  // S2 sometimes reports a landing / DOI-resolver link as `openAccessPdf.url`
  // (e.g. https://doi.org/…), which is NOT a direct PDF. Skip those so we don't
  // burn a download attempt on a page that can only fail the %PDF gate — the
  // real OA copy is usually reachable via the Europe PMC / PMC / arXiv steps.
  if (s2Pdf && !DOI_LANDING_URL_RE.test(s2Pdf)) {
    state.s2Pdf = s2Pdf
    state.sourcesTried.push('semantic_scholar')
    addCandidate(state, 'semantic_scholar', s2Pdf)
  }
}

/** 3. arXiv: metadata enrichment + candidate. Also recovers an arXiv id from a
 * synthesized 10.48550/arXiv.<id> DOI (S2 does not index that form). */
async function stepArxiv(ctx: ChainContext, state: ChainState): Promise<void> {
  // Synthesized arXiv DOI form; S2 does not index it — recover from the DOI.
  if (!state.ext.ArXiv && ctx.doi.toLowerCase().startsWith(ARXIV_DOI_PREFIX)) {
    state.ext.ArXiv = ctx.doi.slice(ARXIV_DOI_PREFIX.length)
  }
  const arxivId = state.ext.ArXiv
  if (!arxivId) return
  // Backfill sparse metadata from arXiv's own export API (Atom feed) — once.
  // A DOI synthesized as 10.48550/arXiv.<id>, or an S2 externalId ArXiv, often
  // maps to a paper S2 has no (or a sparse) record for, so fill title / first
  // author / published year from the primary arXiv source when they are still
  // empty. Merge only complements existing values (mergeMeta).
  if (!state.meta.title || !state.meta.author || state.meta.year === undefined) {
    const am = await arxivMetaEnrich(arxivId, ctx.timeoutMs, ctx.signal)
    if (am) mergeMeta(state, am)
  }
  state.sourcesTried.push('arxiv')
  addCandidate(state, 'arxiv', arxivPdfUrl(arxivId))
}

/** 4. Europe PMC first (bypasses NCBI's JS challenge), then PMC. */
async function stepPmc(_ctx: ChainContext, state: ChainState): Promise<void> {
  // PMCID may be in externalIds or recoverable from an S2 PDF url.
  let pmcid = state.ext.PubMedCentral
  if (!pmcid) {
    const m = /\/pmc\/articles\/(PMC\d+)/i.exec(state.s2Pdf ?? '')
    if (m?.[1]) pmcid = m[1]
  }
  if (!pmcid) return
  state.sourcesTried.push('europe_pmc', 'pmc')
  addCandidate(state, 'europe_pmc', `https://europepmc.org/articles/${pmcid}?pdf=render`)
  addCandidate(state, 'pmc', `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`)
}

/** 5. bioRxiv / medRxiv (10.1101 only). */
async function stepBiorxiv(ctx: ChainContext, state: ChainState): Promise<void> {
  if (!ctx.doi.startsWith(BIORXIV_DOI_PREFIX)) return
  state.sourcesTried.push('biorxiv')
  try {
    const bx = await biorxivResolve(ctx.doi, ctx.timeoutMs, ctx.signal)
    if (bx) addCandidate(state, 'biorxiv', bx)
  } catch (e) {
    if (!isNotFound(e)) state.sourcesTried.push('biorxiv_error')
  }
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
function arxivIdFromUrl(url: string): string | undefined {
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
export async function unpaywallResolve(doi: string, email: string, timeoutMs: number, signal?: AbortSignal): Promise<{ candidates: Array<{ source: 'unpaywall'; pdfUrl: string }>; meta: PaperMeta } | undefined> {
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

export async function biorxivResolve(doi: string, timeoutMs: number, signal?: AbortSignal): Promise<string | undefined> {
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
/** How many Crossref candidate rows to request for the gap/ambiguity check. */
const CROSSREF_ROW_COUNT = 3
/** Anything but alphanumerics/whitespace is a token boundary (title similarity). */
const NON_TOKEN_RE = /[^a-z0-9\s]/g

/** Normalized token set (lowercase, alphanumeric) for title similarity. */
function titleTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().replace(NON_TOKEN_RE, ' ').split(/\s+/).filter(Boolean))
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

/** Confidence verdict from Crossref's top-match evidence. */
interface CrossrefConfidence {
  lowConfidence: boolean
  reason?: TitleResolution['lowConfidenceReason']
}

/** Decide the confidence flags from the Crossref top match. A `title_mismatch`
 * means the top hit is a DIFFERENT paper, so it is always low-confidence and
 * its DOI must never be handed back (see resolveTitle pass 3). */
function confidenceFrom(e: { crScore?: number; crGap?: number; crSimilar: number; hasTop: boolean }): CrossrefConfidence {
  if (!e.hasTop) return { lowConfidence: true, reason: 'no_match' }
  if (e.crSimilar < TITLE_SIMILARITY_MIN) return { lowConfidence: true, reason: 'title_mismatch' }
  if (e.crScore !== undefined && e.crScore < TITLE_SCORE_MIN) return { lowConfidence: true, reason: 'score_below_threshold' }
  if (e.crGap !== undefined && e.crGap < TITLE_GAP_MIN) return { lowConfidence: true, reason: 'ambiguous_runner_up' }
  return { lowConfidence: false }
}

/** Build one `TitleResolution` from a passing branch's evidence. */
function mkResolution(
  query: string,
  resolver: TitleResolution['resolver'],
  tried: readonly string[],
  e: { doi: string; title?: string; score?: number; candidates: unknown[]; confidence: CrossrefConfidence },
): TitleResolution {
  const r: TitleResolution = {
    query,
    resolver,
    resolversTried: tried,
    resolvedDoi: e.doi,
    resolvedTitle: e.title,
    candidates: e.candidates,
    lowConfidence: e.confidence.lowConfidence,
  }
  if (e.score !== undefined) r.matchScore = e.score
  if (e.confidence.reason) r.lowConfidenceReason = e.confidence.reason
  return r
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
    const params = new URLSearchParams({ 'query.title': q, rows: String(CROSSREF_ROW_COUNT), select: 'DOI,title,score,author,issued,container-title' })
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
  const confidence = confidenceFrom({ crScore, crGap, crSimilar, hasTop: Boolean(crTop?.doi) })

  if (crTop?.doi && !confidence.lowConfidence) {
    return {
      doi: crTop.doi,
      resolution: mkResolution(q, 'crossref', resolversTried, {
        doi: crTop.doi,
        title: crTop.title,
        score: crScore,
        candidates: crCandidates,
        confidence,
      }),
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
          resolution: mkResolution(q, 'semantic_scholar', resolversTried, {
            doi,
            title: top.title,
            candidates: crCandidates.length ? crCandidates : [{ title: top.title, doi }],
            // Preserve the original quirk: an S2 hit reports the Crossref
            // low-confidence reason when a Crossref candidate existed, even
            // though the S2 match itself is accepted (lowConfidence: false).
            confidence: { lowConfidence: false, reason: crTop?.doi ? confidence.reason : undefined },
          }),
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
  if (crTop?.doi && confidence.reason !== 'title_mismatch') {
    return {
      doi: crTop.doi,
      resolution: mkResolution(q, 'crossref', resolversTried, {
        doi: crTop.doi,
        title: crTop.title,
        score: crScore,
        candidates: crCandidates,
        confidence,
      }),
    }
  }

  return {
    doi: undefined,
    resolution: {
      ...empty,
      // Snapshot: do not alias the (now-mutated) live resolversTried array.
      resolversTried: [...resolversTried],
      lowConfidence: true,
      lowConfidenceReason: crTop?.doi ? confidence.reason ?? 'no_match' : 'no_match',
    },
  }
}