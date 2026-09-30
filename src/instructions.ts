/**
 * Companion instructions for the scholar tools.
 *
 * The RESIDENT section is one sentence (`SCHOLAR_INSTRUCTIONS`): a pointer to
 * the tool families and to the `scholar-*` skill catalog. Everything else —
 * the cross-tool Shared behavior and the per-tool catalog — lives in the
 * on-demand skills (see ./skills/), so a scholarly session pays for the detail
 * only when it loads it, and every other session pays 456 chars ≈ 120 tokens
 * (it replaced a 6,458-char ≈ 1,700-token section).
 *
 * `SCHOLAR_INSTRUCTIONS_FALLBACK` is the complete behavioral floor, rendered
 * ONLY when the profile has no `skills` service (nothing to load, so the
 * rules must stay resident or the plugin would ship guidance-free). The
 * section is registered as a provider function so the choice is made per
 * assembly; see src/index.ts.
 * @module dsh-scholar-find/instructions
 */

/** The resident section: one sentence, always injected. */
export const SCHOLAR_INSTRUCTIONS = 'dsh-scholar-find ships the `scholar_search_*` / `scholar_format_*` / `paper_fetch_*` / `arxiv_*` / `sciverse_*` tools; their schemas are authoritative. Before treating a scholarly task as a plain search, call the `skill` tool for the matching `scholar-*` entry — that is where every scholarly rule lives (cross-tool error envelope, DOI verification, content chain, pacing, and each workflow pipeline), since the tool definitions describe single calls only.'

/**
 * The resident fallback: the full cross-tool rulebook plus the skill routing
 * map, rendered only when this profile exposes no `skills` service. Never
 * injected when the skills are available — the same rules live in the
 * `scholar-tools` skill.
 */
