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
import { SEARCH_RESULT_CAP, timeoutMsOf, type ScholarSettings } from '../settings.js'
import * as s2 from '../s2/client.js'
import * as fmt from '../s2/format.js'
import * as fetchSvc from '../fetch/service.js'
import type { FetchRuntime, WebSearchHit } from '../fetch/service.js'
import { createSciverseClient } from '../sciverse/client.js'
import { buildFigureFilename, extractFigureRefs, mapGetResourceError, safeImageBasename, sniffImageType } from '../sciverse/resource.js'
import { astaSnippetSearch, ASTA_DEFAULT_LIMIT, ASTA_TIMEOUT_MS, type AstaSnippet } from '../asta/client.js'
import { mineruParseUrl, mineruParseFile, MINERU_TIMEOUT_MS } from '../mineru/client.js'
import { resolveInsideRoot, resolveRootDir, resolveSubDir } from '../outdir.js'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { formatLibrary, pickSubdirs, type LibraryFile } from '../library.js'
import { sanitizeForOutput } from '../util/sanitize.js'

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
/** paper_pdf2md `timeoutSec` clamp: the lightweight parser is slow, so a floor
 * avoids a 0/negative deadline (instant "poll timeout"), and the tool cap is
 * derived from the MAX so a large user request isn't killed by a fixed tool
 * timeout. */
const MINERU_MIN_TIMEOUT_SEC = 10
const MINERU_MAX_TIMEOUT_SEC = 1800
/** Wall-clock cap per Sciverse API call (SDK accepts no AbortSignal; we bound
 * the call with withTimeout). Generous: quality semantic search takes seconds. */
const SCIVERSE_CLIENT_TIMEOUT_MS = 60_000
/** The Sciverse /meta-search backend caps reported hit counts at 10000 for any
 * free-text/BM25 query (OpenSearch track_total_hits-style). Structured field
 * filters report exact counts. We annotate the tool output when this ceiling is
 * reached so a 10000 is not mistaken for a real publication total. */
