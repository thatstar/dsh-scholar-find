/**
 * Tool registration for dsh-scholar-find: the `scholar_search_*` / `paper_fetch_*`
 * families plus the `sciverse_*` tools, defined with `defineTool` and registered
 * into `ctx.tools`.
 * @module dsh-scholar-find/tools
 */

import { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { admitEncodedImages, type AttachmentStore, type ImageMediaType } from '@deepseek-ai/dsh-attachment'
import { SEARCH_RESULT_CAP, timeoutMsOf, type ScholarSettings } from '../settings.js'
import * as s2 from '../s2/client.js'
import * as fmt from '../s2/format.js'
import * as fetchSvc from '../fetch/service.js'
import type { FetchRuntime, WebSearchHit } from '../fetch/service.js'
import { createSciverseClient } from '../sciverse/client.js'
import { FILTER_OP_EQ, SORT_ORDER_DESC, META_SEARCH_PAGE_WINDOW, SEMANTIC_TOP_K_MAX, clampNumber, clampedPageWindow, pageWindowExceeded, paperOnlyFilter, topicYearPaperFilters } from '../sciverse/payload.js'
import { buildFigureFilename, extractFigureRefs, mapGetResourceError, safeImageBasename, sniffImageType } from '../sciverse/resource.js'
import { sciverseEnvelope, shouldTryAlternateDocId, type SciverseErrorEnvelope } from '../sciverse/errors.js'
import { buildEvidenceItem, groupDocIds, EVIDENCE_DEFAULT_QUOTE_MAX, EVIDENCE_MAX_TOP_K, mapS2Paper, pickEvidenceHit, rankTopicCandidates, resolveYearRange, topicIsConfident, topByCitation, topVenues, verifyQuoteInSlice, type EvidenceItem, type TopicCandidate, type TrendPaper, type TrendVenue } from '../sciverse/aggregate.js'
import { sleep } from '../util/async.js'
import { astaSnippetSearch, ASTA_DEFAULT_LIMIT, ASTA_TIMEOUT_MS, type AstaSnippet } from '../asta/client.js'
import { mineruParseUrl, mineruParseFile, MINERU_TIMEOUT_MS } from '../mineru/client.js'
import { arxivGetFulltext } from '../arxiv/html.js'
import { resolveInsideRoot, resolveRootDir, resolveSubDir } from '../outdir.js'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { formatLibrary, pickSubdirs, type LibraryFile } from '../library.js'
import { sanitizeForOutput } from '../util/sanitize.js'
import { computeCoverage, type Coverage } from '../coverage.js'
import { describeTitleCheck, titleAccepted, titleVerdict } from '../verify.js'
import { cardFilename, cardIdentifier, cardPath } from '../cards.js'
import * as cardstore from '../cardstore.js'
import { topicOverlap } from '../topic.js'
import { CITATION_STYLES, footnoteBlock, formatReferences, referenceMetaFromS2Paper, type CitationStyle, type ReferenceMeta } from '../cite.js'

/**
 * Tool-level wall-clock caps. These bound the WHOLE tool run (including model-
 * side queueing); the per-request HTTP layer inside is governed separately by
 * the `fetchTimeoutSec` setting (S2 client) or the client timeout constants
 * (Asta / MinerU). Kept as named constants so the two layers are visibly
 * distinct and adjust in one place.
 */
/** scholar_search_* runs (S2 HTTP timeout is fetchTimeoutSec inside). */
const SCHOLAR_TOOL_TIMEOUT_MS = 120_000
/** Margin on top of the Asta request timeout for the full scholar_get_paper_snippets run. */
const ASTA_TOOL_TIMEOUT_MARGIN_MS = 10_000
/** paper_fetch_resolve run cap (chain + web fallback). */
const FETCH_RESOLVE_TIMEOUT_MS = 180_000
/** paper_fetch_download run cap (chain + every candidate + web fallback). */
const FETCH_DOWNLOAD_TIMEOUT_MS = 300_000
/** paper_fetch_batch run cap (many DOIs, resumable). */
const FETCH_BATCH_TIMEOUT_MS = 600_000
/** Margin on top of the MinerU parse timeout for the full paper_pdf2md run. */
const MINERU_TOOL_TIMEOUT_MARGIN_MS = 20_000
/** arxiv_get_fulltext run cap (one HTML GET + local conversion + up to 10
 * figure downloads — the page fetch is proxied and the page can be large). */
const ARXIV_TOOL_TIMEOUT_MS = 180_000
/** paper_pdf2md `timeoutSec` clamp: the lightweight parser is slow, so a floor
 * avoids a 0/negative deadline (instant "poll timeout"), and the tool cap is
 * derived from the MAX so a large user request isn't killed by a fixed tool
 * timeout. */
const MINERU_MIN_TIMEOUT_SEC = 10
const MINERU_MAX_TIMEOUT_SEC = 1800
/** Wall-clock cap per Sciverse API call (the direct REST client aborts the
 * socket on expiry). Generous: quality semantic search takes seconds. */
const SCIVERSE_CLIENT_TIMEOUT_MS = 60_000
/** Per-attempt cap on the full-text read path. Deliberately below the generic
 * cap: the client retries transient failures (1+2 attempts), and the tool's own
 * wall-clock budget is 120 s — a 60 s per-attempt cap would let a hanging
 * endpoint kill the tool before it could report an envelope. */
const SCIVERSE_CONTENT_TIMEOUT_MS = 30_000
/** Total budget for one sciverse_read_content call across ALL doc_ids it walks.
 * Bounds the walk (each doc_id gets at most 2 attempts) so the tool always gets
 * to return its envelope instead of being killed by the tool timeout. */
const SCIVERSE_CONTENT_BUDGET_MS = 100_000
/** Max doc_ids one read_content call will walk (primary + alternates). */
const SCIVERSE_CONTENT_MAX_DOC_IDS = 3
/** The citation/reference second-source fallback is a bonus lookup: keep it
 * short so it can never dominate an S2 tool call. */
const SCIVERSE_FALLBACK_TIMEOUT_MS = 20_000
/** The Sciverse /meta-search backend caps reported hit counts at 10000 for any
 * free-text/BM25 query (OpenSearch track_total_hits-style). Structured field
 * filters report exact counts. We annotate the tool output when this ceiling is
 * reached so a 10000 is not mistaken for a real publication total. */
const SCIVERSE_TOTAL_HITS_CAP = 10000
/** Pacing between the looped Sciverse calls inside the workflow tools (the
 * endpoints allow ~30 req/min; per-year trend scans and per-claim evidence
 * packs are multi-call loops, so they pace themselves). */
const SCIVERSE_WORKFLOW_PACE_MS = 700
/**
 * Fields the plugin always needs back from /meta-search to identify a row.
 * `fields` there is REPLACIVE, not additive (live-verified: projecting
 * only ["title"] returns rows with no unique_id/doi/author), so a caller's
 * projection is unioned with this set — a projected row must never come back
 * as an unidentifiable `untitled` record.
 */
const SCIVERSE_IDENTITY_FIELDS = ['unique_id', 'title', 'doi', 'author', 'publication_published_year', 'publication_venue_name_unified', 'doc_id'] as const
/** Triage evidence the plugin requests by default (live-verified present). */
const SCIVERSE_TRIAGE_FIELDS = ['access_is_oa', 'publication_venue_type', 'metadata_type'] as const

/** sciverse_list_paper_relations page size used by the citation/reference
 * second-source fallback (one page is a hint that the index HAS the list). */
const SCIVERSE_RELATIONS_FALLBACK_PAGE = 20
/** scholar_format_references: ids per call (S2 batch lookup) and the fields it needs. */
const REFS_MAX_IDS = 50
/** S2 fields for a formatted entry (journal carries volume/pages). */
const REFS_FIELDS = 'title,year,authors,venue,journal,externalIds,publicationTypes,publicationDate'
/** sciverse_trend_scan: year-span cap (each year costs 1 call; the sciverse
 * mode adds one topic-discovery call up front). */
const TREND_MAX_YEARS = 10
/** sciverse_trend_scan: per-year candidate pool (cost budget + locality: pools
 * bigger than ~100 add little and multiply latency). */
const TREND_DEFAULT_POOL = 50
const TREND_MAX_POOL = 100
const TREND_DEFAULT_TOP_N = 5
const TREND_MAX_TOP_N = 20
/** sciverse_trend_scan: venue histogram depth per year. */
const TREND_VENUE_TOP_N = 5
/** sciverse_evidence_pack: claims per pack (each claim costs 2 calls). */
const EVIDENCE_MAX_CLAIMS = 5
const EVIDENCE_DEFAULT_TOP_K = 5
const EVIDENCE_DEFAULT_MIN_SCORE = 0.6
/** Full-text slice read for quote verification (characters at the chunk offset). */
const EVIDENCE_READ_LEN = 2000
/** Wall-clock cap for the workflow tools (multi-call loops: trend spans 10
 * years x 2 calls, evidence packs 5 claims x 2 calls, each internally paced). */
const SCIVERSE_WORKFLOW_TIMEOUT_MS = 180_000
/** scholar_card_save: entries stored per citation section. A card is a working
 * index of what an investigation touched, not a citation archive — the full
 * lists stay behind `scholar_get_references` / `scholar_get_citations`. */
const CARD_CITATION_CAP = 25
/** Card citation fields: `externalIds` is what puts a DOI on each entry, which
 * is what makes a cross-session citation list useful. */
const CARD_CITATION_FIELDS = 'title,year,authors,venue,externalIds'
/**
 * Record fields for `scholar_card_save`. `referenceCount` is the point: it is
 * not in `DEFAULT_PAPER_FIELDS`, and asking for it here removes the separate
 * `getPaperCounts` request — one of four paced S2 calls per card, i.e. ~5 s of
 * anonymous pacing, saved on the critical path of every investigating workflow
 * (.notes/78 R7).
 */
const CARD_PAPER_FIELDS = `${s2.DEFAULT_PAPER_FIELDS},abstract,openAccessPdf,referenceCount`
/** scholar_card_list: default row cap. */
const CARD_LIST_DEFAULT_LIMIT = 50

/** Minimal view over the agent a tool call runs for. */
interface AgentLike {
  session?: { header?: { cwd?: string } }
}

export interface ScholarToolEnv {
  /** Live settings source (updates without restart). */
  readonly settings: () => ScholarSettings
  /** Resolve the S2 api key through the DSH credentials seam. */
  readonly resolveApiKey: () => Promise<string | undefined>
  /** Resolve the Ai2 Asta corpus MCP key through the DSH credentials seam. */
  readonly resolveAstaKey: () => Promise<string | undefined>
  /** Resolve the Sciverse Open Platform token through the DSH credentials seam. */
  readonly resolveSciverseKey: () => Promise<string | undefined>
}

function text(content: string): ContentBlock[] {
  return [{ type: 'text', text: content }]
}


/** Every scholar tool is a bulk/IO operation: never join a parallel sibling group. */
const NON_CONCURRENT = (): boolean => false

/**
 * Standard tool output for the scholar tools: an object schema that always
 * carries `markdown` plus the tool's extra properties, with a renderer that
 * shows the markdown (or the per-tool fallback). Collapses the ~14 repeated
 * `output.schema {markdown}` / `render` blocks in this file.
 */
function markdownOutput<const P extends Record<string, unknown>>(extra: P, fallback: (value: any) => string): {
  schema: {
    type: 'object'
    properties: { markdown: { type: 'string' } } & P
    additionalProperties: true
  }
  render: (args: unknown, value: any) => ContentBlock[]
} {
  return {
    schema: { type: 'object', properties: { markdown: { type: 'string' }, ...extra }, additionalProperties: true },
    render: (_args: unknown, value: any) => text(value.markdown ?? fallback(value)),
  }
}

/** Human-readable rendering of Asta snippet results (paper + ~500-word content). */
function fmtAsta(snippets: AstaSnippet[]): string {
  if (!snippets.length) return 'No content snippets found.'
  return snippets
    .map((s, i) => {
      const p = s.paper ?? {}
      const head = [`**Snippet ${i + 1}**`, p.title ? `*${p.title}*` : '', p.corpusId ? `(CorpusId:${p.corpusId})` : ''].filter(Boolean).join(' ')
      const sub = [
        p.authors?.length ? p.authors.slice(0, 5).join(', ') : '',
        p.openAccessInfo?.license ? `License: ${p.openAccessInfo.license}` : '',
      ].filter(Boolean).join(' · ')
      const kind = s.snippet?.snippetKind ? `\n> kind: ${s.snippet.snippetKind}` : ''
      return `### ${head}\n${sub ? `${sub}\n` : ''}${s.snippet?.text ?? ''}${kind}`
    })
    .join('\n\n')
}

function baseDirOf(exec: ToolRunContext): string {
  const agent = exec.agent as AgentLike | undefined
  // The session workspace root is the header cwd ("absolute working directory
  // the session was created in"). Never fall back to the plugin's own process
  // cwd — that is where the deployment was launched, not the session.
  return agent?.session?.header?.cwd ?? process.cwd()
}

/** Minimal structural view of the DSH `web` service (the web_search backing). */
interface WebServiceLike {
  search(req: { query: string; maxResults?: number }, signal?: AbortSignal): Promise<{ sources?: Array<{ url: string; title?: string; snippet?: string }> }>
}

function runtimeOf(ctx: Context, env: ScholarToolEnv, exec: ToolRunContext): { s2: s2.ScholarClient; fetch: FetchRuntime } {
  const settings = env.settings()
  const s2Client = s2.createScholarClient({
    apiKey: env.resolveApiKey,
    minGapMs: settings.s2RequestGapMs,
    timeoutMs: timeoutMsOf(settings.fetchTimeoutSec),
    signal: exec.signal,
  })
  // Last-resort title-search fallback via the DSH web service (same provider as
  // the `web_search` tool). Optional: if no web capability is available or it
  // errors, the fallback is silently skipped (searchWeb returns []).
  const web = ctx.get('web') as WebServiceLike | undefined
  const searchWeb = web
    ? async (query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchHit[]> => {
        try {
          const r = await web.search({ query, maxResults }, signal)
          return (r?.sources ?? []).map((s) => ({ url: s.url, title: s.title, snippet: s.snippet }))
        } catch {
          return []
        }
      }
    : undefined
  return {
    s2: s2Client,
    fetch: {
      settings,
      s2: s2Client,
      baseDir: baseDirOf(exec),
      signal: exec.signal,
      searchWeb,
    },
  }
}

/** Resolve a paper_fetch tool's input to a DOI: use the passed DOI directly, or
 * resolve a title via Crossref -> Semantic Scholar. Returns the DOI (undefined
 * when no DOI was given/resolvable) plus the resolution diagnostics. */
async function resolveInputDoi(rt: FetchRuntime, input: { doi?: string; title?: string }): Promise<{ doi: string | undefined; resolution?: unknown }> {
  if (input.doi) return { doi: input.doi }
  if (!input.title) return { doi: undefined }
  const r = await fetchSvc.resolveTitleToDoi(rt, input.title)
  return { doi: r.doi, resolution: r.resolution }
}

/** The identity the caller asked for, in the caller's own words (undefined for
 * a DOI-only request). Fed to the fetch chain's title gate. */
function expectedTitleOf(input: { title?: string }): string | undefined {
  const t = input.title?.trim()
  return t ? t : undefined
}

/** One failure line for the paper_fetch markdown, with the typed code and the
 * actionable reason. */
function failureLine(error: { code?: string; message?: string; reason?: string; retry_after_hours?: number } | undefined): string {
  if (!error) return '**Failed** (no error detail)'
  return `**Failed** [${error.code ?? 'error'}]: ${error.message ?? ''}${error.reason ? `\n\n> ${error.reason}` : ''}${error.retry_after_hours ? ` (retry after ~${error.retry_after_hours}h)` : ''}`
}

/**
 * Register one tool into `ctx.tools` with the two shared hardening wrappers,
 * shared by BOTH tool families so the copy cannot drift:
 *  - execute -> the returned value is always lossless JSON (DSH rejects any
 *    result containing undefined/NaN/±Infinity/-0/sparse arrays). Upstream data
 *    is messy, so everything goes through the sanitizer before snapshotting.
 *  - render  -> MUST return ContentBlock[]; a bare string makes the model-run
 *    pipeline fail ("content.some is not a function"). Normalise any non-array
 *    return (string or none) to a text block, using `fallbackText` when nothing
 *    else is available.
 */
function registerTool(ctx: Context, disposers: Array<() => void>, tool: ReturnType<typeof defineTool>, fallbackText: (value: unknown) => string): boolean {
  const tools = ctx.get('tools')
  if (!tools) return false
  const execute = tool.execute.bind(tool)
  const render = tool.output.render.bind(tool.output)
  disposers.push(tools.register({
    ...tool,
    execute: async (args, exec) => sanitizeForOutput(await execute(args, exec)),
    output: {
      ...tool.output,
      render: (args: unknown, value: unknown) => {
        const rendered = render(args as never, value as never)
        if (Array.isArray(rendered)) return rendered
        if (typeof rendered === 'string') return [{ type: 'text', text: rendered }]
        return [{ type: 'text', text: fallbackText(value) }]
      },
    },
  }))
  return true
}

/** Register every scholar tool; returns a disposer that unregisters all. */
export function applyScholarTools(ctx: Context, env: ScholarToolEnv): () => void {
  const disposers: Array<() => void> = []
  disposers.push(applySciverseTools(ctx, env))

  const register = (tool: ReturnType<typeof defineTool>): void => {
    registerTool(ctx, disposers, tool, (value) => `Result (${String(value != null ? (value as { total?: unknown }).total ?? '' : '')})`)
  }

  // -------------------------------------------------------------------------
  // scholar_search_* — discovery
  // -------------------------------------------------------------------------

  register(defineTool({
    name: 'scholar_search_papers',
    description: `Search Semantic Scholar for academic papers by query.
Use when: literature discovery — broad topics, boolean queries, filters (year, venue, field, min citations, type, OA).
Not for: passage retrieval (\`scholar_search_papers_by_snippet\`), a known title's DOI (\`scholar_match_title\`), or the Sciverse corpus's structured screening (\`sciverse_search_papers\`).
Returns: ranked rows carrying venue / fieldsOfStudy / publicationTypes / isOpenAccess plus an \`offTopic\` flag for narrow queries — triage without opening each record. Bulk is preferred; TLDR only via the relevance strategy.`,
    parameters: {
      query: { type: 'string', description: 'Search query. For precision use boolean syntax via the `boolean` parameter instead of raw operators.', required: true },
      boolean: {
        type: 'object',
        description: 'Structured boolean query components (exact phrases, +required, -excluded, OR groups, fuzzy/proximity). Preferred over raw boolean syntax.',
        properties: {
          phrases: { type: 'array', items: { type: 'string', description: 'Exact phrase' } },
          required: { type: 'array', items: { type: 'string', description: 'Required term (+term)' } },
          excluded: { type: 'array', items: { type: 'string', description: 'Excluded term (-term)' } },
          orTerms: { type: 'array', items: { type: 'string', description: 'OR group' } },
        },
        additionalProperties: true,
      },
      year: { type: 'string', description: 'Year filter: "2020-", "-2019", "2016-2020"' },
      publicationDate: { type: 'string', description: 'Date range YYYY-MM-DD:YYYY-MM-DD (open-ended OK)' },
      venue: { type: 'string', description: 'Venue restriction, e.g. NeurIPS' },
      fieldsOfStudy: { type: 'string', description: 'e.g. Medicine, Computer Science' },
      minCitationCount: { type: 'integer', description: 'Only established papers with at least this many citations' },
      publicationTypes: { type: 'string', description: 'e.g. Review, JournalArticle, Conference, ClinicalTrial, MetaAnalysis, Dataset' },
      openAccess: { type: 'boolean', description: 'Only open-access papers' },
      sort: { type: 'string', enum: ['citationCount:desc', 'publicationDate:desc', 'paperId:asc'], description: 'Result ordering (default citationCount:desc)' },
      maxResults: { type: 'integer', description: 'Result cap (default from settings, max 100)' },
      includeTldr: { type: 'boolean', description: 'Use the relevance strategy so TLDR summaries are available (slower)' },
      strictTopic: { type: 'boolean', description: 'Drop hits that share no significant term with a narrow query (default false — hits are only flagged `offTopic`, so cross-disciplinary work is never silently discarded)' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          total: { type: 'integer' },
          strategy: { type: 'string' },
          markdown: { type: 'string' },
          results: { type: 'array', items: { type: 'json' } },
        },
        additionalProperties: true,
      },
      render(_args, value: any) {
        return text(value.markdown ?? `Search finished: ${value.total ?? 0} papers.`)
      },
    },
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const builtQuery = args.boolean ? s2.buildBoolQuery(args.boolean) : args.query
      const query = (builtQuery ?? '').trim() || String(args.query ?? '').trim()
      const strategy = args.includeTldr ? 'relevance' : 'bulk'
      const maxResults = Math.max(1, Math.min(args.maxResults ?? env.settings().maxResultsPerSearch, SEARCH_RESULT_CAP))
      if (!query) {
        return { query, total: 0, strategy, offTopic: 0, markdown: 'scholar_search_papers needs a non-empty `query` (or a `boolean` with at least one term).', results: [] }
      }
      const papers = args.includeTldr
        ? await s2.searchRelevance(client, query, {
            maxResults,
            filters: pickFilters(args),
          })
        : await s2.searchBulk(client, query, {
            maxResults,
            sort: args.sort ?? 'citationCount:desc',
            filters: pickFilters(args),
          })
      const deduped = s2.deduplicate(papers)
      // Off-topic annotation: only a NARROW query (2+ significant terms, no
      // OR-group) with zero shared terms is flagged. Annotation is the default;
      // strictTopic opts into dropping those hits.
      const scored = deduped.map((p) => ({
        paper: p,
        overlap: topicOverlap(query, { title: p.title, venue: p.venue, fieldsOfStudy: p.fieldsOfStudy, abstract: p.abstract }),
      }))
      const kept = args.strictTopic ? scored.filter((s) => !s.overlap.offTopic) : scored
      const offTopicCount = scored.filter((s) => s.overlap.offTopic).length
      // compactPapers rows are lossless JSON objects; the extra flag is added here.
      const rows = (fmt.compactPapers(kept.map((s) => s.paper)) as any[])
        .map((row, i) => ({ ...row, offTopic: kept[i]!.overlap.offTopic }))
      const note = offTopicCount
        ? `\n> ${offTopicCount} hit(s) share no significant term with the query — flagged \`offTopic\`${args.strictTopic ? ' (already dropped)' : ' but kept: drop them with `strictTopic: true`, or treat the list as unranked for this query'}.`
        : ''
      return {
        query,
        total: kept.length,
        strategy,
        offTopic: offTopicCount,
        markdown: `${note}\n${fmt.formatResults(kept.map((s) => s.paper), query.slice(0, 120))}`,
        results: rows,
      }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_search_papers_by_snippet',
    description: `Search Semantic Scholar full text for PAPERS that contain a specific passage/sentence/method and return the matched snippet with its paper.
Use when: the user quotes or paraphrases a specific method or sentence and wants the papers containing it.
Not for: topical discovery (\`scholar_search_papers\`) or reading one known paper (\`scholar_get_paper_snippets\`, \`arxiv_get_fulltext\`, \`sciverse_read_content\`).
Returns: one matched snippet plus its paper per hit; empty means the index lacks that passage, not an API failure.`,
    parameters: {
      query: { type: 'string', description: 'Passage/method text to find in full-text bodies', required: true },
      paperIds: { type: 'string', description: 'Optional comma-separated paperIds to scope the search' },
      authors: { type: 'string', description: 'Optional comma-separated authorIds to scope the search' },
      insertedBefore: { type: 'string', description: 'YYYY-MM-DD: restrict to snippets ingested before this date' },
      maxResults: { type: 'integer', description: 'Result cap (default 10)' },
    },
    output: {
      schema: { type: 'object', properties: { query: { type: 'string' }, total: { type: 'integer' }, snippets: { type: 'array', items: { type: 'json' } } }, additionalProperties: true },
      render(_args, value: any) {
        const rows = (value.snippets ?? []).map((s: any, i: number) => `- ${i + 1}. ${s.snippet?.text ?? ''}`)
        return text(`**${value.total ?? 0} snippet hits** for "${value.query}"\n\n${rows.slice(0, 10).join('\n')}`)
      },
    },
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const snippets = await s2.searchSnippets(client, args.query, {
        maxResults: args.maxResults ?? s2.DEFAULT_SNIPPETS,
        paperIds: args.paperIds,
        authors: args.authors,
        insertedBefore: args.insertedBefore,
      })
      return { query: args.query, total: snippets.length, snippets }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_match_title',
    description: `Resolve a paper title to its exact Semantic Scholar record (paperId, DOI, metadata).
Use when: only a title is known and a DOI/paperId is needed before any other call.
Not for: fuzzy topic search (\`scholar_search_papers\`).
Returns: \`matched\` plus a \`titleCheck\` verdict; when the best hit is a different work it reports \`matched:false\` instead of a confident wrong record — ask the user for the DOI rather than using that record.`,
    parameters: { title: { type: 'string', description: 'Exact paper title', required: true } },
    output: markdownOutput(
      { matched: { type: 'boolean' }, titleCheck: { type: 'json' }, paper: { type: 'json' } },
      (value) => 'No match.',
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const d = await s2.matchTitle(client, args.title)
      const paper = (d.data ?? [])[0]
      if (!paper) return { matched: false, markdown: `No Semantic Scholar match for "${args.title}".` } as any
      const check = titleVerdict(args.title, paper.title)
      // A fuzzy title search can surface a DIFFERENT paper. Handing that back as
      // a confident match is how a wrong DOI gets written into a card.
      if (!titleAccepted(check)) {
        return {
          matched: false,
          titleCheck: check,
          paper: fmt.compactPapers([paper])[0] ?? null,
          markdown: `**No confident match for "${args.title}".**\n\nThe best Semantic Scholar hit is a different work (${describeTitleCheck(check)}):\n\n- returned: ${paper.title ?? 'untitled'}${fmt.doiOfPaper(paper) ? ` (DOI: ${fmt.doiOfPaper(paper)})` : ''}\n\nAsk the user for the DOI, or re-query with the exact published title — do not use this record.`,
        } as any
      }
      return {
        matched: true,
        titleCheck: check,
        markdown: fmt.formatResults([paper], args.title),
        paper: fmt.compactPapers([paper])[0],
      } as any
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_get_paper',
    description: `Fetch one paper by ID.
ID forms: DOI:10.xxxx/..., ARXIV:2106.15928, PMID:..., PMCID:..., CorpusId:....
Use when: a DOI or arXiv id is already in hand and its metadata (or an identity check) is needed.
Not for: title lookup (\`scholar_match_title\`) or full text (\`scholar_get_paper_snippets\`, \`arxiv_get_fulltext\`, \`sciverse_read_content\`).
Returns: the record plus a \`titleCheck\` verdict (pass \`expectedTitle\` for ids taken from a list/table; a mismatch means the id resolves to a DIFFERENT work — do not cite it). Record it with \`scholar_card_save\`, which derives the card's path itself.`,
    parameters: {
      paperId: { type: 'string', description: 'Paper id with prefix, e.g. DOI:10.1038/s41586-020-2649-2', required: true },
      includeAbstract: { type: 'boolean', description: 'Also fetch the abstract and render it as its own **Abstract:** line (plus the `paper.abstract` field) — larger response; search results never carry one.' },
      expectedTitle: { type: 'string', description: 'Title you expect this id to resolve to; enables the title_mismatch warning (recommended for ids taken from a list result)' },
    },
    output: markdownOutput(
      { paperId: { type: 'string' }, titleCheck: { type: 'json' }, verification: { type: 'string' }, paper: { type: 'json' } },
      (value) => `Paper ${value.paperId ?? 'unknown'}.`,
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const paper = await s2.getPaper(client, args.paperId, args.includeAbstract ? undefined : 'title,year,citationCount,authors,venue,externalIds,tldr,openAccessPdf')
      const check = args.expectedTitle ? titleVerdict(args.expectedTitle, paper.title) : undefined
      const checkJson = check
        ? { verdict: check.verdict, similarity: check.similarity, expected: check.expected ?? null, actual: check.actual ?? null }
        : undefined
      const warning = check
        ? check.verdict === 'mismatch'
          ? `> ⚠️ **Title mismatch for \`${args.paperId}\`** — ${describeTitleCheck(check)}.\n> - expected: ${check.expected}\n> - returned: ${check.actual ?? '(no title)'}\n> Do **not** cite this identifier or write it into a card; re-resolve with \`scholar_match_title\` or ask the user for the correct DOI.\n\n`
          : `> ${describeTitleCheck(check)}\n\n`
        : ''
      return {
        paperId: args.paperId,
        ...(check && checkJson ? { titleCheck: checkJson, verification: check.verdict } : { verification: 'unverified' }),
        markdown: `${warning}${fmt.formatResults([paper], (paper.title ?? args.paperId).slice(0, 120))}`,
        paper: fmt.compactPapers([paper])[0] ?? null,
      }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_get_paper_snippets',
    description: `Get ~500-word full-text content snippets from the Ai2 Asta corpus (the Semantic Scholar owner's full-text index, not exposed by the public S2 API).
Use when: a specific passage from one known paper is needed and the Asta key is configured.
Not for: whole-paper reading (\`arxiv_get_fulltext\`, \`sciverse_read_content\`, \`paper_pdf2md\`) or discovery (\`scholar_search_papers\`).
Returns: verbatim snippets plus paper metadata. A \`query\` is required; pass \`paperIds\` to scope. An unconfigured key is reported as such — point the user at the Plugins page, do not retry.
Card it: \`scholar_card_save\` (see \`scholar-memory\`).`,
    parameters: {
      query: { type: 'string', description: 'Text to find in the paper(s) — the topic, a phrase, or the paper title. Required.', required: true },
      paperIds: { type: 'string', description: 'Restrict to these papers: comma-separated S2 IDs, CorpusId:<id>, DOI:<doi>, ARXIV:<id>, PMID:<id>, PMCID:<id>.' },
      limit: { type: 'integer', description: `Max snippets to return (default ${ASTA_DEFAULT_LIMIT})` },
      venues: { type: 'string', description: 'Restrict to venues (comma-separated), e.g. "Nature,N. Engl. J. Med."' },
      insertedBefore: { type: 'string', description: 'YYYY-MM-DD: only snippets ingested before this date' },
    },
    output: markdownOutput(
      { snippets: { type: 'array', items: { type: 'json' } } },
      (value) => 'No content returned.',
    ),
    async execute(args, exec) {
      const apiKey = await env.resolveAstaKey()
      if (!apiKey) {
        return { markdown: 'Asta content tool is not configured. Add an `astaApiKeyRef` in the plugin configuration (Web UI: Plugins page -> dsh-scholar-find) to enable it.', snippets: [] }
      }
      const snippets = await astaSnippetSearch(apiKey, {
        query: args.query,
        paper_ids: args.paperIds,
        limit: args.limit ?? ASTA_DEFAULT_LIMIT,
        venues: args.venues,
        inserted_before: args.insertedBefore,
      }, ASTA_TIMEOUT_MS, exec.signal)
      const jsonSnippets = snippets.map((s) => ({
        score: s.score,
        paper: {
          corpusId: s.paper?.corpusId,
          title: s.paper?.title,
          authors: s.paper?.authors ?? [],
          openAccessInfo: s.paper?.openAccessInfo ?? null,
        },
        snippet: { text: s.snippet?.text, snippetKind: s.snippet?.snippetKind ?? null, section: s.snippet?.section ?? null },
      }))
      // Data came from JSON.parse (lossless); cast through `any` so the tool's
      // JsonValue output contract is satisfied, then the lossless guard applies.
      return { markdown: fmtAsta(snippets), snippets: jsonSnippets as any }
    },
    timeoutMs: ASTA_TIMEOUT_MS + ASTA_TOOL_TIMEOUT_MARGIN_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_get_citations',
    description: `List the papers citing a known paper, with optional intent labels (methodology/background/result) and context snippets.
Use when: who-cites-X or citation-context questions on S2-indexed papers.
Not for: what-X-cites (\`scholar_get_references\`) or deep in-platform relation paging (\`sciverse_list_paper_relations\`).
Returns: citing papers plus a COVERAGE verdict — S2's graph is often incomplete, so "N citing papers" may be truncated or partial rather than a total. \`coverage\`: complete/truncated/partial/not_indexed/empty; when S2 serves none for a DOI it falls back to the Sciverse relations index (labelled). \`checkCoverage:false\` skips the extra count lookup.`,
    parameters: {
      paperId: { type: 'string', description: 'Paper id (e.g. DOI:10.48550/arXiv.1706.03762)', required: true },
      maxResults: { type: 'integer', description: 'Result cap (default 100)' },
      publicationDate: { type: 'string', description: 'Filter citing papers by date YYYY-MM-DD or range' },
      withIntents: { type: 'boolean', description: 'Include contextsWithIntent (larger response)' },
      checkCoverage: { type: 'boolean', description: 'Compare the returned list against the record\'s own citation count (one extra paced request, default true) — distinguishes an empty list from an unindexed one. Skipping it only removes the count request: the empty-list second-source fallback is unaffected.' },
    },
    output: markdownOutput(
      { total: { type: 'integer' }, coverage: { type: 'json' }, fallback: { type: 'json' }, citations: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} citing papers.`,
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const maxResults = args.maxResults ?? s2.DEFAULT_CITATIONS
      const page = await s2.getCitations(client, args.paperId, { maxResults, publicationDate: args.publicationDate, withIntents: args.withIntents })
      const counts = args.checkCoverage === false ? undefined : await bestEffortSeedCounts(client, args.paperId)
      const coverage = computeCoverage({ returned: page.items.length, requestedCap: maxResults, hasMore: page.hasMore, ...(counts?.citationCount !== undefined ? { seedCount: counts.citationCount } : {}), kind: 'citing papers' })
      const fallback = await relationsFallback(env, args.paperId, 'CITATIONS', coverage, exec.signal)
      const citations = page.items
      const lines = citations.slice(0, 20).map((c: any, i: number) => {
        const p = c.citingPaper ?? {}
        const intents = args.withIntents ? [...new Set((c.contextsWithIntent ?? []).flatMap((e: any) => e.intents ?? []))].join(', ') : ''
        return `### ${i + 1}. ${p.title ?? 'Untitled'} (${p.year ?? '?'}) — cites: ${p.citationCount ?? 0}${intents ? `\n**Intents:** ${intents}` : ''}`
      })
      const body = citations.length
        ? `${lines.join('\n')}${citations.length > 20 ? `\n\n…and ${citations.length - 20} more` : ''}`
        : coverage.status === 'not_indexed'
          ? 'The S2 graph serves no citing papers for this record.'
          : 'No citing papers found.'
      return {
        total: citations.length,
        coverage: coverageJson(coverage),
        ...(fallback ? { fallback: fallback.json } : {}),
        markdown: `**${coverage.label}.**\n\n${body}${fallback ? `\n\n${fallback.markdown}` : ''}`,
        citations,
      }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_get_references',
    description: `List the papers a known paper cites (backward citations).
Use when: what-does-X-cite questions or building a related-work pool.
Not for: who-cites-X (\`scholar_get_citations\`) or deep in-platform relation paging (\`sciverse_list_paper_relations\`).
Returns: cited papers plus a COVERAGE verdict — a zero-row answer for a record that HAS a reference list means "not indexed by S2", not "cites nothing". \`coverage\`: complete/truncated/partial/not_indexed/empty; a DOI with no S2 rows falls back to the Sciverse relations index (labelled). \`checkCoverage:false\` skips the extra count lookup.`,
    parameters: {
      paperId: { type: 'string', description: 'Paper id', required: true },
      maxResults: { type: 'integer', description: 'Result cap (default 100)' },
      checkCoverage: { type: 'boolean', description: 'Compare the returned list against the record\'s own reference count (one extra paced request, default true) — distinguishes an empty list from an unindexed one. Skipping it only removes the count request: the empty-list second-source fallback is unaffected.' },
    },
    output: markdownOutput(
      { total: { type: 'integer' }, coverage: { type: 'json' }, fallback: { type: 'json' }, references: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} references.`,
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const maxResults = args.maxResults ?? s2.DEFAULT_CITATIONS
      const page = await s2.getReferences(client, args.paperId, { maxResults })
      const counts = args.checkCoverage === false ? undefined : await bestEffortSeedCounts(client, args.paperId)
      const coverage = computeCoverage({ returned: page.items.length, requestedCap: maxResults, hasMore: page.hasMore, ...(counts?.referenceCount !== undefined ? { seedCount: counts.referenceCount } : {}), kind: 'references' })
      const fallback = await relationsFallback(env, args.paperId, 'REFERENCES', coverage, exec.signal)
      const refs = page.items
      return {
        total: refs.length,
        coverage: coverageJson(coverage),
        ...(fallback ? { fallback: fallback.json } : {}),
        markdown: refs.length
          ? `**${coverage.label}**\n\n${fmt.formatResults(refs.map((r: any) => r.citedPaper ?? r), 'References')}${fallback ? `\n\n${fallback.markdown}` : ''}`
          : `**${coverage.label}**${fallback ? `\n\n${fallback.markdown}` : ''}`,
        references: refs,
      }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_get_recommendations',
    description: `Recommend papers similar to one or more seed papers; negative seeds steer away from unwanted topics.
Use when: find-papers-similar-to-X requests — more precise than keyword search once a good seed exists.
Not for: broad keyword discovery (\`scholar_search_papers\`).
Returns: recommended papers. Poor seeds give poor output — improve the seeds, do not just re-call.`,
    parameters: {
      positiveIds: { type: 'array', items: { type: 'string', description: 'Seed paper id' }, description: 'Seed papers (1+); recommendedPaperIds style ids or DOI:/ARXIV: forms', required: true },
      negativeIds: { type: 'array', items: { type: 'string', description: 'Seed paper id to steer away from' }, description: 'Optional negative seeds' },
      limit: { type: 'integer', description: 'Recommendation count (default 10, max 500)' },
    },
    output: markdownOutput(
      { total: { type: 'integer' }, papers: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} recommendations.`,
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      if (!args.positiveIds?.length) {
        return { total: 0, markdown: 'scholar_get_recommendations needs at least one `positiveIds` seed.', papers: [] }
      }
      const papers = args.positiveIds.length === 1 && !args.negativeIds
        ? await s2.findSimilar(client, args.positiveIds[0]!, { limit: args.limit ?? s2.DEFAULT_RECS })
        : await s2.recommend(client, { positiveIds: args.positiveIds, negativeIds: args.negativeIds, limit: args.limit ?? s2.DEFAULT_RECS })
      return { total: papers.length, markdown: fmt.formatResults(papers, 'Recommendations'), papers }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_search_authors',
    description: `Find researchers by name (affiliations, paper count, citations, h-index).
Use when: the user names a researcher rather than a paper.
Not for: a resolved authorId's profile (\`scholar_get_author\`).
Returns: candidate authors. Common names are ambiguous — disambiguate by affiliation before \`scholar_get_author\`.`,
    parameters: { query: { type: 'string', description: 'Author name', required: true }, maxResults: { type: 'integer', description: `Result cap (default ${s2.DEFAULT_AUTHORS}, max ${s2.S2_AUTHOR_SEARCH_MAX})` } },
    output: markdownOutput(
      { total: { type: 'integer' }, authors: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} authors.`,
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const authors = await s2.searchAuthors(client, args.query, args.maxResults ?? s2.DEFAULT_AUTHORS)
      return { total: authors.length, markdown: fmt.formatAuthors(authors), authors }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_get_author',
    description: `One author profile by authorId (affiliations, paper count, citations, h-index).
Use when: an author was disambiguated via \`scholar_search_authors\` and the profile is needed.
Not for: listing that author's papers (\`scholar_get_author_papers\`).
Returns: the profile record. A wrong authorId silently yields a different author — compare the returned name/affiliations before using it, and re-disambiguate if they do not match.`,
    parameters: { authorId: { type: 'string', description: 'Semantic Scholar authorId', required: true } },
    output: markdownOutput(
      { authorId: { type: 'string' }, author: { type: 'json' } },
      (value) => `Author ${value.authorId ?? 'unknown'}.`,
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const author = await s2.getAuthor(client, args.authorId)
      const p = { ...author, affiliations: author.affiliations ?? [], paperCount: author.paperCount ?? 0 }
      return { authorId: args.authorId, markdown: fmt.formatAuthors([p]), author }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_get_author_papers',
    description: `An author's publication list by authorId.
Use when: list-X's-papers requests, or scanning an author's output for a topic.
Not for: the author profile itself (\`scholar_get_author\`) or topic search (\`scholar_search_papers\`).
Returns: the author's papers, capped by \`maxResults\`; prolific authors return long lists — filter locally.`,
    parameters: { authorId: { type: 'string', description: 'Semantic Scholar authorId', required: true }, maxResults: { type: 'integer', description: 'Result cap (default 100)' } },
    output: markdownOutput(
      { total: { type: 'integer' }, papers: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} papers.`,
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const papers = await s2.getAuthorPapers(client, args.authorId, args.maxResults ?? s2.DEFAULT_CITATIONS)
      return { total: papers.length, markdown: fmt.formatResults(papers, 'Author papers'), papers: fmt.compactPapers(papers) }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_export_bibtex',
    description: `Export BibTeX entries for up to 500 papers (by paperId or DOI:...).
Use when: the user collects references — offer it at the end of a search task.
Not for: a styled, footnote-ready reference list (\`scholar_format_references\`).
Returns: the BibTeX text (\`count\` entries) plus \`unresolved\` — the ids that produced NO entry (no Semantic Scholar record, or a record without \`citationStyles.bibtex\`), reported rather than crashing.`,
    parameters: { ids: { type: 'array', items: { type: 'string', description: 'paperId or DOI:id' }, description: 'Papers to export', required: true } },
    output: {
      schema: { type: 'object', properties: { count: { type: 'integer' }, unresolved: { type: 'array', items: { type: 'string' } }, bibtex: { type: 'string' } }, additionalProperties: true },
      render(_args, value: any) {
        const note = Array.isArray(value?.unresolved) && value.unresolved.length
          ? `\n\n> ${value.unresolved.length} id(s) not resolved by Semantic Scholar (no BibTeX entry): ${value.unresolved.map((i: string) => `\`${i}\``).join(', ')}`
          : ''
        return text((value?.bibtex || 'No BibTeX entries available.') + note)
      },
    },
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const ids = args.ids.slice(0, 500)
      const papers = await s2.batchPapers(client, ids, 'title,citationStyles')
      // S2 keeps the request order but answers `null` for an id it cannot
      // resolve. `entries[i]` is the BibTeX for ids[i] ('' when none), so the
      // count, the unresolved list and the rendered text all come from one
      // projection and cannot disagree.
      const entries = fmt.bibtexEntries(papers)
      const unresolved = ids.filter((_, i) => !entries[i])
      const exported = entries.filter(Boolean)
      return { count: exported.length, unresolved, bibtex: exported.join('\n\n') }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  // -------------------------------------------------------------------------
  // scholar_format_* — reference formatting (citation contract)
  // -------------------------------------------------------------------------

  register(defineTool({
    name: 'scholar_format_references',
    description: `Format a reference list in ONE declared citation style, so formatting is decided by the plugin instead of re-derived per report.
Use when: a report needs numbered references or footnotes in a specific style (GB/T 7714-2015 for Chinese reports) — load \`scholar-citation-style\` with it.
Not for: raw BibTeX export (\`scholar_export_bibtex\`).
Returns: numbered \`entries\` plus \`footnote_block\` — ready \`[^n]: entry\` definitions, blank-line separated, numbered by first-reference order — per the \`scholar-citation-style\` contract. Give \`ids\` (resolved via Semantic Scholar) and/or \`items\`; it never invents missing volume/pages, and an id without a record comes back as a warning.`,
    parameters: {
      ids: { type: 'array', items: { type: 'string', description: 'paperId or DOI:…' }, description: `Papers to format (max ${REFS_MAX_IDS}); metadata is resolved from Semantic Scholar` },
      items: { type: 'array', items: { type: 'json' }, description: 'Explicit entries: { authors: string[], title, venue, year, volume, issue, pages, doi, url, type, bibtex }' },
      style: { type: 'string', enum: [...CITATION_STYLES], description: 'Target citation style (gb-t-7714-2015 = GB/T 7714-2015 for Chinese reports; bibtex passes through supplied bibtex)' },
      start_index: { type: 'integer', description: 'Footnote number of the first entry (default 1); entries are numbered consecutively from it in first-reference order' },
    },
    output: markdownOutput(
      { count: { type: 'integer' }, style: { type: 'string' }, entries: { type: 'array', items: { type: 'json' } }, footnote_block: { type: 'string' }, warnings: { type: 'array', items: { type: 'string' } } },
      (value) => `${value.count ?? 0} references (${value.style ?? ''}).`,
    ),
    async execute(args, exec) {
      const items = Array.isArray(args.items) ? (args.items as ReferenceMeta[]) : []
      const ids = (Array.isArray(args.ids) ? args.ids : []).map((i: unknown) => String(i).trim()).filter(Boolean)
      if (!items.length && !ids.length) {
        return { count: 0, style: args.style ?? 'gb-t-7714-2015', entries: [], footnote_block: '', warnings: [], markdown: 'scholar_format_references needs `ids` or `items`.' } as any
      }
      const capped = ids.slice(0, REFS_MAX_IDS)
      const warnings: string[] = []
      if (ids.length > REFS_MAX_IDS) warnings.push(`Only the first ${REFS_MAX_IDS} ids were formatted (${ids.length} given).`)
      let resolved: ReferenceMeta[] = []
      if (capped.length) {
        const { s2: client } = runtimeOf(ctx, env, exec)
        const fields = args.style === 'bibtex' ? `${REFS_FIELDS},citationStyles` : REFS_FIELDS
        const papers = await s2.batchPapers(client, capped, fields)
        resolved = capped.map((id, i) => {
          const record = papers[i] as Record<string, any> | undefined
          // The batch endpoint mirrors the request order, but formatting an
          // author/title/DOI from a MISMATCHED row would fabricate a citation —
          // the exact failure this work removes — so verify the record's own
          // identifiers before trusting it.
          if (record && !recordMatchesId(record, id)) {
            warnings.push(`Semantic Scholar returned a different record for \`${id}\` (got "${record.title ?? 'untitled'}") — the entry below carries the identifier only; verify it before citing.`)
            return { title: id }
          }
          const meta = referenceMetaFromS2Paper(record)
          if (!meta.title) warnings.push(`No Semantic Scholar record for \`${id}\` — formatted from the identifier alone; verify it before citing.`)
          return meta
        })
      }
      const all = [...items, ...resolved]
      const style = (CITATION_STYLES as readonly string[]).includes(String(args.style)) ? (args.style as CitationStyle) : 'gb-t-7714-2015'
      const entries = formatReferences(all, style, args.start_index ?? 1)
      const block = footnoteBlock(entries)
      const lines = entries.map((e) => `${e.index}. ${e.text}`)
      const markdown = [
        `**${entries.length} reference(s) in ${style}** — markers are FIRST-MENTION ONLY; use the footnote block verbatim at the end of the document, blank line between definitions.`,
        '',
        lines.join('\n'),
        '',
        '```markdown',
        block,
        '```',
        warnings.length ? `\n> ${warnings.join('\n> ')}` : '',
      ].join('\n')
      return {
        count: entries.length,
        style,
        entries,
        footnote_block: block,
        warnings,
        markdown,
      }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  // -------------------------------------------------------------------------
  // scholar_card_* — the persistent memory card library (working memory)
  //
  // The card library is the plugin's memory of what has been INVESTIGATED, as
  // opposed to what has been searched. It used to be authored entirely by the
  // model from the `scholar-memory` skill; two real-world rounds (.notes/63,
  // 65) showed the hand-rolled template + two citation calls + provenance
  // formatting being deferred to report time or skipped outright, which is
  // exactly when a memory stops being one (.notes/77). These two tools take
  // over the mechanical half — identity gate, citation population, append-only
  // merge, provenance format — so the model's remaining job is one call at the
  // moment it finishes reading a paper.
  // -------------------------------------------------------------------------

  register(defineTool({
    name: 'scholar_card_save',
    description: `Persist ONE investigated paper as a memory card (\`cards/\` under the output dir): verify its identity, populate Citation Backtrack/Forwardtrack, bind an optional verbatim quote with provenance. Append-only.
Use when: a paper has just been fetched or read — call it before moving to the next paper. This is working memory, not report-time cleanup.
Not for: discovery or reading (\`scholar_search_*\`, \`sciverse_*\`, \`arxiv_get_fulltext\`, \`paper_pdf2md\`) or recalling the library (\`scholar_card_list\`).
Returns: \`status\` (created/updated/refused), the card \`path\`, what each section gained, the \`coverage\` label recorded per citation section, and \`identityCheck\`. \`refused\` means NOTHING was written — the id resolved to a different work than \`expectedTitle\`; re-resolve it and do not cite it.`,
    parameters: {
      paperId: { type: 'string', description: 'The work to card: an id (DOI:/ARXIV:/`paper:<doi>`/…) **or its title** — a title is resolved via Semantic Scholar, then Sciverse. Keyed by the DOI, else the arXiv id, else the Sciverse key.', required: true },
      expectedTitle: { type: 'string', description: 'Title it should resolve to; enables the identity gate (pass the title you actually saw). A mismatch writes NOTHING.' },
      quote: { type: 'string', description: "Verbatim excerpt to bind as evidence (the source's own words, never rephrased); omit only when nothing has been read yet." },
      docId: { type: 'string', description: 'Provenance: the Sciverse doc_id the quote came from (stored beside the quote — it churns on re-ingest).' },
      offset: { type: 'integer', description: 'Provenance: character offset of the quote inside that doc_id.' },
      page: { type: 'string', description: 'Provenance: page number, when the source exposes one.' },
      finding: { type: 'string', description: 'Short note on what the quote shows; the quote carries the evidence.' },
      keywords: { type: 'array', items: { type: 'string', description: 'One keyword' }, description: "3-5 core keywords for the card's Keywords line (a set — completed, not appended)." },
      citations: { type: 'boolean', description: 'Populate Citation Backtrack/Forwardtrack from S2 (default true; 2 paced requests). Set false only when the quota is exhausted.' },
    },
    output: markdownOutput(
      { status: { type: 'string' }, path: { type: 'string' }, created: { type: 'boolean' }, added: { type: 'json' }, coverage: { type: 'json' }, identityCheck: { type: 'json' } },
      (value) => `Card ${value.status ?? 'unknown'}${value.path ? ` at ${value.path}` : ''}.`,
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const settings = env.settings()
      const raw = (args.paperId ?? '').trim()
      // A title is a first-class input (see `looksLikePaperId`): the Sciverse RAG
      // path produces titles, not ids.
      const asTitle = Boolean(raw) && !looksLikePaperId(raw)
      const paperId = normalizeCardPaperId(raw)

      // Resolve the record. S2 is the primary identity authority, but every
      // chain that feeds this tool is Sciverse-native and Sciverse holds works
      // S2 does not (Chinese journals, theses). A S2 miss therefore falls
      // through to the source that actually has the paper, and only a total
      // miss degrades to `unverified` — failing the write on a 404 is what
      // .notes/78 R1 removed, because it turned "cards get deferred" into
      // "cards never happen" on exactly that corpus.
      let record: Record<string, any> | undefined
      let identitySource: 'semantic-scholar' | 'sciverse' | 'none' = 'none'
      let s2Miss: string | undefined
      if (!asTitle) {
        try {
          record = await s2.getPaper(client, paperId, CARD_PAPER_FIELDS)
          identitySource = 'semantic-scholar'
        } catch (err) {
          s2Miss = err instanceof s2.ScholarHttpError ? err.code : 'request_failed'
        }
        if (!record) {
          const alt = await sciverseIdentityLookup(env, paperId, exec.signal)
          if (alt) {
            record = alt
            identitySource = 'sciverse'
          }
        }
      } else {
        // Title path: S2 first (it yields a DOI), then the Sciverse index. Both
        // are gated on the title matching, so a near-miss cannot become a card.
        try {
          const d = await s2.matchTitle(client, raw)
          const hit = (d?.data ?? [])[0]
          if (hit?.title && titleAccepted(titleVerdict(raw, hit.title))) {
            record = hit
            identitySource = 'semantic-scholar'
          }
          s2Miss = 'title_not_matched'
        } catch (err) {
          s2Miss = err instanceof s2.ScholarHttpError ? err.code : 'request_failed'
        }
        if (!record) {
          const alt = await sciverseTitleLookup(env, raw, exec.signal)
          if (alt) {
            record = alt
            identitySource = 'sciverse'
          }
        }
      }

      const check = args.expectedTitle ? titleVerdict(args.expectedTitle, record?.title) : undefined
      // The identity gate is the whole reason the card is written by a tool: a
      // DOI copied out of a list has resolved to an unrelated work in practice.
      // It refuses ONLY on a resolved record that genuinely differs — `unknown`
      // means there was nothing to compare, which must never be a refusal.
      if (check?.verdict === 'mismatch') {
        return {
          status: 'refused',
          identityCheck: { verdict: check.verdict, similarity: check.similarity, expected: check.expected ?? null, actual: check.actual ?? null, source: identitySource },
          markdown: `**Nothing written.** \`${raw}\` resolves to a different work (${describeTitleCheck(check)}):\n\n- expected: ${check.expected}\n- returned: ${check.actual ?? '(no title)'}\n\nRe-resolve the id with \`scholar_match_title\`, or ask the user for the correct DOI — do not cite this identifier.`,
        } as any
      }
      // Key from the resolved record when there is one, else from what the
      // caller passed: a card under a verified key beats no card at all.
      const identifier = cardIdentifier(record) ?? identifierFromPaperId(paperId)
      if (!identifier) {
        return { status: 'refused', markdown: `**Nothing written.** \`${args.paperId}\` carries no DOI, arXiv id or paperId to key a card by.` } as any
      }
      const relPath = cardPath(settings.defaultOutputDir, identifier)
      const dir = resolveSubDir(resolveRootDir(settings.defaultOutputDir, baseDirOf(exec)), 'cards')
      const dest = join(dir, cardFilename(identifier))
      let existing: string | undefined
      try {
        existing = await readFile(dest, 'utf8')
      } catch {
        existing = undefined // absent (or unreadable) -> a fresh card is rendered
      }

      const citationErrors: string[] = []
      let backtrack: cardstore.CitationUpdate | undefined
      let forwardtrack: cardstore.CitationUpdate | undefined
      let backtrackCoverage: Coverage | undefined
      let forwardtrackCoverage: Coverage | undefined
      if (args.citations !== false && identitySource === 'semantic-scholar') {
        // The record's own counts came with the identity lookup above, so no
        // extra `getPaperCounts` request is needed (R7).
        const back = await cardCitationSection(client, paperId, 'references', typeof record?.referenceCount === 'number' ? record.referenceCount : undefined)
        const fwd = await cardCitationSection(client, paperId, 'citations', typeof record?.citationCount === 'number' ? record.citationCount : undefined)
        backtrack = back.update
        forwardtrack = fwd.update
        backtrackCoverage = back.coverage
        forwardtrackCoverage = fwd.coverage
        if (back.error) citationErrors.push(`references: ${back.error}`)
        if (fwd.error) citationErrors.push(`citations: ${fwd.error}`)
      } else if (args.citations !== false) {
        // S2 has no record, so the citation endpoints would 404 identically:
        // record the gap once instead of spending three paced calls re-learning
        // it. The sections still carry an explicit "no citation data" line, so
        // the completeness rule is satisfied honestly rather than skipped.
        const gap = `not indexed by S2 (${s2Miss ?? 'no record'})`
        backtrack = { entries: [], coverage: gap }
        forwardtrack = { entries: [], coverage: gap }
      }

      const date = new Date().toISOString().slice(0, 10)
      const priorEvaluations = existing ? cardstore.parseCard(existing).evaluations.length : 0
      const update: cardstore.CardUpdate = {
        meta: {
          identifier,
          ...(typeof record?.title === 'string' ? { title: record.title } : {}),
          authors: (record?.authors ?? []).map((a: any) => (typeof a === 'string' ? a : a?.name)).filter((n: any) => typeof n === 'string' && n !== ''),
          ...(record?.year !== undefined && record?.year !== null ? { year: record.year } : {}),
          ...(typeof record?.venue === 'string' && record.venue ? { venue: record.venue } : {}),
          ...(typeof record?.abstract === 'string' && record.abstract ? { abstract: record.abstract } : {}),
          ...(args.keywords?.length ? { keywords: args.keywords } : {}),
        },
        ...(args.quote && args.quote.trim()
          ? { evidence: [{ quote: args.quote, ...(args.docId ? { docId: args.docId } : {}), ...(args.offset !== undefined ? { offset: args.offset } : {}), ...(args.page !== undefined ? { page: args.page } : {}), ...(args.finding ? { finding: args.finding } : {}) }] }
          : {}),
        ...(backtrack ? { backtrack } : {}),
        ...(forwardtrack ? { forwardtrack } : {}),
        ...(existing
          ? { evaluation: `- [v${priorEvaluations + 1} | ${date}] re-checked via scholar_card_save${args.quote ? ' (evidence appended)' : ''}` }
          : {}),
      }

      const merged = cardstore.mergeCard(existing, update, date)
      await mkdir(dir, { recursive: true })
      await writeFile(dest, merged.markdown, 'utf8')

      const gained = [
        merged.delta.evidence ? `evidence +${merged.delta.evidence}` : '',
        merged.delta.backtrack ? `backtrack +${merged.delta.backtrack}` : '',
        merged.delta.forwardtrack ? `forwardtrack +${merged.delta.forwardtrack}` : '',
        merged.delta.keywords ? 'keywords set' : '',
      ].filter(Boolean).join(', ') || 'no new content'
      const dup = merged.delta.duplicates ? ` (${merged.delta.duplicates} duplicate line(s) skipped)` : ''
      const coverageLines = [
        backtrackCoverage ? `\`${backtrackCoverage.label}\`` : '',
        forwardtrackCoverage ? `\`${forwardtrackCoverage.label}\`` : '',
      ].filter(Boolean)
      // Say plainly which source verified the title, or that nothing did. The
      // card is still written in the latter case — but the model must be able
      // to tell a verified card from an unverified one.
      const identityLines = identitySource === 'sciverse'
        ? [`- ⚠️ Semantic Scholar has no record for this id (${s2Miss ?? 'no record'}) — the title was checked against the **Sciverse** record instead, and both citation sections record the S2 gap.`]
        : identitySource === 'none'
          ? ['- ⚠️ **UNVERIFIED**: neither Semantic Scholar nor Sciverse returned a record for this id — the card is keyed by the id you passed and its bibliographic fields are empty. Verify the DOI before citing it.']
          : []
      const markdown = [
        `**Card ${merged.created ? 'created' : 'updated'}**: \`${relPath}\``,
        '',
        `- ${gained}${dup}`,
        ...(coverageLines.length ? [`- coverage — backtrack: ${backtrackCoverage?.label ?? 'not populated'}; forwardtrack: ${forwardtrackCoverage?.label ?? 'not populated'}`] : []),
        ...(citationErrors.length ? [`- ⚠️ citation population failed (${citationErrors.join('; ')}) — the section records the failure; re-run when the quota recovers`] : []),
        ...identityLines,
        `- identity: ${check ? describeTitleCheck(check) : 'not checked (no `expectedTitle` passed)'}`,
      ].join('\n')

      return {
        status: merged.created ? 'created' : 'updated',
        path: relPath,
        created: merged.created,
        added: merged.delta,
        ...(backtrackCoverage || forwardtrackCoverage
          ? { coverage: { ...(backtrackCoverage ? { backtrack: coverageJson(backtrackCoverage) } : {}), ...(forwardtrackCoverage ? { forwardtrack: coverageJson(forwardtrackCoverage) } : {}), ...(citationErrors.length ? { errors: citationErrors } : {}) } }
          : {}),
        identityCheck: {
          verdict: check?.verdict ?? (identitySource === 'none' ? 'unverified' : 'not_checked'),
          similarity: check?.similarity ?? 0,
          expected: check?.expected ?? null,
          actual: check?.actual ?? record?.title ?? null,
          source: identitySource,
        },
        markdown,
      }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_card_list',
    description: `List the memory cards of investigated papers: the summary a report needs to recall them without re-reading every file.
Use when: before writing a report (recall what was examined instead of re-deriving it from the conversation), or to check whether a paper is already carded.
Not for: one paper's metadata (\`scholar_get_paper\`) or the other library artifacts (\`scholar_list_library\`).
Returns: one row per card — identifier, path, title, keywords, evidence count, backtrack/forwardtrack counts, last evaluation, and \`complete\`. Incomplete cards are listed as such, not hidden.`,
    parameters: {
      keyword: { type: 'string', description: 'Only cards whose identifier, title or keywords contain this text (case-insensitive).' },
      limit: { type: 'integer', description: `Row cap (default ${CARD_LIST_DEFAULT_LIMIT}).` },
    },
    output: markdownOutput(
      { root: { type: 'string' }, total: { type: 'integer' }, returned: { type: 'integer' }, cards: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} cards.`,
    ),
    async execute(args, exec) {
      const settings = env.settings()
      const dir = resolveSubDir(resolveRootDir(settings.defaultOutputDir, baseDirOf(exec)), 'cards')
      let entries: string[]
      try {
        entries = await readdir(dir)
      } catch {
        entries = [] // no cards yet -> an empty library is a normal answer
      }
      const relRoot = (settings.defaultOutputDir || '.scholar').replace(/\/+$/, '')
      const all: Array<cardstore.CardSummary & { path: string }> = []
      for (const file of entries.filter((f) => f.endsWith('.md') && !f.startsWith('.')).sort()) {
        try {
          const text = await readFile(join(dir, file), 'utf8')
          all.push({ ...cardstore.summarizeCard(text, file), path: `${relRoot}/cards/${file}` })
        } catch {
          // unreadable card: skip rather than fail the whole recall
        }
      }
      const needle = typeof args.keyword === 'string' ? args.keyword.trim().toLowerCase() : ''
      const matched = needle
        ? all.filter((c) => [c.identifier ?? '', c.title ?? '', c.keywords.join(' ')].join(' ').toLowerCase().includes(needle))
        : all
      const limit = Math.max(1, Math.trunc(args.limit ?? CARD_LIST_DEFAULT_LIMIT))
      // `any[]` for the same reason the other list tools use it: the tool result
      // must satisfy the JSON value contract, and the row shape is already
      // pinned by `CardSummary`.
      const cards: any[] = matched.slice(0, limit)
      const incomplete = matched.filter((c) => !c.complete).length
      const unrecognized = matched.filter((c) => !c.recognized).length
      const rows = cards.map((c) =>
        `| ${c.identifier ?? '?'} | ${(c.title ?? '(untitled)').replace(/\|/g, '\\|').slice(0, 60)} | ${c.year ?? '?'} | ${c.backtrack}/${c.forwardtrack} | ${c.evidence} | ${c.complete ? 'yes' : 'no'} | ${c.keywords.join(', ').slice(0, 40)} | \`${c.path}\` |`,
      )
      const markdown = cards.length
        ? [
            `**${matched.length} card(s)** under \`${relRoot}/cards/\`${needle ? ` matching "${args.keyword}"` : ''}${matched.length > cards.length ? ` (showing ${cards.length})` : ''}.`,
            '',
            '| Identifier | Title | Year | Refs/Cites | Evidence | Complete | Keywords | Path |',
            '|---|---|---|---|---|---|---|---|',
            ...rows,
            ...(incomplete ? ['', `> ${incomplete} card(s) are **incomplete** — both citation sections must be populated (or carry an explicit "no citation data" line) and \`## Evidence List\` needs at least one provenance-bound quote. Re-run \`scholar_card_save\` for those.`] : []),
            ...(unrecognized ? ['', `> ${unrecognized} file(s) in \`cards/\` are not scholar cards — left untouched.`] : []),
          ].join('\n')
        : `No memory cards under \`${relRoot}/cards/\`${needle ? ` matching "${args.keyword}"` : ''} yet. Card an investigated paper with \`scholar_card_save\`.`
      return { root: dir, total: matched.length, returned: cards.length, cards, markdown }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  // -------------------------------------------------------------------------
  // paper_fetch_* — acquisition
  // -------------------------------------------------------------------------

  const resolveParams = {
    doi: { type: 'string', description: 'DOI to resolve (e.g. 10.1038/s41586-021-03819-2)' },
    title: { type: 'string', description: 'Paper title; resolved to a DOI via Crossref -> Semantic Scholar before the chain runs' },
  } as const

  register(defineTool({
    name: 'paper_fetch_resolve',
    description: `Find the best open-access PDF URL for a paper WITHOUT downloading anything.
Use when: only the PDF URL/link is wanted — the cheap option.
Not for: saving the file (\`paper_fetch_download\`) or reading its text (\`paper_pdf2md\`, \`arxiv_get_fulltext\`).
Returns: the winning source (Unpaywall/S2/arXiv/Europe PMC/PMC/bioRxiv/web_search) plus metadata; a \`web_search\` hit is an unverified hint, not a confirmed copy. Give \`doi\` or \`title\` (a DOI is used as-is; a title resolves via Crossref -> Semantic Scholar).`,
    parameters: resolveParams,
    output: markdownOutput(
      { doi: { type: 'string' }, data: { type: 'json' } },
      (value) => `Resolved ${value.doi ?? '?'}.`,
    ),
    async execute(args, exec) {
      const rt = runtimeOf(ctx, env, exec).fetch
      const { doi, resolution } = await resolveInputDoi(rt, args as { doi?: string; title?: string })
      if (!doi) {
        return { markdown: `Could not resolve "${args.title ?? args.doi ?? ''}" to a DOI. Use a longer/cleaner title or pass the DOI directly.`, data: { ok: false, resolution } } as any
      }
      const result = await fetchSvc.resolveOne(rt, doi, { expectedTitle: expectedTitleOf(args as { title?: string }) })
      const rejected = (result.meta as any).rejectedCandidates as Array<{ source: string; title?: string }> | undefined
      const sourceLine = result.success
        ? `**Source:** ${result.source}\n**PDF URL:** ${result.pdfUrl}\n**Title:** ${(result.meta as any).title ?? '?'}\n${(result.meta as any).year !== undefined ? `**Year:** ${(result.meta as any).year}\n` : ''}${result.source === 'web_search' || result.verified === false ? '*This link was found by web search and not fetched — treat it as a hint, not a confirmed OA copy.*\n' : ''}${rejected?.length ? `\n> Dropped ${rejected.length} source(s) whose record describes a different work: ${rejected.map((r) => `${r.source} ("${r.title ?? '?'}")`).join(', ')}.\n` : ''}`
        : failureLine(result.error as any)
      return {
        doi,
        markdown: `## Resolve ${doi}\n\n${sourceLine}`,
        data: { ok: result.success, ...(resolution ? { titleResolution: resolution } : {}), result },
      } as any
    },
    timeoutMs: FETCH_RESOLVE_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'paper_fetch_download',
    description: `Resolve a paper (doi or title) to its best open-access PDF, download it into the library directory (default .scholar/pdfs), and report the saved file path.
Use when: the user explicitly wants the PDF file itself.
Not for: only the link (\`paper_fetch_resolve\`) or reading the text (\`paper_pdf2md\`, \`arxiv_get_fulltext\`).
Returns: the saved path plus the winning source; an existing file is skipped unless \`overwrite\`. Failures are typed and non-retryable (\`not_found\`, \`download_not_a_pdf\`, \`download_host_not_allowed\`) — report, do not loop; a web-search hit is flagged not-title-verified. Slow — explicit request only.`,
    parameters: {
      doi: { type: 'string', description: 'DOI to download' },
      title: { type: 'string', description: 'Paper title; resolved to a DOI first' },
      overwrite: { type: 'boolean', description: 'Re-download even if the destination file exists' },
    },
    output: markdownOutput(
      { ok: { type: 'boolean' }, data: { type: 'json' } },
      (value) => `Fetch finished (ok=${String(value.ok)}).`,
    ),
    async execute(args, exec) {
      const rt = runtimeOf(ctx, env, exec).fetch
      const { doi, resolution } = await resolveInputDoi(rt, args as { doi?: string; title?: string })
      if (!doi) {
        return { ok: false, markdown: `Could not resolve "${args.title ?? ''}" to a DOI. Provide the DOI directly (title→DOI matching can fail or pick a different paper).`, data: { ok: false, resolution } } as any
      }
      const result = await fetchSvc.fetchOne(rt, doi, { overwrite: args.overwrite, expectedTitle: expectedTitleOf(args as { title?: string }) })
      const statusLine = result.success
        ? result.skipped
          ? `**Skipped** (already downloaded): ${result.file}`
          : `**Downloaded** from ${result.source}:\n- file: \`${result.file}\`\n- url: ${result.pdfUrl}${result.source === 'web_search' || result.verified === false ? '\n\n> Not title-verified: obtained by web search — confirm it is the right paper before citing.' : ''}`
        : failureLine(result.error as any)
      return {
        ok: result.success,
        markdown: `## Fetch ${doi}\n\n${statusLine}`,
        data: { ...(resolution ? { titleResolution: resolution } : {}), result },
      } as any
    },
    timeoutMs: FETCH_DOWNLOAD_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'paper_fetch_batch',
    description: `Fetch many papers by DOI (or a mix of dois/titles) in one resumable envelope.
Use when: the user explicitly wants several PDFs at once.
Not for: a single paper (\`paper_fetch_download\`) or link-only checks (\`paper_fetch_resolve\`).
Returns: per-item results, a summary and retry hints for the failed subset (\`next\`); one failure never discards the batch. Re-call with the same \`idempotencyKey\` to replay it without re-downloading. Needs \`unpaywallEmail\` for Unpaywall. No hard list cap, but the items are fetched sequentially under a ~10-minute tool budget: a very long list times out mid-way — re-call with the same key to resume.`,
    parameters: {
      dois: { type: 'array', items: { type: 'string', description: 'DOI' }, description: 'DOIs to fetch (give dois and/or titles — both are fetched; needs unpaywallEmail for Unpaywall)' },
      titles: { type: 'array', items: { type: 'string', description: 'Paper title to resolve first' }, description: 'Titles to resolve + fetch' },
      idempotencyKey: { type: 'string', description: 'Stable key; re-running with the same key replays the previous envelope instantly' },
      overwrite: { type: 'boolean', description: 'Re-download existing files' },
    },
    output: markdownOutput(
      { ok: { oneOf: [{ type: 'boolean' }, { type: 'string' }] }, data: { type: 'json' } },
      (value) => `Batch finished (ok=${String(value.ok)}).`,
    ),
    async execute(args, exec) {
      const rt = runtimeOf(ctx, env, exec).fetch
      if (!args.dois?.length && !args.titles?.length) {
        return { ok: false, markdown: 'paper_fetch_batch needs `dois` or `titles`.', data: { ok: false } }
      }
      const dois = [...(args.dois ?? [])]
      // The caller's own title is the identity gate for each resolved DOI, so a
      // fuzzy title->DOI pick can never silently become a downloaded wrong PDF.
      const expectedTitles: Record<string, string> = {}
      if (args.titles?.length) {
        for (const title of args.titles) {
          const r = await fetchSvc.resolveTitleToDoi(rt, title)
          if (r.doi) {
            dois.push(r.doi)
            const t = title.trim()
            if (t) expectedTitles[r.doi] = t
          }
        }
      }
      const envelope: any = await fetchSvc.fetchBatch(rt, dois, { overwrite: args.overwrite, idempotencyKey: args.idempotencyKey, expectedTitles })
      const summary = envelope.data?.summary ?? {}
      const lines = (envelope.data?.results ?? []).map((r: any) =>
        r.success ? `- ✅ ${r.doi} → ${r.file ?? r.pdfUrl}` : `- ❌ ${r.doi} [${r.error?.code ?? 'error'}]${r.error?.retry_after_hours ? ` (retry ~${r.error.retry_after_hours}h)` : ''}`)
      const next = (envelope.data?.next ?? []) as string[]
      const markdown = `## Batch fetch: ${summary.succeeded}/${summary.total} succeeded\n\n${lines.join('\n')}${next.length ? `\n\n**Retry hints:**\n\`\`\`\n${next.join('\n')}\n\`\`\`` : ''}`
      return { ok: envelope.ok, markdown, data: envelope as any }
    },
    timeoutMs: FETCH_BATCH_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'paper_fetch_library',
    description: `List PDFs already downloaded into the library directory (default .scholar/pdfs).
Use when: checking whether a PDF is already downloaded before fetching it again.
Not for: the rest of the library (\`scholar_list_library\`).
Returns: the file paths. An empty list is normal before any download.`,
    parameters: {},
    output: markdownOutput(
      { total: { type: 'integer' }, files: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} PDFs in the library.`,
    ),
    async execute(_args, exec) {
      const rt = runtimeOf(ctx, env, exec).fetch
      const files = await fetchSvc.listLibrary(rt)
      const markdown = files.length
        ? `**${files.length} PDF(s) in ${rt.settings.defaultOutputDir}/pdfs:**\n\n${files.map((f) => `- \`${f.file}\``).join('\n')}`
        : `No PDFs in ${rt.settings.defaultOutputDir}/pdfs yet.`
      return { total: files.length, markdown, files }
    },
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'paper_pdf2md',
    description: `Convert a single PDF (an https://...pdf URL or a local file path) to Markdown full text via the MinerU Agent lightweight parse API.
Use when: the user wants full Markdown of one non-arXiv PDF that is already at hand (a URL or a downloaded file).
Not for: arXiv papers (\`arxiv_get_fulltext\` first) or passage-level evidence (\`sciverse_read_content\`).
Returns: the saved \`.md\` path (default .scholar/md) plus a short excerpt. No API key; IP rate-limited; ≤10MB cap (page limit is server-side) — split the source or fall back to sciverse slices on oversize/parse errors.
Card it: \`scholar_card_save\` (see \`scholar-memory\`).`,
    parameters: {
      pdf: { type: 'string', description: 'PDF to convert: an https://...pdf URL or a local file path.', required: true },
      timeoutSec: { type: 'integer', description: `Poll timeout in seconds (default ${Math.floor(MINERU_TIMEOUT_MS / 1000)}, clamped to ${MINERU_MIN_TIMEOUT_SEC}-${MINERU_MAX_TIMEOUT_SEC})` },
    },
    output: {
      schema: { type: 'object', properties: { path: { type: 'string' }, excerpt: { type: 'string' }, pdf: { type: 'string' } }, additionalProperties: true },
      render(_args, value: any) {
        return text(value.path ? `**Markdown saved:** \`${value.path}\`\n${value.excerpt ?? ''}` : 'No Markdown produced.')
      },
    },
    async execute(args, exec) {
      const rt = runtimeOf(ctx, env, exec).fetch
      const timeoutSec = args.timeoutSec === undefined
        ? Math.floor(MINERU_TIMEOUT_MS / 1000)
        : Math.min(Math.max(args.timeoutSec, MINERU_MIN_TIMEOUT_SEC), MINERU_MAX_TIMEOUT_SEC)
      const timeoutMs = timeoutMsOf(timeoutSec)
      const isUrl = /^https?:\/\//i.test(args.pdf)
      const { markdown } = isUrl
        ? await mineruParseUrl(args.pdf, { timeoutMs, signal: exec.signal })
        : await mineruParseFile(args.pdf, { timeoutMs, signal: exec.signal })
      // Deterministic .md filename from the source basename (strip .pdf).
      const base = (isUrl ? new URL(args.pdf).pathname : args.pdf).split(/[\\/]/).pop() || 'paper'
      const outDir = resolveSubDir(resolveRootDir(rt.settings.defaultOutputDir, rt.baseDir), 'md')
      const dest = join(outDir, base.replace(/\.pdf$/i, '') + '.md')
      await mkdir(outDir, { recursive: true })
      await writeFile(dest, markdown, 'utf8')
      return { path: dest, excerpt: markdown.slice(0, 400), pdf: args.pdf }
    },
    timeoutMs: timeoutMsOf(MINERU_MAX_TIMEOUT_SEC) + MINERU_TOOL_TIMEOUT_MARGIN_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  // -------------------------------------------------------------------------
  // arxiv_* — official arXiv HTML full text
  // -------------------------------------------------------------------------

  register(defineTool({
    name: 'arxiv_get_fulltext',
    description: `Fetch the official arXiv HTML full text of a paper by its arXiv id (arXiv's "experimental" HTML: a subset of papers have none → available:false).
Use when: the content of an arXiv paper is wanted — first choice over PDF-to-Markdown.
Not for: non-arXiv works (\`paper_pdf2md\`, \`sciverse_read_content\`, \`scholar_get_paper_snippets\`).
Returns: Markdown by default (math as LaTeX $...$); md:false gives article-scoped raw HTML. save:true (default) writes .scholar/md/<id>.md (or .scholar/html/) plus the figures under .scholar/figs/, returning the paths; save:false returns the content inline (cap with maxChars) with figures attached as images for vision models. No API key; fetched through the proxy.
Card it: \`scholar_card_save\` (see \`scholar-memory\`).`,
    parameters: {
      arxivId: { type: 'string', description: 'arXiv id (e.g. 2402.08954, 2402.08954v2, hep-ex/0307015) or an abs/pdf/html URL', required: true },
      save: { type: 'boolean', description: 'Save under the library dir (default true). When false, the full content is returned inline instead of a file path, and the figures are attached as inline images (for vision models).' },
      md: { type: 'boolean', description: 'Markdown output (default true); when false, article-scoped raw HTML is returned/saved instead.' },
      maxChars: { type: 'integer', description: 'Optional truncation cap (characters) for the inline content when save=false; default: no cap.' },
    },
    // The model-facing result is the RENDERED content (the JSON value is the
    // presentation payload) — so with save:false the render must carry the
    // FULL inline text (plus the admitted figure images as image blocks).
    output: {
      schema: {
        type: 'object',
        properties: {
          available: { type: 'boolean' },
          format: { type: 'string' },
          path: { type: 'string' },
          content: { type: 'string' },
          truncated: { type: 'boolean' },
          figures: { type: 'array', items: { type: 'json' } },
          images: { type: 'array', items: { type: 'json' } },
        },
        additionalProperties: true,
      },
      render(_args, value: any) {
        const blocks: ContentBlock[] = []
        if (typeof value.content === 'string' && value.content) blocks.push(...text(value.content))
        else blocks.push(...text(value.markdown ?? `arxiv_get_fulltext: ${value.available === false ? 'no HTML version' : 'done'}.`))
        for (const img of Array.isArray(value.images) ? value.images : []) {
          if (img?.attachment) blocks.push({ type: 'image', attachment: img.attachment } as ContentBlock)
        }
        return blocks
      },
    },
    async execute(args, exec) {
      const rt = runtimeOf(ctx, env, exec).fetch
      const maxChars = typeof args.maxChars === 'number' && Number.isFinite(args.maxChars) && args.maxChars > 0
        ? Math.floor(args.maxChars)
        : undefined
      // Admit downloaded raster figures through the deployment attachment
      // store when available, so vision models see them inline (text-only
      // routes degrade to placeholders). Absent store → URLs only.
      const attachments = ctx.get('attachments') as AttachmentStore | undefined
      const admitImage = attachments
        ? async (img: { data: Uint8Array; mediaType: string; name?: string }): Promise<unknown> => {
            const refs = await admitEncodedImages(attachments, [{
              mediaType: img.mediaType as ImageMediaType,
              data: Buffer.from(img.data).toString('base64'),
              name: img.name,
            }])
            return refs[0] ?? null
          }
        : undefined
      return (await arxivGetFulltext({
        arxivId: String(args.arxivId ?? ''),
        save: args.save !== false,
        md: args.md !== false,
        maxChars,
        admitImage,
        timeoutMs: timeoutMsOf(rt.settings.fetchTimeoutSec),
        signal: exec.signal,
        baseDir: rt.baseDir,
        defaultOutputDir: rt.settings.defaultOutputDir,
      })) as any
    },
    timeoutMs: ARXIV_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_list_library',
    description: `List everything the plugin has produced under the output dir (default .scholar), grouped by subdirectory (pdfs/md/html/figs/cards).
Use when: resuming work, or reporting which artifacts exist and where.
Not for: PDF-only listings (\`paper_fetch_library\`).
Returns: the file paths under the library root; empty subdirs are simply skipped. For the memory cards themselves, \`scholar_card_list\` recalls them with titles and completeness.`,
    parameters: {
      subdir: { type: 'string', enum: ['pdfs', 'md', 'html', 'figs', 'cards', 'all'], description: 'Which subdirectory to list (default all).' },
    },
    output: markdownOutput(
      { root: { type: 'string' }, files: { type: 'array', items: { type: 'json' } } },
      (value) => `${Array.isArray(value.files) ? value.files.length : 0} files under the library root.`,
    ),
    async execute(args, exec) {
      const rt = runtimeOf(ctx, env, exec).fetch
      const rootDir = resolveRootDir(rt.settings.defaultOutputDir, rt.baseDir)
      const subs = pickSubdirs(typeof args.subdir === 'string' ? args.subdir : undefined)
      const files: LibraryFile[] = []
      for (const sub of subs) {
        const d = resolveSubDir(rootDir, sub)
        let entries: string[]
        try {
          entries = await readdir(d)
        } catch {
          continue // subdir absent -> skip
        }
        for (const f of entries.filter((e) => !e.startsWith('.'))) {
          files.push({ sub, file: f, path: join(d, f) })
        }
      }
      return { ok: true, root: rootDir, files, markdown: formatLibrary(files, rootDir) }
    },
    isConcurrencySafe: NON_CONCURRENT,
  }))

  return () => {
    for (const dispose of disposers) dispose()
  }
}

/**
 * The record's own citation/reference counts, best-effort: cover the list
 * endpoints' blind spot without letting a count lookup fail the tool call.
 */
async function bestEffortSeedCounts(client: s2.ScholarClient, paperId: string): Promise<{ citationCount?: number; referenceCount?: number } | undefined> {
  try {
    return await s2.getPaperCounts(client, paperId)
  } catch {
    return undefined
  }
}

/** Citation rows as a card stores them: title, year, authors, DOI. */
function citationEntries(items: readonly any[], pick: 'citedPaper' | 'citingPaper'): cardstore.CitationEntry[] {
  return items
    .map((it) => it?.[pick] ?? {})
    .filter((p: any) => typeof p?.title === 'string' && p.title !== '')
    .map((p: any) => ({
      title: p.title,
      ...(p.year !== undefined && p.year !== null ? { year: p.year } : {}),
      authors: (p.authors ?? []).map((a: any) => a?.name).filter((n: any) => typeof n === 'string' && n !== ''),
      ...(typeof p.externalIds?.DOI === 'string' && p.externalIds.DOI ? { doi: p.externalIds.DOI } : {}),
    }))
}

/**
 * One card citation section. A failed call is a first-class outcome: the card
 * is still written (its metadata and evidence outlive a transient 429) and the
 * section records the failure rather than staying blank — the `scholar-memory`
 * rule is "record `no citation data (S2: <code>)`", never an empty seed.
 */
async function cardCitationSection(
  client: s2.ScholarClient,
  paperId: string,
  kind: 'references' | 'citations',
  seedCount: number | undefined,
): Promise<{ update: cardstore.CitationUpdate; coverage?: Coverage; error?: string }> {
  const label = kind === 'references' ? 'references' : 'citing papers'
  try {
    const page = kind === 'references'
      ? await s2.getReferences(client, paperId, { maxResults: CARD_CITATION_CAP, fields: CARD_CITATION_FIELDS })
      : await s2.getCitations(client, paperId, { maxResults: CARD_CITATION_CAP, fields: CARD_CITATION_FIELDS })
    const coverage = computeCoverage({
      returned: page.items.length,
      requestedCap: CARD_CITATION_CAP,
      hasMore: page.hasMore,
      ...(seedCount !== undefined ? { seedCount } : {}),
      kind: label,
    })
    return {
      update: { entries: citationEntries(page.items, kind === 'references' ? 'citedPaper' : 'citingPaper'), coverage: coverage.label },
      coverage,
    }
  } catch (err) {
    const code = err instanceof s2.ScholarHttpError ? err.code : 'request_failed'
    return { update: { entries: [], coverage: `${label} unavailable (${code})` }, error: code }
  }
}

/**
 * One catalog field as a readable line: the name, then every non-empty
 * property the API actually sent (description, filter/sort flags, the operator
 * list, enum samples, stats). Deliberately schema-agnostic — the catalog is the
 * authority, so the render must not depend on a field list we guessed.
 */
function renderCatalogField(f: any): string {
  const name = f?.field_name ?? f?.name ?? f?.field ?? '?'
  const parts: string[] = []
  if (typeof f?.description === 'string' && f.description) parts.push(f.description)
  for (const [key, value] of Object.entries(f ?? {})) {
    if (key === 'field_name' || key === 'name' || key === 'field' || key === 'description') continue
    if (typeof value === 'string' && value) parts.push(`${key}: ${value}`)
    else if (typeof value === 'number' || typeof value === 'boolean') parts.push(`${key}: ${value}`)
    else if (Array.isArray(value) && value.length) parts.push(`${key}: ${value.slice(0, 20).map((v) => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ')}`)
  }
  return `- \`${name}\` — ${parts.join(' · ')}`
}

/** Sciverse hands out `paper:<doi>`; Semantic Scholar wants `DOI:<doi>`. */
function normalizeCardPaperId(raw: string): string {
  const s = (raw ?? '').trim()
  return /^paper:/i.test(s) ? `DOI:${s.slice(6).trim()}` : s
}

/**
 * A card key derived from the request id alone, for when no source resolved a
 * record. Mirrors `cardIdentifier`'s precedence (DOI → arXiv → raw id) so the
 * key is the same one a resolved record would have produced.
 */
function identifierFromPaperId(paperId: string): string | undefined {
  const s = (paperId ?? '').trim()
  if (!s) return undefined
  const m = /^([a-z]+):(.+)$/i.exec(s)
  if (!m) return s
  const kind = m[1] ?? ''
  const v = (m[2] ?? '').trim()
  if (!v) return undefined
  if (/^doi$/i.test(kind)) return v
  if (/^arxiv$/i.test(kind)) return `arXiv:${v}`
  return s // pmid / pmcid / corpusid carry no better key
}

/** True when the caller passed an identifier rather than a title. A title is a
 * legitimate input: a Sciverse RAG hit carries `title` + `doc_id` and nothing
 * else identifiable (verified live — `/agentic-search` serves a fixed hit shape
 * with no `unique_id` and no `doi`), so title resolution is the only way that
 * path can produce a card at all (`.notes/78` §11). */
function looksLikePaperId(value: string): boolean {
  const s = (value ?? '').trim()
  if (/^(doi|arxiv|pmid|pmcid|corpusid|paper):/i.test(s)) return true
  return /^10\.\d{4,9}\/\S+$/.test(s)
}

/** One Sciverse meta-search row as the record shape the card writer expects. */
function recordFromSciverseRow(row: any, fallbackDoi?: string): Record<string, any> | undefined {
  const title = typeof row?.title === 'string' && row.title !== '' ? row.title : undefined
  if (!title) return undefined
  const authors = (Array.isArray(row.author) ? row.author : [])
    .map((a: any) => (typeof a === 'string' ? a : a?.name))
    .filter((n: any) => typeof n === 'string' && n !== '')
    .map((name: string) => ({ name }))
  const uniqueId = typeof row.unique_id === 'string' && row.unique_id ? row.unique_id : undefined
  // `paper:<doi>` is Sciverse's paper key; its remainder IS the DOI.
  const fromUnique = uniqueId && /^paper:/i.test(uniqueId) ? uniqueId.slice(6).trim() : undefined
  const doi = (typeof row.doi === 'string' && row.doi ? row.doi : undefined) ?? fallbackDoi ?? fromUnique
  return {
    title,
    ...(authors.length ? { authors } : {}),
    ...(typeof row.publication_published_year === 'number' ? { year: row.publication_published_year } : {}),
    ...(typeof row.publication_venue_name_unified === 'string' && row.publication_venue_name_unified ? { venue: row.publication_venue_name_unified } : {}),
    ...(doi ? { externalIds: { DOI: doi } } : {}),
    // No DOI anywhere: fall back to the Sciverse key so the card is still keyed
    // by a stable paper id rather than by its title.
    ...(!doi && uniqueId ? { paperId: uniqueId } : {}),
  }
}

/**
 * The identity fallback: the corpus that HAS the paper verifies the paper.
 *
 * Used only when Semantic Scholar serves no record. The chains that feed
 * `scholar_card_save` are Sciverse-native, and Sciverse indexes Chinese
 * journals and theses that S2 does not — exactly the GB/T 7714 use case — so a
 * S2 404 must not become a failed write (`.notes/78` R1). Best-effort by
 * design: a missing token or an API error degrades to "unverified", never to a
 * refusal.
 */
async function sciverseIdentityLookup(
  env: ScholarToolEnv,
  paperId: string,
  signal?: AbortSignal,
): Promise<Record<string, any> | undefined> {
  const doi = doiFromPaperId(paperId)
  if (!doi) return undefined
  const key = await env.resolveSciverseKey()
  if (!key) return undefined
  try {
    const sc = createSciverseClient(key, SCIVERSE_FALLBACK_TIMEOUT_MS, { maxAttempts: 2, backoffMs: [600] })
    const r = (await sc.searchPapers({
      filters_advanced: [{ field: 'doi', operator: FILTER_OP_EQ, value: doi }],
      page: 1,
      page_size: 1,
    }, signal)) as any
    const row = Array.isArray(r?.results) ? r.results[0] : undefined
    return recordFromSciverseRow(row, doi)
  } catch {
    return undefined
  }
}

/**
 * Resolve a TITLE through the Sciverse metadata index. Only a row whose own
 * title passes the identity gate is accepted, so a BM25 near-miss cannot become
 * a card for the wrong work.
 */
async function sciverseTitleLookup(
  env: ScholarToolEnv,
  title: string,
  signal?: AbortSignal,
): Promise<Record<string, any> | undefined> {
  const key = await env.resolveSciverseKey()
  if (!key) return undefined
  try {
    const sc = createSciverseClient(key, SCIVERSE_FALLBACK_TIMEOUT_MS, { maxAttempts: 2, backoffMs: [600] })
    const r = (await sc.searchPapers({ query: title, page: 1, page_size: 3 }, signal)) as any
    const rows = Array.isArray(r?.results) ? r.results : []
    for (const row of rows) {
      const rec = recordFromSciverseRow(row)
      if (rec?.title && titleAccepted(titleVerdict(title, rec.title))) return rec
    }
    return undefined
  } catch {
    return undefined
  }
}

/** Normalized DOI / paperId comparison for one batch-lookup row. */
function normalizeIdToken(value: string): string {
  return value.trim().toLowerCase()
    .replace(/^doi:/, '')
    .replace(/^https?:\/\/(dx\.)?doi\.org\//, '')
    .replace(/^arxiv:/, '')
}

/**
 * Does the record S2 returned for a batch request actually correspond to the id
 * that was asked for?
 *
 * Only DOI and arXiv forms are checked strictly: those are what reference lists
 * are built from, and their identifiers are unambiguous in the response. A
 * CorpusId/PMID/sha request returns `true` (that id form has no comparable
 * field here) — a false warning would be worse than the check it buys. A record
 * carrying none of the comparable identifiers also passes: only a POSITIVE
 * mismatch rejects.
 */
function recordMatchesId(record: Record<string, any>, requestedId: string): boolean {
  const raw = requestedId.trim()
  const want = normalizeIdToken(raw)
  const arxivForm = /^arxiv:/i.test(raw) || /^\d{4}\.\d{4,5}(v\d+)?$/.test(want)
  const doiForm = /^10\.\d{4,9}\//.test(want)
  if (!doiForm && !arxivForm) return true
  const ext = (record.externalIds ?? {}) as Record<string, unknown>
  const candidates = (doiForm
    ? [typeof ext.DOI === 'string' ? ext.DOI : '']
    : [typeof ext.ArXiv === 'string' ? ext.ArXiv : '', typeof record.paperId === 'string' ? record.paperId : '']
  ).map(normalizeIdToken).filter(Boolean)
  if (!candidates.length) return true
  return candidates.some((c) => c === want)
}

/** Lossless JSON projection of a coverage verdict. */
function coverageJson(c: Coverage) {
  return {
    status: c.status,
    returned: c.returned,
    requested_cap: c.requestedCap,
    has_more: c.hasMore,
    seed_count: c.seedCount ?? null,
    complete: c.complete,
    label: c.label,
  }
}

/** DOI recoverable from a paper id, for the Sciverse relations fallback. */
function doiFromPaperId(paperId: string): string | undefined {
  const s = paperId.trim()
  if (/^doi:/i.test(s)) return s.slice(4).trim() || undefined
  return /^10\.\d{4,9}\/\S+$/.test(s) ? s : undefined
}

/**
 * Second-source fallback for a citation/reference list the S2 graph does not
 * serve (status `not_indexed`/`empty`). Only attempted when a Sciverse token is
 * configured AND the id is a DOI (the Open Platform keys papers as
 * `paper:<doi>`); entries are always labelled with their source so the two
 * indexes are never silently mixed.
 */
async function relationsFallback(
  env: ScholarToolEnv,
  paperId: string,
  relation: 'CITATIONS' | 'REFERENCES',
  coverage: Coverage,
  signal?: AbortSignal,
) {
  if (coverage.status !== 'not_indexed' && coverage.status !== 'empty') return undefined
  const doi = doiFromPaperId(paperId)
  if (!doi) return undefined
  const key = await env.resolveSciverseKey()
  if (!key) return undefined
  try {
    const sc = createSciverseClient(key, SCIVERSE_FALLBACK_TIMEOUT_MS, { maxAttempts: 2, backoffMs: [600] })
    const r = (await sc.listPaperRelations({ unique_id: `paper:${doi}`, relation, page: 1, page_size: SCIVERSE_RELATIONS_FALLBACK_PAGE }, signal)) as any
    const raw = Array.isArray(r?.items) ? r.items : Array.isArray(r?.results) ? r.results : []
    const items = raw.map((it: any) => ({ source: 'sciverse', id: typeof it?.id === 'string' ? it.id : null, id_type: typeof it?.id_type === 'string' ? it.id_type : null, title: typeof it?.title === 'string' ? it.title : null }))
    if (!items.length) return undefined
    const total = typeof r?.total_count === 'number' ? r.total_count : items.length
    const md = `> **Sciverse fallback** (S2 served none): \`paper:${doi}\` has ${total} ${relation === 'CITATIONS' ? 'citing papers' : 'references'} in the Sciverse index — ${items.length} shown here (source: sciverse, not S2).`
    return { json: { source: 'sciverse', unique_id: `paper:${doi}`, relation, total, items }, markdown: md }
  } catch {
    // The fallback is a bonus: never fail the S2 call because it errored.
    return undefined
  }
}

function pickFilters(args: Record<string, unknown>): s2.ScholarFilters {
  const f: s2.ScholarFilters = {}
  for (const key of ['year', 'publicationDate', 'venue', 'fieldsOfStudy', 'publicationTypes'] as const) {
    const v = args[key]
    if (typeof v === 'string' && v) (f as Record<string, unknown>)[key] = v
  }
  const minC = args.minCitationCount
  if (typeof minC === 'number' && Number.isFinite(minC)) f.minCitationCount = minC
  if (args.openAccess === true) f.openAccess = true
  return f
}
// ---------------------------------------------------------------------------
// sciverse_* — Sciverse Open Platform retrieval (structured search, semantic
// RAG, full text, figures). Direct REST client (no proxy — China-hosted
// service); token via the DSH credentials seam; calls socket-timeout bounded.
// ---------------------------------------------------------------------------

/**
 * The triage line of one Sciverse hit: OA status, venue type and the
 * topic/subject evidence the model needs to judge relevance without opening
 * the record. `access_is_oa` (boolean, or the literal `"unknown"`),
 * `publication_venue_type` and `metadata_type` are part of the default
 * response (live-verified against /meta-search); `primary_topic`/`topics`/
 * `subjects` need the explicit `fields` projection — and because that
 * projection is replacive, the tool unions the identity fields back in.
 */
function paperEvidence(p: Record<string, unknown>): string {
  // Live-verified: `access_is_oa` arrives as the STRING "true"/"false"/"unknown"
  // (not a JSON boolean), and `access_oa_status` carries the readable value
  // ("closed" / "gold" / "green" / …). Accept both shapes.
  const raw = p.access_is_oa
  const status = typeof p.access_oa_status === 'string' ? p.access_oa_status : ''
  const isOa = raw === true || raw === 'true'
  const isClosed = raw === false || raw === 'false'
  // Keep the specific OA flavour when the API gives one ("OA (gold)"), and fall
  // back to the status string for the "unknown" case.
  const oa = isOa
    ? (status && status !== 'closed' && status !== 'unknown' ? `OA (${status})` : 'OA')
    : isClosed
      ? 'closed'
      : status
  const primary = (p.primary_topic as Record<string, unknown> | undefined)?.display_name
  const topics = Array.isArray(p.topics) ? (p.topics as Array<Record<string, unknown>>).map((t) => t?.display_name).filter((t): t is string => typeof t === 'string') : []
  const subjects = Array.isArray(p.subjects) ? (p.subjects as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const topic = typeof primary === 'string' && primary ? primary : [...topics, ...subjects].slice(0, 2).join('/')
  // `type` is an array on real rows (e.g. ["article"]); publication_venue_type is
  // the usable single value.
  const type = typeof p.publication_venue_type === 'string' && p.publication_venue_type
    ? p.publication_venue_type
    : Array.isArray(p.type)
      ? (p.type as unknown[]).filter((x): x is string => typeof x === 'string').join('/')
      : typeof p.type === 'string' ? p.type : ''
  return [oa, topic, type].filter(Boolean).join(' · ')
}

/** Compact one-line-per-paper markdown for search results. */
function fmtPapers(papers: readonly Record<string, unknown>[]): string {
  return papers
    .map((p) => {
      const authors = Array.isArray(p.author) ? (p.author as Array<{ name?: string }>).map((a) => a.name ?? '').filter(Boolean).join(', ') : ''
      // A row must stay identifiable even if the projection dropped the id:
      // fall back to the DOI, then doc_id, and only then say so.
      const idLabel = typeof p.unique_id === 'string' && p.unique_id
        ? `\`${p.unique_id}\``
        : typeof p.doi === 'string' && p.doi
          ? `DOI: ${p.doi}`
          : '_no id returned_'
      const ids = [idLabel]
      if (p.doc_id) ids.push(`doc_id: ${p.doc_id}`)
      const evidence = paperEvidence(p)
      const line = [`**${p.title ?? 'untitled'}**`, authors ? `— ${authors}` : '', [p.publication_published_year, p.publication_venue_name_unified].filter(Boolean).join(' · '), evidence, p.doi ? `DOI: ${p.doi}` : '', ids.join(' · ')].filter(Boolean).join('\n')
      return line
    })
    .join('\n\n')
}

/** First non-empty string among the values (arrays are flattened). */
function firstString(...values: unknown[]): string {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (Array.isArray(v)) {
      for (const item of v) if (typeof item === 'string' && item.trim()) return item.trim()
    }
  }
  return ''
}

/** OA label from a boolean OR the API's string form ("true"/"false"/status). */
function oaLabel(value: unknown): string {
  if (value === true || value === 'true') return 'OA'
  if (value === false || value === 'false') return 'closed'
  return typeof value === 'string' && value && value !== 'unknown' ? value : ''
}

/** `label value` only when the value is a finite number. */
function numLabel(value: unknown, label: string): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value} ${label}` : ''
}

/**
 * Compact markdown for `authors` / `sources` collection rows.
 *
 * The paper formatter ({@link fmtPapers}) reads paper-only fields, so an
 * entity row rendered through it collapsed to "untitled / no id returned".
 * Field names differ per collection and are only guaranteed by
 * `sciverse_list_catalog`, so this picks tolerantly (display_name → title →
 * name) and, when nothing matches, prints the row's scalar evidence rather
 * than an empty-looking record. The raw rows always remain in `results`.
 */
function fmtEntityRows(rows: readonly Record<string, unknown>[], collection: 'authors' | 'sources'): string {
  return rows
    .map((r) => {
      const name = firstString(r.display_name, r.title, r.name, r.preferred_name)
      // Live-verified entity rows key on `id` (an OpenAlex URL) and have no
      // unique_id; sources carry issn_l plus an issn array.
      const id = firstString(r.unique_id, r.id, r.orcid, r.issn_l, r.doi)
      const issn = firstString(r.issn_l, r.issn)
      const stats = collection === 'authors'
        ? [
            numLabel((r.summary_stats as Record<string, unknown> | undefined)?.h_index ?? r.h_index, 'h-index'),
            numLabel(r.cited_by_count, 'cites'),
            numLabel(r.works_count, 'works'),
          ]
        : [
            issn ? `ISSN ${issn}` : '',
            oaLabel(r.is_oa),
            numLabel(r.works_count, 'works'),
          ]
      const meta = [...stats.filter(Boolean), id ? `\`${id}\`` : ''].filter(Boolean).join(' · ')
      if (name) return meta ? `**${name}**\n${meta}` : `**${name}**`
      // No recognized display field: show the row's own scalars — an entity row
      // must never come back looking like an empty "untitled" record.
      const scalars = Object.entries(r)
        .filter(([, v]) => typeof v === 'string' || typeof v === 'number')
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${String(v)}`)
      return `**${collection === 'authors' ? 'author' : 'source'} row**\n${scalars.join(' · ') || '_no scalar fields returned_'}`
    })
    .join('\n\n')
}

/** Compact markdown for citation-relation entries (shape {id, id_type, title}). */
function fmtRelationItems(items: readonly Record<string, unknown>[]): string {
  // Live-verified: REFERENCES entries can carry an EMPTY title with an OpenAlex
  // work URL (id_type "openalex") while CITATIONS entries carry a title and a
  // `paper:<doi>` (id_type "sciverse"). Never render `****` for the empty case —
  // surface the id and say the title is missing.
  return items
    .map((r) => {
      const title = typeof r.title === 'string' ? r.title.trim() : ''
      const id = typeof r.id === 'string' && r.id.trim() ? r.id.trim() : ''
      const type = typeof r.id_type === 'string' && r.id_type ? ` (${r.id_type})` : ''
      const ref = id ? `\`${id}\`${type}` : '_no id returned_'
      return title ? `- **${title}** — ${ref}` : `- ${ref} — _no title returned_`
    })
    .join('\n')
}

/** Compact markdown for semantic-search chunks. */
function fmtChunks(hits: readonly Record<string, unknown>[]): string {
  return hits
    .map((h) => {
      const text = String(h.chunk ?? h.abstract ?? '').slice(0, 240)
      return `**${h.title ?? 'untitled'}** (score ${String(h.score ?? '?')})\n${text}${String(h.chunk ?? '').length > 240 ? '…' : ''}\nchunk_id: ${String(h.chunk_id ?? '')} · doc_id: ${String(h.doc_id ?? '')} · offset: ${String(h.offset ?? '')}`
    })
    .join('\n\n')
}

/**
 * Run a sciverse tool body and turn a thrown error into the plugin's typed
 * envelope. Without this a 404/502 reaches the model as a bare
 * `Error: Sciverse API 502: {…}` — no code, no retry verdict, no fallback hint.
 */
async function guarded<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    return sciverseEnvelope(e, label) as unknown as T
  }
}

/** Not-configured markdown shared by all sciverse_* tools. */
function sciverseNotConfigured(): string {
  return 'sciverse_* tools are not configured. Add a `sciverseApiKeyRef` credential (Web UI: Plugins page -> dsh-scholar-find -> "Sciverse API token") to enable them.'
}

/**
 * One trend row in markdown: `### year — <countLabel> papers` plus the
 * top-cited lines and the venue histogram. Shared by the s2 and sciverse
 * branches so the two backends render identically.
 */
function fmtTrendRow(row: { year: number; top: TrendPaper[]; venues: TrendVenue[] }, countLabel: string): string {
  const topLines = row.top.length
    ? row.top.map((p) => `  - [${p.citation_count ?? 0} cites] ${p.title ?? 'untitled'}${p.venue ? ` · ${p.venue}` : ''}\`${p.unique_id ?? ''}\``).join('\n')
    : '  (no papers returned)'
  const venueLine = row.venues.length ? `  venues: ${row.venues.map((v) => `${v.venue} (${v.count})`).join(', ')}` : ''
  return `### ${row.year} — ${countLabel} papers\n${topLines}${venueLine}`
}

/**
 * Sciverse-native trend mode (`source: "sciverse"`): OpenAlex-topic-scoped
 * meta-search, which fixes both cookbook failures — exact per-year counts
 * (matched set < 10000) and on-topic top-cited (citation sort within the
 * topic pool, not the keyword-OR pool).
 *
 * Topic resolution protocol (honest, never guesses):
 *  1. explicit `topicId` → use it directly;
 *  2. else discovery: year-free keyword search with `fields:['primary_topic']`
 *     → frequency-rank topics (see {@link rankTopicCandidates});
 *  3. a clear plurality (see {@link topicIsConfident}) → auto-select;
 *  4. otherwise return `code: "topic_ambiguous"` with the TOP-5 candidates —
 *     the agent asks the user via its native `ask_user_question` (user may
 *     also type a custom topic) and re-runs with that `topic_id`.
 */
async function runSciverseTrendScan(
  env: ScholarToolEnv,
  opts: { query: string; years: number[]; yearFrom: number; yearTo: number; topN: number; pool: number; topicId?: string; topicName?: string; signal?: AbortSignal },
): Promise<Record<string, unknown>> {
  const key = await env.resolveSciverseKey()
  if (!key) return { ok: false, query: opts.query, source: 'sciverse', years: [], code: 'not_configured', markdown: sciverseNotConfigured() }
  const sc = createSciverseClient(key, SCIVERSE_CLIENT_TIMEOUT_MS)

  let topicId = typeof opts.topicId === 'string' ? opts.topicId.trim() : ''
  let topicName = typeof opts.topicName === 'string' && opts.topicName.trim() ? opts.topicName.trim() : ''

  if (!topicId) {
    // Discovery: year-free (the year scoping belongs to the trend scan itself),
    // paper-only, topic object projected.
    const d = (await sc.searchPapers({
      query: opts.query,
      fields: ['title', 'primary_topic'],
      filters_advanced: [paperOnlyFilter()],
      page: 1,
      page_size: opts.pool,
    }, opts.signal)) as any
    const hits = Array.isArray(d?.results) ? (d.results as Record<string, unknown>[]) : []
    const candidates: TopicCandidate[] = rankTopicCandidates(hits)
    if (!candidates.length) {
      return {
        ok: true, query: opts.query, source: 'sciverse', years: [], code: 'no_topic_found', candidates: [],
        markdown: `Topic discovery found no OpenAlex primary topics in the top ${opts.pool} hits for "${opts.query}". Pass an explicit \`topic_id\` (OpenAlex topic URL, e.g. https://openalex.org/T11143) or narrow the query.`,
      }
    }
    if (!topicIsConfident(candidates)) {
      const list = candidates.map((c) => `- \`${c.topic_id}\` — ${c.display_name} (${c.votes} hit${c.votes === 1 ? '' : 's'})`).join('\n')
      return {
        ok: true, query: opts.query, source: 'sciverse', years: [], code: 'topic_ambiguous', candidates,
        markdown: `Topic discovery for "${opts.query}" is ambiguous (no single OpenAlex topic dominates the top ${opts.pool} hits). Ask the user to pick one via \`ask_user_question\` (recommend the first), then re-run \`sciverse_trend_scan\` with that \`topic_id\`:\n\n${list}`,
      }
    }
    topicId = candidates[0]!.topic_id
    topicName = candidates[0]!.display_name
  }
  if (!topicName) topicName = topicId

  const years: Array<{ year: number; total: number; capped: boolean; top: TrendPaper[]; venues: TrendVenue[] }> = []
  for (const [i, y] of opts.years.entries()) {
    // Pace the per-year loop (~30 req/min endpoint budget) and stay cancellable.
    if (i > 0) await sleep(SCIVERSE_WORKFLOW_PACE_MS, opts.signal)
    // One topic-scoped call per year: citation-sorted page serves BOTH the
    // top-cited papers and the venue histogram; `total_count` is the year count
    // (exact while the matched set stays below the server cap).
    const r = (await sc.searchPapers({
      filters_advanced: topicYearPaperFilters(topicId, y),
      sort_advanced: [{ field: 'citation_count', order: SORT_ORDER_DESC }],
      page: 1,
      page_size: opts.pool,
    }, opts.signal)) as any
    const results = Array.isArray(r?.results) ? (r.results as Record<string, unknown>[]) : []
    const total = typeof r?.total_count === 'number' ? r.total_count : results.length
    years.push({
      year: y,
      total,
      capped: total >= SCIVERSE_TOTAL_HITS_CAP,
      top: topByCitation(results, opts.topN),
      venues: topVenues(results, TREND_VENUE_TOP_N),
    })
  }
  const anyCapped = years.some((row) => row.capped)
  const lines = years.map((row) => fmtTrendRow(row, row.capped ? `≥${SCIVERSE_TOTAL_HITS_CAP} (capped — not an exact count)` : `${row.total}`))
  const markdown =
    `**Trend: "${opts.query}" (${opts.yearFrom}-${opts.yearTo})** — Sciverse topic-scoped (topic: ${topicName}, \`${topicId}\`); ` +
    `counts are exact while below ${SCIVERSE_TOTAL_HITS_CAP}, top-cited are citation-sorted WITHIN the topic pool. ` +
    `Citation data is the Sciverse index's own — verify top-cited titles are on-topic before quoting.` +
    `${anyCapped ? `\n\n> ${years.filter((r) => r.capped).map((r) => r.year).join(', ')}: total capped at ${SCIVERSE_TOTAL_HITS_CAP} (matched set larger) — counts are lower bounds, not exact.` : ''}\n\n${lines.join('\n\n')}`
  return { ok: true, query: opts.query, source: 'sciverse', topic_id: topicId, topic_name: topicName, years, markdown }
}

/** Register the eight sciverse_* tools; returns a disposer that unregisters all. */
export function applySciverseTools(ctx: Context, env: ScholarToolEnv): () => void {
  const disposers: Array<() => void> = []

  const register = (tool: ReturnType<typeof defineTool>): void => {
    registerTool(ctx, disposers, tool, () => 'See result.')
  }

  register(defineTool({
    name: 'sciverse_list_catalog',
    description: `Discover the field catalog of a Sciverse collection (papers/authors/sources): field names, filterability/sortability, applicable filter operators and sample enum values.
Use when: before constructing \`filters_advanced\` / \`sort_advanced\` / \`fields\`, or when a field name or enum value is uncertain. It is authoritative: \`filters\`/\`sort\`/\`fields\` names must match it exactly (no renaming, no invention) — an unknown field is a 400, not a silent miss.
Not for: searching papers (\`sciverse_search_papers\`, \`sciverse_semantic_search\`).
Returns: the collection's \`fields\` — call once and cache. \`include_sample_values\` adds top-20 enum samples (~24h server cache); \`include_field_stats\` adds cardinality/min-max stats.`,
    parameters: {
      collection: { type: 'string', enum: ['papers', 'authors', 'sources'], description: 'Entity collection to inspect (default papers)' },
      include_sample_values: { type: 'boolean', description: 'Also return sample enum values (server caches ~24h)' },
      include_field_stats: { type: 'boolean', description: 'Also return per-field stats' },
    },
    output: markdownOutput(
      { ok: { type: 'boolean' }, collection: { type: 'string' }, fields: { type: 'array', items: { type: 'json' } } },
      (value) => `Catalog for ${value.collection ?? 'papers'}: ${Array.isArray(value.fields) ? value.fields.length : 0} fields.`,
    ),
    async execute(args, exec) {
      return guarded('list_catalog', async () => {
        const key = await env.resolveSciverseKey()
        if (!key) return { ok: false, markdown: sciverseNotConfigured(), fields: [] } as any
        const sc = createSciverseClient(key, SCIVERSE_CLIENT_TIMEOUT_MS)
        const r = (await sc.listCatalog(args as { include_sample_values?: boolean; include_field_stats?: boolean; collection?: string }, exec.signal)) as any
        const fields = Array.isArray(r?.fields) ? r.fields : []
        // The model never sees the JSON, only this render — so the render has to
        // carry what the description promises (operators, sortability, enum
        // samples). It previously printed name + description only, which made
        // `include_sample_values` / `include_field_stats` invisible no-ops.
        // Rendering whatever non-empty properties the API sends (rather than a
        // guessed field list) keeps this honest as the catalog evolves.
        const rows = fields.map(renderCatalogField)
        return { ok: true, collection: args.collection ?? 'papers', fields, markdown: `**Sciverse catalog** (\`${args.collection ?? 'papers'}\`): ${fields.length} fields\n\n${rows.join('\n')}` }
      })
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'sciverse_search_papers',
    description: `Structured metadata search over the Sciverse corpus (papers/authors/sources): field filters, sorting, pagination.
Use when: structured screening (year / type / venue / subject / OA) or a top-cited list.
Not for: natural-language questions (\`sciverse_semantic_search\`), full text (\`sciverse_read_content\`), or Semantic Scholar's citation-graph discovery (\`scholar_search_papers\`).
Returns: rows with unique_id (always) and doc_id (when full text exists) plus OA / venue-type / (projected) topic evidence — the \`is_content_accessible\` flag is advisory, not a gate (\`doc_id\` is what \`sciverse_read_content\` needs); collections authors/sources render the entity's name and present summary fields. Counts cap at ${SCIVERSE_TOTAL_HITS_CAP} for keyword/broad filters; page * page_size = ${SCIVERSE_TOTAL_HITS_CAP} is the ceiling (a larger window is rejected with a validation error; no \`cursor\`). Citation-sorted keyword pools surface the corpus's most-cited papers regardless of topic — verify titles are on-topic.`,
    parameters: {
      collection: { type: 'string', enum: ['papers', 'authors', 'sources'], description: 'Entity collection (default papers). The convenience fields are papers-only; for authors/sources use `filters_advanced` with that collection\'s fields (see `sciverse_list_catalog`).' },
      query: { type: 'string', description: 'BM25 over title/abstract/venue/keywords; empty = structured filters only. Boolean: UPPERCASE AND/OR/NOT, ( ) grouping and "quoted phrases"; NOT > AND > OR, adjacent words imply AND, and in boolean mode EVERY term is required (0 hits = 0) — lowercase and/or are plain words, and a label like `检索式1` becomes a required term. Max 64 terms (65+ → 400). With an explicit sort the query degrades to a hit filter.' },
      title_contains: { type: 'string', description: 'Word the title must contain (title field only).' },
      abstract_contains: { type: 'string', description: 'Word the abstract must contain — folded into the full-text `query` (abstract is not filterable).' },
      authors: { type: 'array', items: { type: 'string' }, description: 'Author names (any match; the backend `author` filter).' },
      year_from: { type: 'integer', description: 'Earliest publication year (inclusive)' },
      year_to: { type: 'integer', description: 'Latest publication year (inclusive)' },
      journals: { type: 'array', items: { type: 'string' }, description: 'Venue names (any match) — pass VERBATIM as returned (the index stores HTML-escaped forms; the plain "&" matches nothing).' },
      subjects: { type: 'array', items: { type: 'string' }, description: 'Subject categories, e.g. "computer science"' },
      fields: { type: 'array', items: { type: 'string' }, description: 'Extra projections, e.g. ["primary_topic","topics","subjects"]. Projection is REPLACIVE, so the tool unions your list with the identity fields; the default already carries access_is_oa, publication_venue_type, metadata_type.' },
      filters_advanced: { type: 'array', items: { type: 'json' }, description: 'Item shape {field, operator?, value}; `operator` defaults to EQ. The full operator set, the applicable operators PER FIELD and the enum values come from `sciverse_list_catalog` — call it rather than guessing (a wrong field or operator is a 400). Citation reverse-lookup: field "references_unique_id" with the target unique_id, e.g. [{"field":"references_unique_id","value":"paper:10.1109/cvpr.2016.90"}] (deep paging + arbitrary sorting).' },
      sort_by_year: { type: 'string', enum: ['auto', 'desc', 'asc', 'none'], description: 'Year ordering (default auto: no year sort when `query`/`sort_advanced` is set — relevance and boosts rank; newest-first for pure filters). ⚠️ `query` + explicit sort is NOT "relevant and recent": the sort degrades the query to an OR hit filter and disables all boosts — use `freshness_boost` instead.' },
      sort_advanced: { type: 'array', items: { type: 'json' }, description: 'Hard sort fields, e.g. [{"field":"citation_count","order":"SORT_ORDER_DESC"}] (order defaults DESC). With a query the query becomes a hit filter and all boosts are ignored. Sortable fields: `sciverse_list_catalog`.' },
      freshness_boost: { type: 'string', enum: ['NONE', 'MILD', 'STRONG'], description: 'Recency weighting (MILD=10y, STRONG=3y). Only with a non-empty `query` when no sort is set; stackable; paging is shallow while active.' },
      impact_boost: { type: 'string', enum: ['NONE', 'MILD', 'STRONG'], description: 'Citation-impact weighting (bounded; zero-citation neutral). Only with a non-empty `query` when no sort is set; stackable.' },
      language_affinity: { type: 'string', enum: ['NONE', 'MILD', 'STRONG'], description: 'Demotes (never excludes) results not in the query\'s language (MILD ×0.5 / STRONG ×0.2; unknown language stays neutral; the target is detected from the query text). Effective only with a query and when no sort is set. To hard-exclude instead: filters_advanced [{"field":"language","value":"en"}].' },
      page: { type: 'integer', description: 'Page number (default 1). page * page_size must stay at or below 10000 — a larger window is rejected with a `validation_error`, not sent upstream.' },
      page_size: { type: 'integer', description: 'Page size (server default 25, range 1-200, clamped; keep at or below 50 for agent use).' },
    },
    output: markdownOutput(
      { ok: { type: 'boolean' }, total: { type: 'integer' }, page: { type: 'integer' }, results: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} papers (page ${value.page ?? 1}).`,
    ),
    async execute(args, exec) {
      return guarded('search_papers', async () => {
      const key = await env.resolveSciverseKey()
      if (!key) return { ok: false, total: 0, results: [], markdown: sciverseNotConfigured() } as any
      const sc = createSciverseClient(key, SCIVERSE_CLIENT_TIMEOUT_MS)
      // The gateway 400s on page * page_size > 10000 (live-verified). Answer with
      // a typed validation error instead of burning a call, and say what to do.
      if (pageWindowExceeded(args.page, args.page_size)) {
        const w = clampedPageWindow(args.page, args.page_size)
        return {
          ok: false, total: 0, page: w.page, results: [], code: 'validation_error', retryable: false,
          markdown: `\`page * page_size\` = ${w.product} (${w.page} × ${w.page_size}, the values that would be sent) exceeds the ${META_SEARCH_PAGE_WINDOW} ceiling of this endpoint and was not sent. Narrow the filters (authors / journals / subjects / title_contains) or request an earlier page — this tool exposes no deep-paging \`cursor\`.`,
        } as any
      }
      // `abstract_contains` maps to a FILTER_OP_CONTAINS on `abstract`, which the
      // backend rejects (abstract has no .keyword subfield — full-text only, so it
      // cannot be filtered; see the field catalog). Fold it into the full-text
      // `query` and drop it so it never reaches the client's filter path.
      const payload: Record<string, unknown> = { ...args }
      const abstractTerm = typeof payload.abstract_contains === 'string' ? payload.abstract_contains.trim() : ''
      if (abstractTerm) {
        delete payload.abstract_contains
        payload.query = [typeof payload.query === 'string' ? payload.query : '', abstractTerm].filter(Boolean).join(' ').trim()
      }
      // Upstream `fields` is replacive: a caller asking for ["primary_topic"]
      // would otherwise get rows with no id, doi or author — so union the
      // identity set (and the triage evidence) back in. An UNPROJECTED call
      // must stay unprojected: sending a `fields` list here would itself drop
      // the fields the default response carries (abstract, keywords,
      // access_oa_*, language, publisher, …).
      const requestedFields = Array.isArray(payload.fields) ? (payload.fields as unknown[]).filter((f): f is string => typeof f === 'string') : []
      if (requestedFields.length) {
        payload.fields = [...new Set([...requestedFields, ...SCIVERSE_IDENTITY_FIELDS, ...SCIVERSE_TRIAGE_FIELDS])]
      } else {
        delete payload.fields
      }
      const r = (await sc.searchPapers(payload, exec.signal)) as any
      const results = Array.isArray(r?.results) ? r.results : []
      const total = r.total_count ?? results.length
      const collection = args.collection === 'authors' || args.collection === 'sources' ? args.collection : 'papers'
      // The backend caps reported hit counts at 10000 whenever the matched set is
      // larger (track_total_hits-style) — for keyword queries AND broad structured
      // filters alike (e.g. subjects alone hit it, with no keyword query). Annotate
      // any 10000 so it is not mistaken for a real total; exact counts require a
      // narrowed query/filter set (structured filters are not always exact).
      const capped = total >= SCIVERSE_TOTAL_HITS_CAP
      const noun = collection === 'papers' ? 'papers' : collection
      const markdown = results.length
        ? `**${total} ${noun}** (page ${args.page ?? 1})${capped
          ? `\n\n> total is capped at ${SCIVERSE_TOTAL_HITS_CAP} by the server (the matched set is larger). Narrow with field filters (title_contains / authors / journals / subjects) so the matched set falls below ${SCIVERSE_TOTAL_HITS_CAP} — year filters alone do not narrow the cap.`
          : ''}\n\n${collection === 'papers' ? fmtPapers(results) : fmtEntityRows(results, collection)}`
        : `No ${noun} found.`
      return { ok: true, total, page: args.page ?? 1, results, markdown }
      })
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'sciverse_semantic_search',
    description: `Natural-language semantic retrieval over the Sciverse corpus (RAG): the most relevant passage chunks with doc_id, character offset and score.
Use when: a question should be answered with quoted evidence passages.
Not for: precise field filtering (\`sciverse_search_papers\`) or extending a passage (\`sciverse_read_content\`).
Returns: chunks (chunk_id, doc_id, score, offset, title) plus \`doc_id_index\` — every doc_id the same paper appears under; pass the others to \`sciverse_read_content\` via \`alt_doc_ids\` when one has no stored text. Keep score ≥ 0.6 for evidence use. Figures/tables go through \`sciverse_get_resource\`.
Limits: \`mode\` defaults to balanced; without query rewriting the fusion pool returns at most ~50 hits, so only \`quality\` honours a larger \`top_k\` (~3 chunks per paper max); \`filters\` is SOFT — use \`filters.doc_id\` for a hard scope.`,
    parameters: {
      query: { type: 'string', description: 'Natural-language question, 1-200 chars best (max 4096).', required: true },
      top_k: { type: 'integer', description: 'Chunks to return (default 10, range 1-100, clamped; ~50 cap without query rewriting; ~3 per paper max).' },
      mode: { type: 'string', enum: ['fast', 'balanced', 'quality'], description: 'fast=keyword (~200ms); balanced=hybrid (~600ms, default); quality=LLM-rewrite+hybrid (~2-4s, needed to honour a large top_k).' },
      source_types: { type: 'array', items: { type: 'string', enum: ['web', 'pdf'] }, description: 'Accepted for compatibility but IGNORED upstream (live-verified: the hit set is identical with and without it) — do not rely on it; narrow with `filters` instead.' },
      filters: { type: 'json', description: 'SOFT recall-time filters, e.g. {"author":["Hinton"],"publication_published_year":{"gte":2023}}. Fields AND; an array within one field ORs; values may be a scalar, a range ({"gte":2020,"lte":2025}; null = unbounded) or [min,max]; dates accept YYYY / YYYY-MM / YYYY-MM-DD. Fields: lang (alias language), metadata_type, author, publication_venue_name_unified, publication_venue_type, publication_published_year / _date, citation_count, influential_citation_count, title, topics; unknown fields → 400. Missing metadata is NOT excluded, so scoped results are approximate. `doc_id` is the one HARD scope: string or string[], ≤1000 deduped (400 SCOPE_TOO_LARGE), hits never leave the set, empty array → empty hits. Pattern: pin candidates with sciverse_search_papers fields ["doc_id","title"], then scope here.' },
    },
    output: markdownOutput(
      { ok: { type: 'boolean' }, top_k: { type: 'integer' }, hits: { type: 'array', items: { type: 'json' } }, doc_id_index: { type: 'array', items: { type: 'json' } } },
      (value) => `${Array.isArray(value.hits) ? value.hits.length : 0} passage chunks.`,
    ),
    async execute(args, exec) {
      return guarded('semantic_search', async () => {
        const key = await env.resolveSciverseKey()
        if (!key) return { ok: false, hits: [], markdown: sciverseNotConfigured() } as any
        const sc = createSciverseClient(key, SCIVERSE_CLIENT_TIMEOUT_MS)
        // Clamp here (the client's builder would too) so the value actually sent
        // can be echoed back — the model otherwise cannot tell 100 from 500.
        const topK = clampNumber(args.top_k, 1, SEMANTIC_TOP_K_MAX)
        const r = (await sc.semanticSearch({ query: args.query, top_k: topK, mode: args.mode, source_types: args.source_types, filters: args.filters }, exec.signal)) as any
        const hits = Array.isArray(r?.hits) ? r.hits : []
        // The same paper is often indexed under several doc_ids; surfacing them
        // is what makes the read_content fallback usable when one 404s.
        const docIdIndex = groupDocIds(hits).filter((g) => g.doc_ids.length > 0)
        const multi = docIdIndex.filter((g) => g.doc_ids.length > 1)
        const note = multi.length
          ? `\n\n> ${multi.length} paper(s) appear under more than one doc_id — if \`sciverse_read_content\` answers CONTENT_NOT_FOUND for one, pass another via \`alt_doc_ids\`:\n${multi.map((g) => `> - ${g.title ?? g.paper_key}: ${g.doc_ids.map((d) => `\`${d}\``).join(', ')}`).join('\n')}`
          : ''
        return {
          ok: true,
          ...(topK !== undefined ? { top_k: topK } : {}),
          hits,
          doc_id_index: docIdIndex,
          markdown: hits.length ? `**${hits.length} passage chunk(s)**\n\n${fmtChunks(hits)}${note}` : 'No passages found.',
        }
      })
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'sciverse_list_paper_relations',
    description: `Paginate a paper's full citation relations (CITATIONS = who cites it; REFERENCES = what it cites; RELATED_WORKS).
Use when: deep pagination through one paper's relation list.
Not for: a single-hop who-cites / what-cites answer on S2-indexed papers (\`scholar_get_citations\`, \`scholar_get_references\`).
Returns: entries (id / id_type / title) plus total_count (in-corpus only, ~1% off the paper's citation_count). REFERENCES entries can have an EMPTY title and an OpenAlex work URL (id_type \`openalex\`, not resolvable here); CITATIONS carry a title and a \`paper:<doi>\` id. Limits (large CITATIONS): >10000 relations → 429, page * page_size >10000 → 400 (REFERENCES/RELATED_WORKS page freely) — either way switch to \`sciverse_search_papers\` with a references_unique_id filter (deep paging + sorting).`,
    parameters: {
      unique_id: { type: 'string', description: 'The paper\'s unique_id (e.g. paper:10.1038/xxx) from a sciverse search — never a doc_id.', required: true },
      relation: { type: 'string', enum: ['CITATIONS', 'REFERENCES', 'RELATED_WORKS'], description: 'CITATIONS = incoming (who cites the paper); REFERENCES = outgoing (what the paper cites) — opposite directions.', required: true },
      page: { type: 'integer', description: 'Page number (default 1). For large CITATIONS lists keep page * page_size at or below 10000 (a larger window is rejected with a `validation_error`, not sent); REFERENCES/RELATED_WORKS page freely.' },
      page_size: { type: 'integer', description: 'Page size (server default 25, range 1-200, clamped).' },
    },
    output: markdownOutput(
      { ok: { type: 'boolean' }, unique_id: { type: 'string' }, relation: { type: 'string' }, total: { type: 'integer' }, items: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} ${value.relation ?? ''} entries.`,
    ),
    async execute(args, exec) {
      return guarded('list_paper_relations', async () => {
        const key = await env.resolveSciverseKey()
        if (!key) return { ok: false, unique_id: args.unique_id, relation: args.relation, total: 0, items: [], markdown: sciverseNotConfigured() } as any
        // Deep paging beyond page*page_size 10000 is rejected by the gateway for
        // CITATIONS only (REFERENCES/RELATED_WORKS page freely — live-verified),
        // so answer a typed validation error instead of burning the call.
        if (args.relation === 'CITATIONS' && pageWindowExceeded(args.page, args.page_size)) {
          const w = clampedPageWindow(args.page, args.page_size)
          return {
            ok: false, unique_id: args.unique_id, relation: args.relation, total: 0, items: [], code: 'validation_error', retryable: false,
            markdown: `\`page * page_size\` = ${w.product} (${w.page} × ${w.page_size}) exceeds the ${META_SEARCH_PAGE_WINDOW} ceiling this endpoint applies to CITATIONS and was not sent. For a very large citing list, page through \`sciverse_search_papers\` with a \`references_unique_id\` filter instead (deep paging + sorting), or request an earlier page.`,
          } as any
        }
        const sc = createSciverseClient(key, SCIVERSE_CLIENT_TIMEOUT_MS)
        const r = (await sc.listPaperRelations({ unique_id: args.unique_id, relation: args.relation, page: args.page, page_size: args.page_size }, exec.signal)) as any
        const items = Array.isArray(r?.items ?? r?.results) ? (r.items ?? r.results) : []
        const total = r.total_count ?? items.length
        return { ok: true, unique_id: args.unique_id, relation: args.relation, total, items, markdown: items.length ? `**${total} ${args.relation} entries** (page ${args.page ?? 1})\n\n${fmtRelationItems(items as Record<string, unknown>[])}` : `No ${args.relation} entries.` }
      })
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'sciverse_read_content',
    description: `Read a character-range slice of a paper's full text by doc_id (offsets/limits are Unicode code points).
Use when: verifying a passage from \`sciverse_semantic_search\`, or reading around its offset.
Not for: topic search (\`sciverse_search_papers\`, \`sciverse_semantic_search\`), figure bytes (\`sciverse_get_resource\`), or a whole work's text (\`arxiv_get_fulltext\`/\`scholar_get_paper_snippets\`/\`paper_pdf2md\`).
Returns: the slice text, the API's \`bytes_returned\` count and \`next_offset\` (page with that, not with the count); an empty slice usually means the end; the text may carry \`![alt](file_name)\` placeholders for \`sciverse_get_resource\`.
Server rules: \`offset\` is always sent (default 0) — omitting it returns the WHOLE document and ignores \`limit\`; \`limit\` defaults to 4096 (>524288 clamped).
Recovery: CONTENT_NOT_FOUND or 502 FETCH_FAILED → pass \`alt_doc_ids\` from \`doc_id_index\`; the walk reports \`doc_id_used\` / \`attempts\` as a typed envelope.
Card it: \`scholar_card_save\` (see \`scholar-memory\`).`,
    parameters: {
      doc_id: { type: 'string', description: 'Full-text artifact id (sha256) from a sciverse search/semantic hit', required: true },
      offset: { type: 'integer', description: 'Character offset (code points) to start from. Defaults to 0 and is always sent (clamped to >= 0) — omitting it upstream returns the WHOLE document and ignores `limit`.' },
      limit: { type: 'integer', description: 'Max characters (code points). Default 4096; API default 700 (only with an offset); values are clamped to 1-524288. Page with `next_offset`.' },
      alt_doc_ids: { type: 'array', items: { type: 'string', description: 'Another doc_id for the same paper' }, description: 'Other doc_ids for the SAME paper, tried in order when this one has no stored text (see `doc_id_index` on sciverse_semantic_search).' },
    },
    output: markdownOutput(
      { ok: { type: 'boolean' }, doc_id: { type: 'string' }, doc_id_used: { type: 'string' }, attempts: { type: 'array', items: { type: 'json' } }, bytes_returned: { type: 'integer' }, next_offset: { type: 'integer' }, text: { type: 'string' }, images: { type: 'array', items: { type: 'object', properties: { file_name: { type: 'string' }, caption: { type: 'string' } }, additionalProperties: true } } },
      (value) => `\`bytes_returned\`=${value.bytes_returned ?? 0} at next_offset=${value.next_offset ?? 0}${Array.isArray(value.images) && value.images.length ? `; figures: ${value.images.map((i: any) => i.file_name).join(', ')}` : ''}.`,
    ),
    async execute(args, exec) {
      const key = await env.resolveSciverseKey()
      if (!key) return { ok: false, doc_id: args.doc_id, doc_id_used: null, attempts: [], bytes_returned: 0, next_offset: 0, text: '', images: [], markdown: sciverseNotConfigured() } as any
      // Walk the primary doc_id then the alternates, so one missing artifact
      // does not end the read when the same paper has another. The walk is
      // bounded by a total deadline (and a doc_id cap) so the tool always
      // returns its envelope rather than being killed by its own timeout.
      const allIds = [args.doc_id, ...(Array.isArray(args.alt_doc_ids) ? args.alt_doc_ids : [])]
        .map((d) => (typeof d === 'string' ? d.trim() : ''))
        .filter(Boolean)
        .filter((d, i, all) => all.indexOf(d) === i)
      const ids = allIds.slice(0, SCIVERSE_CONTENT_MAX_DOC_IDS)
      const droppedIds = allIds.slice(SCIVERSE_CONTENT_MAX_DOC_IDS)
      const attempts: Array<{ doc_id: string; code: string; retryable: boolean }> = []
      const deadline = Date.now() + SCIVERSE_CONTENT_BUDGET_MS
      let last: SciverseErrorEnvelope | undefined
      for (const docId of ids) {
        const remaining = deadline - Date.now()
        if (remaining <= 0) {
          attempts.push({ doc_id: docId, code: 'budget_exhausted', retryable: true })
          break
        }
        // Each doc_id gets at most 2 attempts, so it may consume at most twice
        // the per-attempt cap: clamp to half the remaining budget to keep the
        // whole walk (3 doc_ids) inside the tool's own wall clock.
        const perAttempt = Math.max(2_000, Math.min(SCIVERSE_CONTENT_TIMEOUT_MS, Math.floor(remaining / 2)))
        const sc = createSciverseClient(key, perAttempt, { maxAttempts: 2, backoffMs: [600] })
        try {
          const r = (await sc.readContent({ doc_id: docId, offset: args.offset, limit: args.limit }, exec.signal)) as any
          const text = String(r?.text ?? '')
          // Live-verified: the API answers with `bytes_returned` (UTF-8 bytes; the
          // `/content` page's `chars_returned` name is not implemented). Keep that
          // output key, and never page by it — offsets/limits are Unicode code
          // points, so `next_offset` is the only paging pointer.
          const bytesReturned = typeof r?.bytes_returned === 'number' ? r.bytes_returned : typeof r?.chars_returned === 'number' ? r.chars_returned : text.length
          // Surfaces figure/table references as ![alt](file_name) in this slice,
          // with BOTH the file_name (for sciverse_get_resource) and the alt
          // caption (the only semantic hint the model gets) so it can judge the
          // figure content without rereading.
          const figs = extractFigureRefs(text)
          return {
            ok: true, doc_id: args.doc_id, doc_id_used: docId, attempts, bytes_returned: bytesReturned, next_offset: r?.next_offset ?? 0, text, images: figs,
            markdown: text ? `**Full-text slice** (\`bytes_returned\`=${bytesReturned}${docId !== args.doc_id ? `, via alternate doc_id \`${docId}\`` : ''})\n\n${text.slice(0, 1200)}${text.length > 1200 ? '…' : ''}${figs.length ? `\n\n**Figures in this slice:**\n${figs.map((f) => `- ${f.caption ? `*${f.caption}* — ` : ''}\`${f.file_name}\``).join('\n')}` : ''}${r?.next_offset && r?.more !== false ? `\n\n> continue with offset=${r.next_offset}` : ''}` : `Empty slice at offset ${args.offset ?? 0} (no text, \`bytes_returned\`=${bytesReturned}). This usually means the end of the document's content is reached (the doc IS accessible) — try a smaller \`offset\` or a different \`doc_id\`.`,
          }
        } catch (e) {
          const envelope = sciverseEnvelope(e, 'read_content')
          attempts.push({ doc_id: docId, code: envelope.code, retryable: envelope.retryable })
          last = envelope
          // A missing artifact or an upstream fetch failure is exactly the case
          // another doc_id can fix; a bad token or a rate limit is not.
          if (!shouldTryAlternateDocId(envelope)) break
        }
      }
      const failure = last ?? sciverseEnvelope(new Error(`no doc_id could be read (${attempts.map((a) => a.code).join(', ') || 'none supplied'})`), 'read_content')
      const tried = attempts.length > 1 ? `\n\nTried ${attempts.length} doc_ids: ${attempts.map((a) => `\`${a.doc_id}\` (${a.code})`).join(', ')}.` : ''
      const skipped = droppedIds.length ? `\n\n${droppedIds.length} further alternate doc_id(s) were not tried (cap ${SCIVERSE_CONTENT_MAX_DOC_IDS} per call): ${droppedIds.map((d) => `\`${d}\``).join(', ')}.` : ''
      return { ...failure, doc_id: args.doc_id, doc_id_used: null, attempts, skipped_doc_ids: droppedIds, bytes_returned: 0, next_offset: 0, text: '', images: [], markdown: `${failure.markdown}${tried}${skipped}` } as any
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'sciverse_get_resource',
    description: `Fetch a figure/table image referenced as ![alt](file_name) in sciverse_read_content markdown, validate the bytes, and save it to <defaultOutputDir>/figs (default .scholar/figs).
Use when: \`sciverse_read_content\` returned a figure/table placeholder the user wants to see.
Not for: full text (\`sciverse_read_content\`) or downloading a paper's PDF (\`paper_fetch_download\`).
Returns: the saved path + mimeType + bytes — never inline base64; view it with \`read_image\`. Non-image bytes → \`not_an_image\`; bad paths / missing assets answer 400/405/507 — terminal, do not loop. Pass \`paper\` / \`fignum\` / \`caption\` for a self-describing name (\`{doi}_Fig_{n}_Caption_{text}\`) instead of the raw hash.`,
    parameters: {
      file_name: { type: 'string', description: 'Image file name from read_content markdown (relative path; no `\\`, no `..`, no leading `/`).', required: true },
      paper: { type: 'string', description: 'Paper identifier for the filename (a DOI, unique_id like paper:10.1038/xxx, or short title) so figures from different papers do not collide.' },
      fignum: { type: 'string', description: "Figure number (e.g. '2'); parsed from the caption when omitted." },
      caption: { type: 'string', description: "Figure caption / alt text; embedded (truncated to 20 chars) in the saved filename." },
      save: { type: 'boolean', description: 'Write the image to disk (default true). false returns metadata only, no path.' },
      out_dir: { type: 'string', description: 'Figure directory, resolved against the session workspace (default: <defaultOutputDir>/figs).' },
    },
    output: {
      schema: { type: 'object', properties: { ok: { type: 'boolean' }, file_name: { type: 'string' }, mimeType: { type: 'string' }, bytes: { type: 'integer' }, path: { type: 'string' }, wrote: { type: 'boolean' }, code: { type: 'string' }, retryable: { type: 'boolean' } }, additionalProperties: true },
      render(_args: unknown, value: any) {
        if (value.ok) {
          if (value.path) return text(`Figure saved: \`${value.path}\`\n\n(${value.mimeType}, ${value.bytes} bytes) — open with read_image / the image viewer.`)
          return text(`Figure fetched (${value.mimeType}, ${value.bytes} bytes) but not saved (set \`save: true\` to persist it).`)
        }
        return text(value.markdown ?? 'No image returned.')
      },
    },
    async execute(args, exec) {
      const key = await env.resolveSciverseKey()
      if (!key) return { ok: false, file_name: args.file_name, markdown: sciverseNotConfigured() } as any
      const sc = createSciverseClient(key, SCIVERSE_CLIENT_TIMEOUT_MS)
      let bytes: Uint8Array
      try {
        const r = (await sc.getResource({ file_name: args.file_name }, exec.signal)) as { bytes?: Uint8Array }
        bytes = r.bytes ?? new Uint8Array(0)
      } catch (e) {
        const err = mapGetResourceError(e)
        return { ok: false, file_name: args.file_name, code: err.code, retryable: err.retryable, markdown: err.markdown } as any
      }
      // Trust the bytes, not the upstream content-type: it can be undefined or
      // served for an error page. Non-image bytes are refused, not emitted.
      const sniffed = sniffImageType(bytes)
      if (!sniffed) {
        return { ok: false, file_name: args.file_name, code: 'not_an_image', retryable: false, markdown: `Fetched ${bytes.byteLength} bytes but they are not a recognized image (PNG/JPEG/GIF/WebP). May be a non-image asset or an error page.` } as any
      }
      const save = args.save !== false
      if (!save) {
        return { ok: true, file_name: args.file_name, mimeType: sniffed.mimeType, bytes: bytes.byteLength, wrote: false } as any
      }
      const base = baseDirOf(exec)
      const outDirArg = typeof args.out_dir === 'string' ? args.out_dir.trim() : ''
      const outDir = outDirArg
        ? resolveInsideRoot(base, outDirArg)
        : resolveSubDir(resolveRootDir(env.settings().defaultOutputDir, base), 'figs')
      if (!outDir) {
        return { ok: false, file_name: args.file_name, code: 'validation_error', retryable: false, markdown: '`out_dir` must resolve inside the session workspace (absolute paths and `..` escapes are not allowed).' } as any
      }
      // Name the file from the paper identity + figure number + caption when the
      // model supplies them (so it's self-describing and paper-scoped); otherwise
      // fall back to the raw asset path so distinct figures never collapse to one name.
      const hasContext = (typeof args.paper === 'string' && args.paper.trim()) || (typeof args.fignum === 'string' && args.fignum.trim()) || (typeof args.caption === 'string' && args.caption.trim())
      const name = hasContext
        ? buildFigureFilename({ doi: args.paper, fignum: args.fignum, caption: args.caption, ext: sniffed.ext })
        : safeImageBasename(args.file_name, sniffed.ext)
      let path: string
      try {
        await mkdir(outDir, { recursive: true })
        path = join(outDir, name)
        await writeFile(path, bytes)
      } catch (e) {
        return { ok: false, file_name: args.file_name, code: 'io_error', retryable: false, markdown: `Could not write figure: ${(e as Error).message}` } as any
      }
      return { ok: true, file_name: args.file_name, mimeType: sniffed.mimeType, bytes: bytes.byteLength, path, wrote: true } as any
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'sciverse_trend_scan',
    description: `Research-trend pipeline in one call: per-year publication counts, top-cited papers and top venues for a topic.
Use when: field trends, hotness or per-year counts are asked.
Not for: finding or reading the papers themselves (\`scholar_search_papers\`, \`sciverse_semantic_search\`).
Returns: table-ready per-year rows (count, top-cited, venues).
Backends: \`source:"s2"\` (default) = Semantic Scholar counts/citations, real values at any size. \`source:"sciverse"\` = OpenAlex-topic-scoped meta-search: exact counts below the ${SCIVERSE_TOTAL_HITS_CAP} cap plus in-topic top-cited — topic scoping is required there (the keyword index caps at ${SCIVERSE_TOTAL_HITS_CAP} and is unreliable for broad queries); verify top-cited titles are on-topic.
Topic resolution (sciverse): pass \`topic_id\` (OpenAlex URL, e.g. https://openalex.org/T11143) or let the tool discover it — a clear plurality auto-selects, otherwise \`code:"topic_ambiguous"\` with the TOP-5 ids: ask via \`ask_user_question\` and re-run with the chosen \`topic_id\`.`,
    parameters: {
      query: { type: 'string', description: 'Topic keywords; used as the S2 query and (sciverse mode) as the discovery query. Required.' },
      source: { type: 'string', enum: ['s2', 'sciverse'], description: 's2 (default) = Semantic Scholar counts/citations; sciverse = OpenAlex-topic-scoped meta-search (topic_id or auto-discovery → topic_ambiguous with top-5 candidates).' },
      topic_id: { type: 'string', description: 'OpenAlex topic URL for source:"sciverse" (e.g. https://openalex.org/T11143); omit to auto-discover from the query.' },
      topic_name: { type: 'string', description: 'Optional display name for the topic (shown when topic_id is given explicitly).' },
      boolean: {
        type: 'object',
        description: 'Structured boolean components for the S2 query — preferred over raw operators.',
        properties: {
          phrases: { type: 'array', items: { type: 'string', description: 'Exact phrase, quoted' } },
          required: { type: 'array', items: { type: 'string', description: 'Term that must appear (+term)' } },
          excluded: { type: 'array', items: { type: 'string', description: 'Term that must not appear (-term)' } },
          orTerms: { type: 'array', items: { type: 'string', description: 'OR group (a | b | c)' } },
        },
        additionalProperties: true,
      },
      year_from: { type: 'integer', description: `Earliest year (default: year_to - 4; span capped at ${TREND_MAX_YEARS} years)` },
      year_to: { type: 'integer', description: 'Latest year (default: current year)' },
      top_n: { type: 'integer', description: `Top-cited papers per year (default ${TREND_DEFAULT_TOP_N}, cap ${TREND_MAX_TOP_N})` },
      pool: { type: 'integer', description: `Candidate pool per year for the venue distribution, and the discovery pool in sciverse mode (default ${TREND_DEFAULT_POOL}, cap ${TREND_MAX_POOL})` },
      minCitationCount: { type: 'integer', description: 'Only papers with at least this many citations; s2 mode only' },
      publicationTypes: { type: 'string', description: 'e.g. JournalArticle,Conference,Review (comma-separated); s2 mode only' },
    },
    output: markdownOutput(
      { ok: { type: 'boolean' }, query: { type: 'string' }, source: { type: 'string' }, topic_id: { type: 'string' }, topic_name: { type: 'string' }, code: { type: 'string' }, candidates: { type: 'array', items: { type: 'json' } }, years: { type: 'array', items: { type: 'json' } } },
      (value) => `Trend for "${value.query ?? ''}"${value.topic_name ? ` (${value.topic_name})` : ''}: ${Array.isArray(value.years) ? value.years.length : 0} years.`,
    ),
    async execute(args, exec) {
      const source = args.source === 'sciverse' ? 'sciverse' : 's2'
      const builtQuery = args.boolean ? s2.buildBoolQuery(args.boolean) : args.query
      const q = (builtQuery ?? '').trim() || String(args.query ?? '').trim()
      if (!q) return { ok: false, query: q, source, years: [], code: 'validation_error', retryable: false, markdown: 'sciverse_trend_scan needs a non-empty `query` (or a `boolean` with at least one term).' } as any
      const range = resolveYearRange(args.year_from, args.year_to, TREND_MAX_YEARS)
      if (!range.ok) return { ok: false, query: q, source, years: [], code: 'validation_error', retryable: false, markdown: range.error } as any
      const topN = Math.min(Math.max(Math.trunc(args.top_n ?? TREND_DEFAULT_TOP_N), 1), TREND_MAX_TOP_N)
      const pool = Math.min(Math.max(Math.trunc(args.pool ?? TREND_DEFAULT_POOL), 1), TREND_MAX_POOL)
      if (source === 'sciverse') {
        return guarded('trend_scan', () => runSciverseTrendScan(env, {
          query: q,
          years: range.years,
          yearFrom: range.yearFrom,
          yearTo: range.yearTo,
          topN,
          pool,
          topicId: args.topic_id,
          topicName: args.topic_name,
          signal: exec.signal,
        }))
      }
      // S2 runtime is only needed on the s2 path — the sciverse mode must not
      // create (or fail on) the Semantic Scholar client.
      const { s2: client } = runtimeOf(ctx, env, exec)
      const years: Array<{ year: number; total: number; top: TrendPaper[]; venues: TrendVenue[] }> = []
      for (const y of range.years) {
        // One bulk call per year: citation-sorted page serves BOTH the top-cited
        // papers and the venue histogram; the API `total` is the year count.
        const r = await s2.searchBulkWithMeta(client, q, {
          limit: pool,
          sort: 'citationCount:desc',
          filters: {
            year: String(y),
            ...pickFilters(args),
          },
        })
        const shaped = r.papers.map(mapS2Paper)
        years.push({ year: y, total: r.total ?? r.papers.length, top: topByCitation(shaped, topN), venues: topVenues(shaped, TREND_VENUE_TOP_N) })
      }
      const lines = years.map((row) => fmtTrendRow(row, `${row.total}`))
      const markdown = `**Trend: "${q}" (${range.yearFrom}-${range.yearTo})** — counts and top-cited from Semantic Scholar (real citation counts, citation-sorted; venue distribution over the top ${pool} hits per year).\n\n${lines.join('\n\n')}`
      return { ok: true, query: q, source: 's2', years, markdown }
    },
    timeoutMs: SCIVERSE_WORKFLOW_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'sciverse_evidence_pack',
    description: `Build a verifiable citation pack for up to ${EVIDENCE_MAX_CLAIMS} claims: per claim, semantic search for the best passage, then read the full-text slice at its offset to verify the quote is in the source.
Use when: grounding a draft or answer with checkable quotes, or fact-checking claims.
Not for: broad discovery (\`sciverse_search_papers\`) or one claim's passage (\`sciverse_semantic_search\`).
Returns: per claim {claim, quote, chunk_id, doc_id, offset, page_no, title, score, confidence, verified, matched} — quotes are verbatim, never rewritten. The item's \`title\` is what \`scholar_card_save\` takes (this endpoint serves no id/DOI). Unverified items stay marked unverified: report, never silently drop. Batch larger drafts into several calls.`,
    parameters: {
      claims: { type: 'array', items: { type: 'string' }, description: `Claims to ground (1-${EVIDENCE_MAX_CLAIMS}); each is used as the semantic query`, required: true },
      top_k: { type: 'integer', description: `Semantic hits per claim (default ${EVIDENCE_DEFAULT_TOP_K}, cap ${EVIDENCE_MAX_TOP_K})` },
      min_score: { type: 'number', description: `Minimum score to count as a match (default ${EVIDENCE_DEFAULT_MIN_SCORE}, clamped to 0-1)` },
      mode: { type: 'string', enum: ['fast', 'balanced', 'quality'], description: 'Semantic search mode: fast=keyword (~200ms); balanced=hybrid (~600ms, default); quality=LLM-rewrite (~2-4s)' },
      quote_max: { type: 'integer', description: `Max quote length per item in chars (default ${EVIDENCE_DEFAULT_QUOTE_MAX}, clamped to 100-2000)` },
    },
    output: markdownOutput(
      { ok: { type: 'boolean' }, total: { type: 'integer' }, verified: { type: 'integer' }, matched: { type: 'integer' }, items: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} claims (${value.verified ?? 0} verified).`,
    ),
    async execute(args, exec) {
      return guarded('evidence_pack', async () => {
      const key = await env.resolveSciverseKey()
      if (!key) return { ok: false, total: 0, verified: 0, matched: 0, items: [], markdown: sciverseNotConfigured() } as any
      const claims = (Array.isArray(args.claims) ? args.claims : []).map((c: unknown) => (typeof c === 'string' ? c.trim() : '')).filter(Boolean)
      if (!claims.length) return { ok: false, total: 0, verified: 0, matched: 0, items: [], code: 'validation_error', retryable: false, markdown: 'sciverse_evidence_pack needs at least one `claim`.' } as any
      if (claims.length > EVIDENCE_MAX_CLAIMS) return { ok: false, total: 0, verified: 0, matched: 0, items: [], code: 'validation_error', retryable: false, markdown: `sciverse_evidence_pack accepts at most ${EVIDENCE_MAX_CLAIMS} claims (got ${claims.length}); split into multiple calls.` } as any
      const topK = Math.min(Math.max(Math.trunc(args.top_k ?? EVIDENCE_DEFAULT_TOP_K), 1), EVIDENCE_MAX_TOP_K)
      const minScore = Number.isFinite(args.min_score) ? Math.min(Math.max(args.min_score as number, 0), 1) : EVIDENCE_DEFAULT_MIN_SCORE
      const quoteMax = Math.min(Math.max(Math.trunc(args.quote_max ?? EVIDENCE_DEFAULT_QUOTE_MAX), 100), 2000)
      const mode = typeof args.mode === 'string' ? args.mode : undefined
      const sc = createSciverseClient(key, SCIVERSE_CLIENT_TIMEOUT_MS)
      const items: EvidenceItem[] = []
      for (const [i, claim] of claims.entries()) {
        if (i > 0) await sleep(SCIVERSE_WORKFLOW_PACE_MS, exec.signal)
        const res = (await sc.semanticSearch({ query: claim, top_k: topK, ...(mode ? { mode } : {}) }, exec.signal)) as any
        const hits = Array.isArray(res?.hits) ? (res.hits as Record<string, unknown>[]) : []
        const { hit, matched } = pickEvidenceHit(hits, minScore)
        let verified = false
        if (hit && typeof hit.doc_id === 'string' && typeof hit.offset === 'number') {
          await sleep(SCIVERSE_WORKFLOW_PACE_MS, exec.signal)
          try {
            const slice = (await sc.readContent({ doc_id: hit.doc_id as string, offset: hit.offset as number, limit: EVIDENCE_READ_LEN }, exec.signal)) as any
            verified = verifyQuoteInSlice(String(slice?.text ?? ''), String(hit.chunk ?? ''))
          } catch {
            // Full text unavailable at this offset — keep the semantic hit but
            // mark it unverified instead of failing the whole pack.
            verified = false
          }
        }
        items.push(buildEvidenceItem(claim, hit, { matched, verified, quoteMax }))
      }
      const verifiedN = items.filter((it) => it.verified).length
      const matchedN = items.filter((it) => it.matched).length
      const lines = items.map((it, i) => {
        const status = it.matched ? (it.verified ? '✅ verified' : '⚠️ matched, unverified') : '❌ no evidence ≥ min_score'
        const src = it.title ? `*${it.title}*` : ''
        const loc = it.doc_id ? `\`${it.doc_id}\`${it.offset !== undefined ? ` @${it.offset}` : ''}${it.page_no !== undefined ? ` p.${it.page_no}` : ''}` : 'no doc'
        return `### Claim ${i + 1}: ${it.claim}\n${status} (score ${String(it.score ?? '?')}, confidence ${String(it.confidence ?? '?')}) — ${src} ${loc}\n> ${it.quote.replace(/\n/g, ' ').slice(0, 400)}${it.quote.length > 400 ? '…' : ''}`
      })
      const markdown = `**Evidence pack: ${items.length} claim(s), ${verifiedN} verified, ${matchedN} matched**\n\n${lines.join('\n\n')}${verifiedN < matchedN ? `\n\n> Unverified items matched semantically but the quote could not be located in the full-text slice — re-read the context before citing.` : ''}`
      return { ok: true, total: items.length, verified: verifiedN, matched: matchedN, items, markdown }
      })
    },
    timeoutMs: SCIVERSE_WORKFLOW_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  return () => {
    for (const dispose of disposers) dispose()
  }
}