export const SCHOLAR_INSTRUCTIONS_FALLBACK = `# Scholar tools (dsh-scholar-find)

Academic paper research tools in five families. Build every call from each tool's own parameter schema — the authoritative, always-present source; this section covers tool selection and behavior only. Deeper layers load on demand via the \`skill\` tool when the profile has one: \`scholar-tools\` carries the cross-tool Shared behavior rulebook plus a routing map over the 28 tools (per-call semantics live in each tool's own description/schema); five workflow skills carry pipeline recipes and output contracts — \`scholar-literature-review\` (survey / state of a field), \`scholar-scientific-rag\` (question answered with quoted evidence), \`scholar-systematic-screen\` (PRISMA-style include/exclude), \`scholar-evidence-pack\` (verifiable per-claim citation packs), \`scholar-trend-scan\` (per-year counts, top-cited, venues); \`scholar-memory\` maintains the persistent DOI card library (\`cards/\` under the output dir) that tracks investigated papers into final reports; and \`scholar-citation-style\` is the citation/bibliography contract (footnote markers, definition layout and numbering, GB/T 7714-2015 / APA / IEEE entry templates) — load it before writing any report with a reference list. Call the matching skill before composing the pipeline, or whenever a tool's behavioral details matter.

## scholar_search_* — Semantic Scholar discovery and graph

- scholar_search_papers: ranked paper search with filters; the default discovery tool.
- scholar_search_papers_by_snippet: full-text passage search returning the matching snippet per paper.
- scholar_match_title: exact title to paperId/DOI/metadata resolution.
- scholar_get_paper: one paper by ID (DOI:/ARXIV:/PMID:/PMCID:/CorpusId: forms).
- scholar_get_paper_snippets: ~500-word full-text snippets from the Ai2 Asta corpus.
- scholar_get_citations: papers citing a known paper, with intent labels.
- scholar_get_references: papers a known paper cites (backward edges).
- scholar_get_recommendations: similar-paper recommendations from seed papers.
- scholar_search_authors: author search by name.
- scholar_get_author: one author profile by authorId.
- scholar_get_author_papers: one author's publication list.
- scholar_export_bibtex: BibTeX export for up to 500 papers.

## paper_fetch_* — OA PDF acquisition and conversion

- paper_fetch_resolve: best OA PDF URL for a DOI or title, writing no files.
- paper_fetch_download: resolve and save one PDF into the library (pdfs/).
- paper_fetch_batch: many DOIs or titles in one resumable envelope.
- paper_fetch_library: list PDFs already in the library (pdfs/).
- paper_pdf2md: one PDF (URL or local path) to Markdown via MinerU.
- scholar_list_library: everything produced under the output dir, grouped by subdir.

## arxiv_* — official arXiv HTML full text

- arxiv_get_fulltext: one arXiv paper's own HTML rendering as Markdown or article-scoped HTML.

## sciverse_* — Sciverse Open Platform retrieval

- sciverse_list_catalog: discover searchable fields and enum values for a collection.
- sciverse_search_papers: structured metadata search with field filters and pagination.
- sciverse_semantic_search: natural-language RAG over passage chunks.
- sciverse_list_paper_relations: paginated CITATIONS / REFERENCES / RELATED_WORKS for one paper.
- sciverse_read_content: character-range slice of a paper's full text by doc_id.
- sciverse_get_resource: fetch one figure or table image by file name; saves to disk.
- sciverse_trend_scan: per-year counts, top-cited papers, and venues for a topic in one call.
- sciverse_evidence_pack: verifiable per-claim citation packs (semantic hit plus full-text quote check).

## scholar_format_* — reference formatting (citation contract)

- scholar_format_references: format a reference list in one declared style (GB/T 7714-2015 / APA 7 / IEEE / Nature / BibTeX) and return footnote-ready \`[^n]:\` definitions numbered by first-reference order.

## Shared behavior (cross-tool)

- Error envelope (all tools): errors carry \`code\`, \`retryable\`, and \`retry_after_hours\`. Non-retryable: \`validation_error\`, \`download_not_a_pdf\`, \`download_host_not_allowed\`, \`not_found\`, \`title_mismatch\`, \`source_title_conflict\`, \`content_not_found\`. Retryable: all \`*_network_error\`, \`content_fetch_failed\`, \`rate_limited\`, \`server_error\`. A transport error is not "paper not found". An S2 upstream 429/5xx surfaces as a tagged \`[rate_limited|retryable|retry_after_hours=1]\` / \`[server_error|retryable]\` error after its internal retries — back off, do not treat it as a query error. Sciverse failures are typed the same way (502/429 already retried client-side); \`content_not_found\` means that doc_id has no stored text — take another doc_id, not another retry.
- Library directory: all outputs under the library directory (\`defaultOutputDir\`, default \`.scholar/\`) with \`pdfs/\`, \`md/\`, \`html/\`, \`figs/\`, \`idem/\`, \`cards/\` subdirs; report returned paths verbatim.
- Configuration: \`unpaywallEmail\`, the Asta key, and the Sciverse token live on the Web UI's Plugins page (the \`dsh-scholar-find\` plugin's own configuration); when a tool reports one missing, tell the user to set it there.
- Discovery triage: every search hit carries venue, field-of-study and open-access evidence; a narrow query's hits with no shared term are flagged \`offTopic\` (kept, not dropped — pass \`strictTopic: true\` to drop them). Triage on that evidence before carding.
- DOI hygiene: use the user's DOI directly; resolve titles via \`scholar_match_title\` or \`paper_fetch_resolve\`; never invent a DOI; pass DOIs, not titles, to download and batch. An identifier taken from a list/table is UNVERIFIED — confirm it with \`scholar_get_paper\` (pass \`expectedTitle\`) before writing it into a card or citation; a \`titleCheck\` mismatch means that id resolves to a different work.
- Content chain (ranked, fall through on failure): \`arxiv_get_fulltext\` for arXiv works → \`scholar_get_paper_snippets\` (Asta body text for a known paper) → \`sciverse_read_content\` for in-platform passages, walking \`alt_doc_ids\` from \`sciverse_semantic_search\`'s \`doc_id_index\` when a doc_id has no stored text → \`paper_pdf2md\` for a single arbitrary PDF only if a file is wanted; \`paper_fetch_download\`/\`batch\` only if the PDF file itself is wanted. Never download or extract speculatively. \`sciverse_read_content\` always sends an explicit \`offset\` (default 0) — an omitted offset makes the API return the whole document.
- Sciverse scoping: \`sciverse_search_papers\` (metadata) pins candidates → \`sciverse_semantic_search\` retrieves passages, and its \`filters.doc_id\` is the only HARD scope (≤1000 ids); the other filter fields are soft/approximate.
- Coverage verdicts: citation/reference lists carry \`coverage\` (complete/truncated/partial/not_indexed/empty) — never present a partial list as a total.
- Pacing: Sciverse ~30 requests/minute per endpoint, back off on 429; keep \`top_k\` and \`page_size\` modest. \`paper_pdf2md\` is IP rate-limited.
- Exports: offer \`scholar_export_bibtex\` when the user collects references.`