const SCIVERSE_TOTAL_HITS_CAP = 10000

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
    description: `Search Semantic Scholar for academic papers by query. Use for literature discovery: broad topics, precise boolean queries, filters (year, venue, field of study, min citations, publication types, open access). Bulk search is preferred; TLDR summaries are only available via the relevance strategy.`,
    parameters: {
      query: { type: 'string', description: 'Search query. For precision use boolean syntax via the `boolean` parameter instead of raw operators.', required: true },
      boolean: {
        type: 'object',
        description: 'Structured boolean query components (exact phrases, +required, -excluded, OR groups, fuzzy/proximity). Preferred over raw boolean syntax.',
        properties: {
          phrases: { type: 'array', items: { type: 'string', description: 'Exact phrase, quoted' } },
          required: { type: 'array', items: { type: 'string', description: 'Term that must appear (+term)' } },
          excluded: { type: 'array', items: { type: 'string', description: 'Term that must not appear (-term)' } },
          orTerms: { type: 'array', items: { type: 'string', description: 'OR group (a | b | c)' } },
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
        return { query, total: 0, strategy, markdown: 'scholar_search_papers needs a non-empty `query` (or a `boolean` with at least one term).', results: [] }
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
      return {
        query,
        total: deduped.length,
        strategy,
        markdown: fmt.formatResults(deduped, query.slice(0, 120)),
        results: fmt.compactPapers(deduped),
      }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_search_papers_by_snippet',
    description: `Search Semantic Scholar full-text to find PAPERS that contain a specific passage/sentence/method: returns the matched snippet and the paper it appears in (a discovery-by-text search, unlike scholar_search_papers which searches metadata).`,
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
    description: `Resolve a paper title to its exact Semantic Scholar record (paperId, DOI, metadata). Use before fetching when only a title is known.`,
    parameters: { title: { type: 'string', description: 'Exact paper title', required: true } },
    output: markdownOutput(
      { matched: { type: 'boolean' }, paper: { type: 'json' } },
      (value) => 'No match.',
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const d = await s2.matchTitle(client, args.title)
      const paper = (d.data ?? [])[0]
      if (!paper) return { matched: false, markdown: `No Semantic Scholar match for "${args.title}".` } as any
      return { matched: true, markdown: fmt.formatResults([paper], args.title), paper: fmt.compactPapers([paper])[0] } as any
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_get_paper',
    description: `Fetch one paper by ID. ID forms: DOI:10.xxxx/..., ARXIV:2106.15928, PMID:..., PMCID:..., CorpusId:....`,
    parameters: {
      paperId: { type: 'string', description: 'Paper id with prefix, e.g. DOI:10.1038/s41586-020-2649-2', required: true },
      includeAbstract: { type: 'boolean', description: 'Include the abstract (larger response)' },
    },
    output: markdownOutput(
      { paperId: { type: 'string' }, paper: { type: 'json' } },
      (value) => `Paper ${value.paperId ?? 'unknown'}.`,
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const paper = await s2.getPaper(client, args.paperId, args.includeAbstract ? undefined : 'title,year,citationCount,authors,venue,externalIds,tldr,openAccessPdf')
      return { paperId: args.paperId, markdown: fmt.formatResults([paper], (paper.title ?? args.paperId).slice(0, 120)), paper: fmt.compactPapers([paper])[0] ?? null }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_get_paper_snippets',
    description: `Get ~500-word full-text content snippets from the Ai2 Asta corpus (the Semantic Scholar owner's full-text index, not exposed by the public S2 API). Requires a \`query\` (topic/phrase/title); pass \`paperIds\` to scope to specific papers. Returns the snippets plus paper metadata (title, authors, license).`,
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
        return { markdown: 'Asta content tool is not configured. Add an `astaApiKeyRef` in the plugin settings (Settings -> Plugins -> Plugin configuration) to enable it.', snippets: [] }
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
    description: `List the papers citing a known paper, with optional intent labels (methodology/background/result) and context snippets.`,
    parameters: {
      paperId: { type: 'string', description: 'Paper id (e.g. DOI:10.48550/arXiv.1706.03762)', required: true },
      maxResults: { type: 'integer', description: 'Result cap (default 100)' },
      publicationDate: { type: 'string', description: 'Filter citing papers by date YYYY-MM-DD or range' },
      withIntents: { type: 'boolean', description: 'Include contextsWithIntent (larger response)' },
    },
    output: markdownOutput(
      { total: { type: 'integer' }, citations: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} citing papers.`,
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const citations = await s2.getCitations(client, args.paperId, { maxResults: args.maxResults ?? s2.DEFAULT_CITATIONS, publicationDate: args.publicationDate, withIntents: args.withIntents })
      const lines = citations.slice(0, 20).map((c, i) => {
        const p = c.citingPaper ?? {}
        const intents = args.withIntents ? [...new Set((c.contextsWithIntent ?? []).flatMap((e: any) => e.intents ?? []))].join(', ') : ''
        return `### ${i + 1}. ${p.title ?? 'Untitled'} (${p.year ?? '?'}) — cites: ${p.citationCount ?? 0}${intents ? `\n**Intents:** ${intents}` : ''}`
      })
      return {
        total: citations.length,
        markdown: `**${citations.length} citing papers.**\n\n${lines.join('\n')}${citations.length > 20 ? `\n\n…and ${citations.length - 20} more` : ''}`,
        citations,
      }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_get_references',
    description: `List the papers a known paper cites (backward citations).`,
    parameters: { paperId: { type: 'string', description: 'Paper id', required: true }, maxResults: { type: 'integer', description: 'Result cap (default 100)' } },
    output: markdownOutput(
      { total: { type: 'integer' }, references: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} references.`,
    ),
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const refs = await s2.getReferences(client, args.paperId, { maxResults: args.maxResults ?? s2.DEFAULT_CITATIONS })
      return {
        total: refs.length,
        markdown: fmt.formatResults(refs.map((r) => r.citedPaper ?? r), 'References'),
        references: refs,
      }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'scholar_get_recommendations',
    description: `Recommend papers similar to one or more seeds; negative seeds can steer away from unwanted topics.`,
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
    description: `Find researchers by name (affiliations, paper count, citations, h-index). Disambiguate common names by affiliation before using scholar_get_author.`,
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
    description: `One author profile by authorId (affiliations, paper count, citations, h-index).`,
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
    description: `An author's publication list by authorId.`,
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
    description: `Export BibTeX entries for up to 500 papers (by paperId or DOI:...).`,
    parameters: { ids: { type: 'array', items: { type: 'string', description: 'paperId or DOI:id' }, description: 'Papers to export', required: true } },
    output: {
      schema: { type: 'object', properties: { count: { type: 'integer' }, bibtex: { type: 'string' } }, additionalProperties: true },
      render(_args, value: any) {
        return value.bibtex ? text(value.bibtex) : text('No BibTeX entries available.')
      },
    },
    async execute(args, exec) {
      const { s2: client } = runtimeOf(ctx, env, exec)
      const papers = await s2.batchPapers(client, args.ids.slice(0, 500), 'title,citationStyles')
      const bibtex = fmt.exportBibtex(papers)
      return { count: papers.length, bibtex }
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
    description: `Find the best open-access PDF URL for a paper WITHOUT downloading anything. Provide exactly one of doi or title. Reports the winning source (Unpaywall/Semantic Scholar/arXiv/Europe PMC/PMC/bioRxiv/web_search) and metadata.`,
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
      const result = await fetchSvc.resolveOne(rt, doi)
      const sourceLine = result.success
        ? `**Source:** ${result.source}\n**PDF URL:** ${result.pdfUrl}\n**Title:** ${(result.meta as any).title ?? '?'}\n${(result.meta as any).year !== undefined ? `**Year:** ${(result.meta as any).year}\n` : ''}${result.source === 'web_search' && result.verified === false ? '*This link was found by web search and not fetched — treat it as a hint, not a confirmed OA copy.*\n' : ''}`
        : `**Not found.** ${(result.error as any)?.message ?? ''}`
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
    description: `Resolve a paper (doi or title) to its best open-access PDF, download it into the configured library directory (default .scholar/pdfs), and report the saved file path. Skips existing files unless overwrite.`,
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
      const result = await fetchSvc.fetchOne(rt, doi, { overwrite: args.overwrite })
      const err = result.error as { code?: string; message?: string; retry_after_hours?: number } | undefined
      const statusLine = result.success
        ? result.skipped
          ? `**Skipped** (already downloaded): ${result.file}`
          : `**Downloaded** from ${result.source}:\n- file: \`${result.file}\`\n- url: ${result.pdfUrl}`
        : `**Failed** [${err?.code}]: ${err?.message}${err?.retry_after_hours ? ` (retry after ~${err.retry_after_hours}h)` : ''}`
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
    description: `Fetch many papers by DOI (or a mix of dois/titles). Returns one envelope with per-item results, a summary, and retry hints for the failed subset. Use idempotencyKey to replay the exact envelope on re-run without re-downloading.`,
    parameters: {
      dois: { type: 'array', items: { type: 'string', description: 'DOI' }, description: 'DOIs to fetch (exactly one input of dois or titles)' },
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
      if (args.titles?.length) {
        for (const title of args.titles) {
          const r = await fetchSvc.resolveTitleToDoi(rt, title)
          if (r.doi) dois.push(r.doi)
        }
      }
      const envelope: any = await fetchSvc.fetchBatch(rt, dois, { overwrite: args.overwrite, idempotencyKey: args.idempotencyKey })
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
    description: `List PDFs already downloaded into the configured library directory (default .scholar/pdfs).`,
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
    description: `Convert a single PDF (an https://...pdf URL or a local file path) to Markdown full text via the MinerU Agent lightweight parse API (no API key; IP rate-limited; ≤10MB file cap — the page limit is a server-side constraint). Saves the .md into the configured library directory (default .scholar/md) and returns the path (+ a short excerpt).`,
    parameters: {
      pdf: { type: 'string', description: 'PDF to convert: an https://...pdf URL or a local file path.', required: true },
      timeoutSec: { type: 'integer', description: `Poll timeout in seconds (default ${Math.floor(MINERU_TIMEOUT_MS / 1000)})` },
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

  register(defineTool({
    name: 'scholar_list_library',
    description: `List everything the plugin has produced under the default output dir (default .scholar), grouped by subdirectory (pdfs/md/figs). Optionally restrict to one subdirectory.`,
    parameters: {
      subdir: { type: 'string', enum: ['pdfs', 'md', 'figs', 'all'], description: 'Which subdirectory to list (default all).' },
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
// RAG, full text, figures). Direct (no proxy — China-hosted service); token
// via the DSH credentials seam; calls bounded by withTimeout.
// ---------------------------------------------------------------------------

/** Compact one-line-per-paper markdown for search results. */
function fmtPapers(papers: readonly Record<string, unknown>[]): string {
  return papers
    .map((p) => {
      const authors = Array.isArray(p.author) ? (p.author as Array<{ name?: string }>).map((a) => a.name ?? '').filter(Boolean).join(', ') : ''
      const ids = [`\`${p.unique_id}\``]
      if (p.doc_id) ids.push(`doc_id: ${p.doc_id}`)
      const line = [`**${p.title ?? 'untitled'}**`, authors ? `— ${authors}` : '', [p.publication_published_year, p.publication_venue_name_unified].filter(Boolean).join(' · '), p.doi ? `DOI: ${p.doi}` : '', ids.join(' · ')].filter(Boolean).join('\n')
      return line
    })
    .join('\n\n')
}

/** Compact markdown for citation-relation entries (shape {id, id_type, title}). */
function fmtRelationItems(items: readonly Record<string, unknown>[]): string {
  return items
    .map((r) => `- **${r.title ?? 'untitled'}**${r.id ? ` — \`${r.id}${r.id_type ? ` (${r.id_type})` : ''}\`` : ''}`)
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

/** Not-configured markdown shared by all sciverse_* tools. */
function sciverseNotConfigured(): string {
  return 'sciverse_* tools are not configured. Add a `sciverseApiKeyRef` credential (Settings -> Plugins -> Plugin configuration → "Sciverse API token") to enable them.'
}

/** Register the six sciverse_* tools; returns a disposer that unregisters all. */
export function applySciverseTools(ctx: Context, env: ScholarToolEnv): () => void {
  const disposers: Array<() => void> = []

  const register = (tool: ReturnType<typeof defineTool>): void => {
    registerTool(ctx, disposers, tool, () => 'See result.')
  }

  register(defineTool({
    name: 'sciverse_list_catalog',
    description: `Discover the search_papers field catalog for a Sciverse collection (papers/authors/sources): which fields exist, which support filtering/sorting, and sample enum values. Call this first when unsure which field to filter on.`,
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
      const key = await env.resolveSciverseKey()
      if (!key) return { ok: false, markdown: sciverseNotConfigured(), fields: [] } as any
      const sc = createSciverseClient(key, SCIVERSE_CLIENT_TIMEOUT_MS)
      const r = (await sc.listCatalog(args as { include_sample_values?: boolean; include_field_stats?: boolean; collection?: string })) as any
      const fields = Array.isArray(r?.fields) ? r.fields : []
      return { ok: true, collection: args.collection ?? 'papers', fields, markdown: `**Sciverse catalog** (\`${args.collection ?? 'papers'}\`): ${fields.length} fields\n\n${fields.map((f: any) => `- \`${f.field_name ?? f.name ?? f.field}\` — ${f.description ?? ''}`).join('\n')}` }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'sciverse_search_papers',
    description: `Structured metadata search over the Sciverse corpus (papers/authors/sources collections): title/author/journal/year/subject filters, advanced filters, and pagination. Returns paper metadata with unique_id (always) and doc_id (when full text exists). Use doc_id with sciverse_read_content to read the actual full text — the upstream accessibility flag is advisory and not a reliable gate. For natural-language questions use sciverse_semantic_search instead. Note: reported hit totals are capped at 10000 by the server whenever the matched set is larger (keyword query or broad filter); narrow the query/filters for an exact count. \`abstract_contains\` is folded into the full-text \`query\`.`,
    parameters: {
      collection: { type: 'string', enum: ['papers', 'authors', 'sources'], description: 'Entity collection (default papers)' },
      query: { type: 'string', description: 'BM25 keyword query over title/abstract/venue/keywords; empty = structured filters only' },
      title_contains: { type: 'string', description: 'Word the title must contain' },
      abstract_contains: { type: 'string', description: 'Word the abstract must contain — matched via the full-text query (the abstract field is not filterable; the term is folded into `query`).' },
      authors: { type: 'array', items: { type: 'string' }, description: 'Author names (any match)' },
      year_from: { type: 'integer', description: 'Earliest publication year (inclusive)' },
      year_to: { type: 'integer', description: 'Latest publication year (inclusive)' },
      journals: { type: 'array', items: { type: 'string' }, description: 'Journal/venue names (any match)' },
      subjects: { type: 'array', items: { type: 'string' }, description: 'Subject categories, e.g. "computer science"' },
      filters_advanced: { type: 'array', items: { type: 'json' }, description: 'Advanced filter escapes, e.g. [{"field":"references_unique_id","value":"paper:10.1109/cvpr.2016.90"},{"field":"publication_published_year","operator":"FILTER_OP_GTE","value":2023}]' },
      sort_by_year: { type: 'string', enum: ['auto', 'desc', 'asc', 'none'], description: 'Year ordering (default auto)' },
      freshness_boost: { type: 'string', enum: ['NONE', 'MILD', 'STRONG'], description: 'Recency weighting for keyword queries (MILD=10y, STRONG=3y)' },
      impact_boost: { type: 'string', enum: ['NONE', 'MILD', 'STRONG'], description: 'Citation-impact weighting for keyword queries' },
      language_affinity: { type: 'string', enum: ['NONE', 'MILD', 'STRONG'], description: 'Prefer results in the query language' },
      page: { type: 'integer', description: 'Page number (default 1)' },
      page_size: { type: 'integer', description: 'Page size (default 10)' },
    },
    output: markdownOutput(
      { ok: { type: 'boolean' }, total: { type: 'integer' }, page: { type: 'integer' }, results: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} papers (page ${value.page ?? 1}).`,
    ),
    async execute(args, exec) {
      const key = await env.resolveSciverseKey()
      if (!key) return { ok: false, total: 0, results: [], markdown: sciverseNotConfigured() } as any
      const sc = createSciverseClient(key, SCIVERSE_CLIENT_TIMEOUT_MS)
      // `abstract_contains` maps to a FILTER_OP_CONTAINS on `abstract`, which the
      // backend rejects (abstract has no .keyword subfield — full-text only, so it
      // cannot be filtered; see the field catalog). Fold it into the full-text
      // `query` and drop it so it never reaches the SDK's filter path.
      const payload: Record<string, unknown> = { ...args }
      const abstractTerm = typeof payload.abstract_contains === 'string' ? payload.abstract_contains.trim() : ''
      if (abstractTerm) {
        delete payload.abstract_contains
        payload.query = [typeof payload.query === 'string' ? payload.query : '', abstractTerm].filter(Boolean).join(' ').trim()
      }
      const r = (await sc.searchPapers(payload)) as any
      const results = Array.isArray(r?.results) ? r.results : []
      const total = r.total_count ?? results.length
      // The backend caps reported hit counts at 10000 whenever the matched set is
      // larger (track_total_hits-style) — for keyword queries AND broad structured
      // filters alike (e.g. subjects alone hit it, with no keyword query). Annotate
      // any 10000 so it is not mistaken for a real total; exact counts require a
      // narrowed query/filter set (structured filters are not always exact).
      const capped = total >= SCIVERSE_TOTAL_HITS_CAP
      const markdown = results.length
        ? `**${total} papers** (page ${args.page ?? 1})${capped
          ? `\n\n> total is capped at ${SCIVERSE_TOTAL_HITS_CAP} by the server (the matched set is larger). Narrow the query/filters (title_contains / journals / subjects / year range) for an exact count.`
          : ''}\n\n${fmtPapers(results)}`
        : 'No papers found.'
      return { ok: true, total, page: args.page ?? 1, results, markdown }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'sciverse_semantic_search',
    description: `Natural-language semantic retrieval over the Sciverse corpus (RAG): returns the most relevant passage chunks (title, chunk text, byte offset, score). Follow up with sciverse_read_content (doc_id + offset) to extend context, and sciverse_get_resource for figures/tables.`,
    parameters: {
      query: { type: 'string', description: 'Natural-language question, 1-200 chars is best', required: true },
      top_k: { type: 'integer', description: 'Number of chunks to return — legal range 1-100 (default 10; ~3 chunks max per paper)' },
      mode: { type: 'string', enum: ['fast', 'balanced', 'quality'], description: 'fast=keyword only (~200ms); balanced=hybrid (~600ms); quality=LLM-rewrite+hybrid (~2-4s)' },
      source_types: { type: 'array', items: { type: 'string', enum: ['web', 'pdf'] }, description: 'Restrict chunk sources' },
      filters: { type: 'json', description: 'Approximate structured filters during retrieval, e.g. {"author":["Hinton"],"publication_published_year":{"gte":2023}}' },
    },
    output: markdownOutput(
      { ok: { type: 'boolean' }, hits: { type: 'array', items: { type: 'json' } } },
      (value) => `${Array.isArray(value.hits) ? value.hits.length : 0} passage chunks.`,
    ),
    async execute(args, exec) {
      const key = await env.resolveSciverseKey()
      if (!key) return { ok: false, hits: [], markdown: sciverseNotConfigured() } as any
      const sc = createSciverseClient(key, SCIVERSE_CLIENT_TIMEOUT_MS)
      const r = (await sc.semanticSearch({ query: args.query, top_k: args.top_k, mode: args.mode, source_types: args.source_types, filters: args.filters })) as any
      const hits = Array.isArray(r?.hits) ? r.hits : []
      return { ok: true, hits, markdown: hits.length ? `**${hits.length} passage chunk(s)**\n\n${fmtChunks(hits)}` : 'No passages found.' }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'sciverse_list_paper_relations',
    description: `Paginate a paper's full citation relations (CITATIONS = who cites it; REFERENCES = what it cites; RELATED_WORKS). Deep pagination for very large lists: use the alternative references_unique_id filter in sciverse_search_papers (relations >10000 return 429 here).`,
    parameters: {
      unique_id: { type: 'string', description: 'The paper\'s unique_id from a sciverse search', required: true },
      relation: { type: 'string', enum: ['CITATIONS', 'REFERENCES', 'RELATED_WORKS'], description: 'Which relation list to page', required: true },
      page: { type: 'integer', description: 'Page number (default 1)' },
      page_size: { type: 'integer', description: 'Page size (default 10)' },
    },
    output: markdownOutput(
      { ok: { type: 'boolean' }, unique_id: { type: 'string' }, relation: { type: 'string' }, total: { type: 'integer' }, items: { type: 'array', items: { type: 'json' } } },
      (value) => `${value.total ?? 0} ${value.relation ?? ''} entries.`,
    ),
    async execute(args, exec) {
      const key = await env.resolveSciverseKey()
      if (!key) return { ok: false, unique_id: args.unique_id, relation: args.relation, total: 0, items: [], markdown: sciverseNotConfigured() } as any
      const sc = createSciverseClient(key, SCIVERSE_CLIENT_TIMEOUT_MS)
      const r = (await sc.listPaperRelations({ unique_id: args.unique_id, relation: args.relation, page: args.page, page_size: args.page_size })) as any
      const items = Array.isArray(r?.items ?? r?.results) ? (r.items ?? r.results) : []
      const total = r.total_count ?? items.length
      return { ok: true, unique_id: args.unique_id, relation: args.relation, total, items, markdown: items.length ? `**${total} ${args.relation} entries** (page ${args.page ?? 1})\n\n${fmtRelationItems(items as Record<string, unknown>[])}` : `No ${args.relation} entries.` }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'sciverse_read_content',
    description: `Read a byte-range slice of a paper's full text by doc_id (usually the chunk offset from sciverse_semantic_search, extended via next_offset). Returns the slice + bytes_returned + next_offset for continued reading.`,
    parameters: {
      doc_id: { type: 'string', description: 'Full-text artifact id (sha256) from a sciverse search/semantic hit', required: true },
      offset: { type: 'integer', description: 'Byte offset to start reading from (default 0)' },
      limit: { type: 'integer', description: 'Max bytes to read (server-enforced cap)' },
    },
    output: markdownOutput(
      { ok: { type: 'boolean' }, doc_id: { type: 'string' }, bytes_returned: { type: 'integer' }, next_offset: { type: 'integer' }, text: { type: 'string' }, images: { type: 'array', items: { type: 'object', properties: { file_name: { type: 'string' }, caption: { type: 'string' } }, additionalProperties: true } } },
      (value) => `${value.bytes_returned ?? 0} bytes at offset ${value.next_offset ?? 0}${Array.isArray(value.images) && value.images.length ? `; figures: ${value.images.map((i: any) => i.file_name).join(', ')}` : ''}.`,
    ),
    async execute(args, exec) {
      const key = await env.resolveSciverseKey()
      if (!key) return { ok: false, doc_id: args.doc_id, bytes_returned: 0, next_offset: 0, text: '', images: [], markdown: sciverseNotConfigured() } as any
      const sc = createSciverseClient(key, SCIVERSE_CLIENT_TIMEOUT_MS)
      const r = (await sc.readContent({ doc_id: args.doc_id, offset: args.offset, limit: args.limit })) as any
      const text = String(r?.text ?? '')
      // Surfaces figure/table references as ![alt](file_name) in this slice, with
      // BOTH the file_name (for sciverse_get_resource) and the alt caption (the
      // only semantic hint the model gets) so it can judge the figure content
      // without rereading.
      const figs = extractFigureRefs(text)
      return {
        ok: true, doc_id: args.doc_id, bytes_returned: r?.bytes_returned ?? text.length, next_offset: r?.next_offset ?? 0, text, images: figs,
        markdown: text ? `**Full-text slice** (${r?.bytes_returned ?? text.length} bytes)\n\n${text.slice(0, 1200)}${text.length > 1200 ? '…' : ''}${figs.length ? `\n\n**Figures in this slice:**\n${figs.map((f) => `- ${f.caption ? `*${f.caption}* — ` : ''}\`${f.file_name}\``).join('\n')}` : ''}${r?.next_offset ? `\n\n> continue with offset=${r.next_offset}` : ''}` : `Empty slice at offset ${args.offset ?? 0} (no text, ${r?.bytes_returned ?? 0} bytes). This usually means the end of the document's content is reached (the doc IS accessible) — try a smaller \`offset\` or a different \`doc_id\`.`,
      }
    },
    timeoutMs: SCHOLAR_TOOL_TIMEOUT_MS,
    isConcurrencySafe: NON_CONCURRENT,
  }))

  register(defineTool({
    name: 'sciverse_get_resource',
    description: `Fetch a figure/table image embedded in a paper's full text by its file name (referenced as ![alt](file_name) inside sciverse_read_content markdown), validate it is a real image, and (by default) save it to <defaultOutputDir>/figs (default .scholar/figs). Returns the saved path + mimeType + byte size — never the full base64 inline. Pass the paper id (\`paper\`), figure number (\`fignum\`) and caption (\`caption\`) to save a self-describing name (\`{doi}_Fig_{n}_Caption_{text}\`) instead of the raw hash.`,
    parameters: {
      file_name: { type: 'string', description: 'Image file name from read_content markdown (relative path)', required: true },
      paper: { type: 'string', description: `Paper identifier for the filename: a DOI, unique_id (e.g. paper:10.1038/xxx), or short title. Scopes the saved name so figures from different papers don't collide.` },
      fignum: { type: 'string', description: `Figure number for the filename (e.g. '2'). When omitted, parsed from the caption (e.g. 'Figure 2. …').` },
      caption: { type: 'string', description: `Figure caption / alt text from read_content (e.g. 'Figure 2. Architecture'). Embedded (truncated to 20 chars) in the saved filename so it's self-describing; omitted when blank.` },
      save: { type: 'boolean', description: 'Write the image to disk (default true). When false, only metadata is returned (no path).' },
      out_dir: { type: 'string', description: `Directory for saved figures, resolved against the session workspace (default: <defaultOutputDir>/figs, i.e. .scholar/figs).` },
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
        const r = (await sc.getResource({ file_name: args.file_name })) as { bytes?: Uint8Array }
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

  return () => {
    for (const dispose of disposers) dispose()
  }
}
