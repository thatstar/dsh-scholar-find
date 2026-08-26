/**
 * Tool registration for dsh-scholar-find: `scholar_search_*` and `paper_fetch_*`
 * families, defined with `defineTool` and registered into `ctx.tools`.
 * @module dsh-scholar-find/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createScholarClient } from '../s2/client.js';
import * as s2 from '../s2/client.js';
import * as fmt from '../s2/format.js';
import * as fetchSvc from '../fetch/service.js';
function text(content) {
    return [{ type: 'text', text: content }];
}
function baseDirOf(exec) {
    const agent = exec.agent;
    return agent?.session?.meta?.cwd ?? process.cwd();
}
function runtimeOf(ctx, env, exec) {
    const settings = env.settings();
    const s2Client = createScholarClient({
        apiKey: env.resolveApiKey,
        minGapMs: settings.s2RequestGapMs,
        timeoutMs: settings.fetchTimeoutSec * 1000,
        signal: exec.signal,
    });
    return {
        s2: s2Client,
        fetch: {
            settings,
            s2: s2Client,
            baseDir: baseDirOf(exec),
            signal: exec.signal,
        },
    };
}
/** Register every scholar tool; returns a disposer that unregisters all. */
export function applyScholarTools(ctx, env) {
    const disposers = [];
    const register = (tool) => {
        const tools = ctx.get('tools');
        if (!tools)
            return;
        disposers.push(tools.register(tool));
    };
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
            render(args, value) {
                return text(value.markdown ?? `Search finished: ${value.total ?? 0} papers.`);
            },
        },
        async execute(args, exec) {
            const { s2: client } = runtimeOf(ctx, env, exec);
            const query = args.boolean ? s2.buildBoolQuery(args.boolean) : args.query;
            const strategy = args.includeTldr ? 'relevance' : 'bulk';
            const maxResults = Math.min(args.maxResults ?? env.settings().maxResultsPerSearch, 100);
            const papers = args.includeTldr
                ? await s2.searchRelevance(client, query, {
                    maxResults,
                    filters: pickFilters(args),
                })
                : await s2.searchBulk(client, query, {
                    maxResults,
                    sort: args.sort ?? 'citationCount:desc',
                    filters: pickFilters(args),
                });
            const deduped = s2.deduplicate(papers);
            return {
                query,
                total: deduped.length,
                strategy,
                markdown: fmt.formatResults(deduped, query.slice(0, 120)),
                results: fmt.compactPapers(deduped),
            };
        },
        timeoutMs: 120_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'scholar_search_snippets',
        description: `Search Semantic Scholar full-text passages: find papers containing specific sentences, methods, or section content rather than just titles.`,
        parameters: {
            query: { type: 'string', description: 'Passage/method text to find in full-text bodies', required: true },
            paperIds: { type: 'string', description: 'Optional comma-separated paperIds to scope the search' },
            authors: { type: 'string', description: 'Optional comma-separated authorIds to scope the search' },
            insertedBefore: { type: 'string', description: 'YYYY-MM-DD: restrict to snippets ingested before this date' },
            maxResults: { type: 'integer', description: 'Result cap (default 10)' },
        },
        output: {
            schema: { type: 'object', properties: { query: { type: 'string' }, total: { type: 'integer' }, snippets: { type: 'array', items: { type: 'json' } } }, additionalProperties: true },
            render(_args, value) {
                const rows = (value.snippets ?? []).map((s, i) => `- ${i + 1}. ${s.snippet?.text ?? ''}`);
                return text(`**${value.total ?? 0} snippet hits** for "${value.query}"\n\n${rows.slice(0, 10).join('\n')}`);
            },
        },
        async execute(args, exec) {
            const { s2: client } = runtimeOf(ctx, env, exec);
            const snippets = await s2.searchSnippets(client, args.query, {
                maxResults: args.maxResults ?? 10,
                paperIds: args.paperIds,
                authors: args.authors,
                insertedBefore: args.insertedBefore,
            });
            return { query: args.query, total: snippets.length, snippets };
        },
        timeoutMs: 120_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'scholar_match_title',
        description: `Resolve a paper title to its exact Semantic Scholar record (paperId, DOI, metadata). Use before fetching when only a title is known.`,
        parameters: { title: { type: 'string', description: 'Exact paper title', required: true } },
        output: {
            schema: { type: 'object', properties: { matched: { type: 'boolean' }, markdown: { type: 'string' }, paper: { type: 'json' } }, additionalProperties: true },
            render(_args, value) {
                return value.markdown ?? text('No match.');
            },
        },
        async execute(args, exec) {
            const { s2: client } = runtimeOf(ctx, env, exec);
            const d = await s2.matchTitle(client, args.title);
            const paper = (d.data ?? [])[0];
            if (!paper)
                return { matched: false, markdown: `No Semantic Scholar match for "${args.title}".` };
            return { matched: true, markdown: fmt.formatResults([paper], args.title), paper: fmt.compactPapers([paper])[0] };
        },
        timeoutMs: 120_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'scholar_get_paper',
        description: `Fetch one paper by ID. ID forms: DOI:10.xxxx/..., ARXIV:2106.15928, PMID:..., PMCID:..., CorpusId:....`,
        parameters: {
            paperId: { type: 'string', description: 'Paper id with prefix, e.g. DOI:10.1038/s41586-020-2649-2', required: true },
            includeAbstract: { type: 'boolean', description: 'Include the abstract (larger response)' },
        },
        output: {
            schema: { type: 'object', properties: { paperId: { type: 'string' }, markdown: { type: 'string' }, paper: { type: 'json' } }, additionalProperties: true },
            render(_args, value) {
                return value.markdown ?? text(`Paper ${value.paperId ?? 'unknown'}.`);
            },
        },
        async execute(args, exec) {
            const { s2: client } = runtimeOf(ctx, env, exec);
            const paper = await s2.getPaper(client, args.paperId, args.includeAbstract ? undefined : 'title,year,citationCount,authors,venue,externalIds,tldr,openAccessPdf');
            return { paperId: args.paperId, markdown: fmt.formatResults([paper], (paper.title ?? args.paperId).slice(0, 120)), paper: fmt.compactPapers([paper])[0] ?? null };
        },
        timeoutMs: 120_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'scholar_get_citations',
        description: `List the papers citing a known paper, with optional intent labels (methodology/background/result) and context snippets.`,
        parameters: {
            paperId: { type: 'string', description: 'Paper id (e.g. DOI:10.48550/arXiv.1706.03762)', required: true },
            maxResults: { type: 'integer', description: 'Result cap (default 100)' },
            publicationDate: { type: 'string', description: 'Filter citing papers by date YYYY-MM-DD or range' },
            withIntents: { type: 'boolean', description: 'Include contextsWithIntent (larger response)' },
        },
        output: {
            schema: { type: 'object', properties: { total: { type: 'integer' }, markdown: { type: 'string' }, citations: { type: 'array', items: { type: 'json' } } }, additionalProperties: true },
            render(_args, value) {
                return value.markdown ?? text(`${value.total ?? 0} citing papers.`);
            },
        },
        async execute(args, exec) {
            const { s2: client } = runtimeOf(ctx, env, exec);
            const citations = await s2.getCitations(client, args.paperId, { maxResults: args.maxResults ?? 100, publicationDate: args.publicationDate, withIntents: args.withIntents });
            const lines = citations.slice(0, 20).map((c, i) => {
                const p = c.citingPaper ?? {};
                const intents = args.withIntents ? [...new Set((c.contextsWithIntent ?? []).flatMap((e) => e.intents ?? []))].join(', ') : '';
                return `### ${i + 1}. ${p.title ?? 'Untitled'} (${p.year ?? '?'}) — cites: ${p.citationCount ?? 0}${intents ? `\n**Intents:** ${intents}` : ''}`;
            });
            return {
                total: citations.length,
                markdown: `**${citations.length} citing papers.**\n\n${lines.join('\n')}${citations.length > 20 ? `\n\n…and ${citations.length - 20} more` : ''}`,
                citations,
            };
        },
        timeoutMs: 120_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'scholar_get_references',
        description: `List the papers a known paper cites (backward citations).`,
        parameters: { paperId: { type: 'string', description: 'Paper id', required: true }, maxResults: { type: 'integer', description: 'Result cap (default 100)' } },
        output: {
            schema: { type: 'object', properties: { total: { type: 'integer' }, markdown: { type: 'string' }, references: { type: 'array', items: { type: 'json' } } }, additionalProperties: true },
            render(_args, value) {
                return value.markdown ?? text(`${value.total ?? 0} references.`);
            },
        },
        async execute(args, exec) {
            const { s2: client } = runtimeOf(ctx, env, exec);
            const refs = await s2.getReferences(client, args.paperId, { maxResults: args.maxResults ?? 100 });
            return {
                total: refs.length,
                markdown: fmt.formatResults(refs.map((r) => r.citedPaper ?? r), 'References'),
                references: refs,
            };
        },
        timeoutMs: 120_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'scholar_get_recommendations',
        description: `Recommend papers similar to one or more seeds; negative seeds can steer away from unwanted topics.`,
        parameters: {
            positiveIds: { type: 'array', items: { type: 'string', description: 'Seed paper id' }, description: 'Seed papers (1+); recommendedPaperIds style ids or DOI:/ARXIV: forms', required: true },
            negativeIds: { type: 'array', items: { type: 'string', description: 'Seed paper id to steer away from' }, description: 'Optional negative seeds' },
            limit: { type: 'integer', description: 'Recommendation count (default 10, max 500)' },
        },
        output: {
            schema: { type: 'object', properties: { total: { type: 'integer' }, markdown: { type: 'string' }, papers: { type: 'array', items: { type: 'json' } } }, additionalProperties: true },
            render(_args, value) {
                return value.markdown ?? text(`${value.total ?? 0} recommendations.`);
            },
        },
        async execute(args, exec) {
            const { s2: client } = runtimeOf(ctx, env, exec);
            const papers = args.positiveIds.length === 1 && !args.negativeIds
                ? await s2.findSimilar(client, args.positiveIds[0], { limit: args.limit ?? 10 })
                : await s2.recommend(client, { positiveIds: args.positiveIds, negativeIds: args.negativeIds, limit: args.limit ?? 10 });
            return { total: papers.length, markdown: fmt.formatResults(papers, 'Recommendations'), papers };
        },
        timeoutMs: 120_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'scholar_search_authors',
        description: `Find researchers by name (affiliations, paper count, citations, h-index). Disambiguate common names by affiliation before using scholar_get_author.`,
        parameters: { query: { type: 'string', description: 'Author name', required: true }, maxResults: { type: 'integer', description: 'Result cap (default 20)' } },
        output: {
            schema: { type: 'object', properties: { total: { type: 'integer' }, markdown: { type: 'string' }, authors: { type: 'array', items: { type: 'json' } } }, additionalProperties: true },
            render(_args, value) {
                return value.markdown ?? text(`${value.total ?? 0} authors.`);
            },
        },
        async execute(args, exec) {
            const { s2: client } = runtimeOf(ctx, env, exec);
            const authors = await s2.searchAuthors(client, args.query, args.maxResults ?? 20);
            return { total: authors.length, markdown: fmt.formatAuthors(authors), authors };
        },
        timeoutMs: 120_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'scholar_get_author',
        description: `One author profile by authorId (affiliations, paper count, citations, h-index).`,
        parameters: { authorId: { type: 'string', description: 'Semantic Scholar authorId', required: true } },
        output: {
            schema: { type: 'object', properties: { authorId: { type: 'string' }, markdown: { type: 'string' }, author: { type: 'json' } }, additionalProperties: true },
            render(_args, value) {
                return value.markdown ?? text(`Author ${value.authorId ?? 'unknown'}.`);
            },
        },
        async execute(args, exec) {
            const { s2: client } = runtimeOf(ctx, env, exec);
            const author = await s2.getAuthor(client, args.authorId);
            const p = { ...author, affiliations: author.affiliations ?? [], paperCount: author.paperCount ?? 0 };
            return { authorId: args.authorId, markdown: fmt.formatAuthors([p]), author };
        },
        timeoutMs: 120_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'scholar_get_author_papers',
        description: `An author's publication list by authorId.`,
        parameters: { authorId: { type: 'string', description: 'Semantic Scholar authorId', required: true }, maxResults: { type: 'integer', description: 'Result cap (default 100)' } },
        output: {
            schema: { type: 'object', properties: { total: { type: 'integer' }, markdown: { type: 'string' }, papers: { type: 'array', items: { type: 'json' } } }, additionalProperties: true },
            render(_args, value) {
                return value.markdown ?? text(`${value.total ?? 0} papers.`);
            },
        },
        async execute(args, exec) {
            const { s2: client } = runtimeOf(ctx, env, exec);
            const papers = await s2.getAuthorPapers(client, args.authorId, args.maxResults ?? 100);
            return { total: papers.length, markdown: fmt.formatResults(papers, 'Author papers'), papers: fmt.compactPapers(papers) };
        },
        timeoutMs: 120_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'scholar_export_bibtex',
        description: `Export BibTeX entries for up to 500 papers (by paperId or DOI:...).`,
        parameters: { ids: { type: 'array', items: { type: 'string', description: 'paperId or DOI:id' }, description: 'Papers to export', required: true } },
        output: {
            schema: { type: 'object', properties: { count: { type: 'integer' }, bibtex: { type: 'string' } }, additionalProperties: true },
            render(_args, value) {
                return value.bibtex ? text(value.bibtex) : text('No BibTeX entries available.');
            },
        },
        async execute(args, exec) {
            const { s2: client } = runtimeOf(ctx, env, exec);
            const papers = await s2.batchPapers(client, args.ids.slice(0, 500), 'title,citationStyles');
            const bibtex = fmt.exportBibtex(papers);
            return { count: papers.length, bibtex };
        },
        timeoutMs: 120_000,
        isConcurrencySafe: () => false,
    }));
    // -------------------------------------------------------------------------
    // paper_fetch_* — acquisition
    // -------------------------------------------------------------------------
    const resolveParams = {
        doi: { type: 'string', description: 'DOI to resolve (e.g. 10.1038/s41586-021-03819-2)' },
        title: { type: 'string', description: 'Paper title; resolved to a DOI via Crossref -> Semantic Scholar before the chain runs' },
    };
    register(defineTool({
        name: 'paper_fetch_resolve',
        description: `Find the best open-access PDF URL for a paper WITHOUT downloading anything. Provide exactly one of doi or title. Reports the winning source (Unpaywall/Semantic Scholar/arXiv/Europe PMC/PMC/bioRxiv/publisher) and metadata.`,
        parameters: resolveParams,
        output: {
            schema: { type: 'object', properties: { doi: { type: 'string' }, markdown: { type: 'string' }, data: { type: 'json' } }, additionalProperties: true },
            render(_args, value) {
                return value.markdown ?? text(`Resolved ${value.doi ?? '?'}.`);
            },
        },
        async execute(args, exec) {
            const rt = runtimeOf(ctx, env, exec).fetch;
            let doi = args.doi;
            let resolution;
            if (!doi && args.title) {
                const r = await fetchSvc.resolveTitleToDoi(rt, args.title);
                doi = r.doi;
                resolution = r.resolution;
            }
            if (!doi) {
                return { doi: null, markdown: `Could not resolve "${args.title ?? args.doi ?? ''}" to a DOI. Use a longer/cleaner title or pass the DOI directly.`, data: { ok: false, resolution } };
            }
            const result = await fetchSvc.resolveOne(rt, doi);
            const sourceLine = result.success
                ? `**Source:** ${result.source}\n**PDF URL:** ${result.pdfUrl}\n**Title:** ${result.meta.title ?? '?'}\n${result.meta.year !== undefined ? `**Year:** ${result.meta.year}\n` : ''}`
                : `**Not found.** ${result.error?.message ?? ''}`;
            return {
                doi,
                markdown: `## Resolve ${doi}\n\n${sourceLine}${result.error?.suggest_institutional ? '\n\n> Tip: enable institutional mode in plugin settings if your institution subscribes.' : ''}`,
                data: { ok: result.success, ...(resolution ? { titleResolution: resolution } : {}), result },
            };
        },
        timeoutMs: 180_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'paper_fetch_download',
        description: `Resolve a paper (doi or title) to its best open-access PDF, download it into the configured library directory (default scholar-pdfs), and report the saved file path. Skips existing files unless overwrite.`,
        parameters: {
            doi: { type: 'string', description: 'DOI to download' },
            title: { type: 'string', description: 'Paper title; resolved to a DOI first' },
            overwrite: { type: 'boolean', description: 'Re-download even if the destination file exists' },
        },
        output: {
            schema: { type: 'object', properties: { ok: { type: 'boolean' }, markdown: { type: 'string' }, data: { type: 'json' } }, additionalProperties: true },
            render(_args, value) {
                return value.markdown ?? text(`Fetch finished (ok=${String(value.ok)}).`);
            },
        },
        async execute(args, exec) {
            const rt = runtimeOf(ctx, env, exec).fetch;
            let doi = args.doi;
            let resolution;
            if (!doi && args.title) {
                const r = await fetchSvc.resolveTitleToDoi(rt, args.title);
                doi = r.doi;
                resolution = r.resolution;
            }
            if (!doi) {
                return { ok: false, markdown: `Could not resolve "${args.title ?? ''}" to a DOI.`, data: { ok: false, resolution } };
            }
            const result = await fetchSvc.fetchOne(rt, doi, { overwrite: args.overwrite });
            const err = result.error;
            const statusLine = result.success
                ? result.skipped
                    ? `**Skipped** (already downloaded): ${result.file}`
                    : `**Downloaded** from ${result.source}:\n- file: \`${result.file}\`\n- url: ${result.pdfUrl}`
                : `**Failed** [${err?.code}]: ${err?.message}${err?.retry_after_hours ? ` (retry after ~${err.retry_after_hours}h)` : ''}`;
            return {
                ok: result.success,
                markdown: `## Fetch ${doi}\n\n${statusLine}`,
                data: { ...(resolution ? { titleResolution: resolution } : {}), result },
            };
        },
        timeoutMs: 300_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'paper_fetch_batch',
        description: `Fetch many papers by DOI (or a mix of dois/titles). Returns one envelope with per-item results, a summary, and retry hints for the failed subset. Use idempotencyKey to replay the exact envelope on re-run without re-downloading.`,
        parameters: {
            dois: { type: 'array', items: { type: 'string', description: 'DOI' }, description: 'DOIs to fetch (exactly one input of dois or titles)' },
            titles: { type: 'array', items: { type: 'string', description: 'Paper title to resolve first' }, description: 'Titles to resolve + fetch' },
            idempotencyKey: { type: 'string', description: 'Stable key; re-running with the same key replays the previous envelope instantly' },
            overwrite: { type: 'boolean', description: 'Re-download existing files' },
        },
        output: {
            schema: { type: 'object', properties: { ok: { type: 'boolean' }, markdown: { type: 'string' }, data: { type: 'json' } }, additionalProperties: true },
            render(_args, value) {
                return value.markdown ?? text(`Batch finished (ok=${String(value.ok)}).`);
            },
        },
        async execute(args, exec) {
            const rt = runtimeOf(ctx, env, exec).fetch;
            if (!args.dois?.length && !args.titles?.length) {
                return { ok: false, markdown: 'paper_fetch_batch needs `dois` or `titles`.', data: { ok: false } };
            }
            const dois = [...(args.dois ?? [])];
            if (args.titles?.length) {
                for (const title of args.titles) {
                    const r = await fetchSvc.resolveTitleToDoi(rt, title);
                    if (r.doi)
                        dois.push(r.doi);
                }
            }
            const envelope = await fetchSvc.fetchBatch(rt, dois, { overwrite: args.overwrite, idempotencyKey: args.idempotencyKey });
            const summary = envelope.data?.summary ?? {};
            const lines = (envelope.data?.results ?? []).map((r) => r.success ? `- ✅ ${r.doi} → ${r.file ?? r.pdfUrl}` : `- ❌ ${r.doi} [${r.error?.code ?? 'error'}]${r.error?.retry_after_hours ? ` (retry ~${r.error.retry_after_hours}h)` : ''}`);
            const next = (envelope.data?.next ?? []);
            const markdown = `## Batch fetch: ${summary.succeeded}/${summary.total} succeeded\n\n${lines.join('\n')}${next.length ? `\n\n**Retry hints:**\n\`\`\`\n${next.join('\n')}\n\`\`\`` : ''}`;
            return { ok: envelope.ok, markdown, data: envelope };
        },
        timeoutMs: 600_000,
        isConcurrencySafe: () => false,
    }));
    register(defineTool({
        name: 'paper_fetch_library',
        description: `List PDFs already downloaded into the configured library directory (default scholar-pdfs).`,
        parameters: {},
        output: {
            schema: { type: 'object', properties: { total: { type: 'integer' }, markdown: { type: 'string' }, files: { type: 'array', items: { type: 'json' } } }, additionalProperties: true },
            render(_args, value) {
                return value.markdown ?? text(`${value.total ?? 0} PDFs in the library.`);
            },
        },
        async execute(_args, exec) {
            const rt = runtimeOf(ctx, env, exec).fetch;
            const files = await fetchSvc.listLibrary(rt);
            const markdown = files.length
                ? `**${files.length} PDF(s) in ${rt.settings.pdfOutputDir}:**\n\n${files.map((f) => `- \`${f.file}\``).join('\n')}`
                : `No PDFs in ${rt.settings.pdfOutputDir} yet.`;
            return { total: files.length, markdown, files };
        },
        isConcurrencySafe: () => false,
    }));
    return () => {
        for (const dispose of disposers)
            dispose();
    };
}
function pickFilters(args) {
    const f = {};
    for (const key of ['year', 'publicationDate', 'venue', 'fieldsOfStudy', 'publicationTypes']) {
        const v = args[key];
        if (typeof v === 'string' && v)
            f[key] = v;
    }
    const minC = args.minCitationCount;
    if (typeof minC === 'number' && Number.isFinite(minC))
        f.minCitationCount = minC;
    if (args.openAccess === true)
        f.openAccess = true;
    return f;
}
//# sourceMappingURL=register.js.map