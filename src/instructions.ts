/**
 * Resident companion instructions for the scholar tools — the slim
 * always-present core (variant C): one line per tool plus cross-tool Shared
 * behavior, and the routing map to the on-demand skills. The per-tool
 * behavioral catalog lives in the scholar-tools skill; each workflow has its
 * own skill (see ./skills/). Guidance only — the model composes the pipeline
 * per the user's goal.
 * @module dsh-scholar-find/instructions
 */

export const SCHOLAR_INSTRUCTIONS = `# Scholar tools (dsh-scholar-find)

Academic paper research tools in four families. Build every call from each tool's own parameter schema — the authoritative, always-present source; this section covers tool selection and behavior only. Deeper layers load on demand via the \`skill\` tool: \`scholar-tools\` carries the per-tool behavioral catalog (Limitations / Exceptions / Prefer-when for all 27 tools), and five workflow skills carry pipeline recipes and output contracts — \`scholar-literature-review\` (survey / state of a field), \`scholar-scientific-rag\` (question answered with quoted evidence), \`scholar-systematic-screen\` (PRISMA-style include/exclude), \`scholar-evidence-pack\` (verifiable per-claim citation packs), \`scholar-trend-scan\` (per-year counts, top-cited, venues). Call the matching skill before composing the pipeline, or whenever a tool's behavioral details matter.

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

## Shared behavior (cross-tool)

- Error envelope (all tools): errors carry \`code\`, \`retryable\`, and \`retry_after_hours\`. Non-retryable: \`validation_error\`, \`download_not_a_pdf\`, \`download_host_not_allowed\`, \`not_found\`. Retryable: all \`*_network_error\`. A transport error is not "paper not found".
- Library directory: all outputs under the library directory (\`defaultOutputDir\`, default \`.scholar/\`) with \`pdfs/\`, \`md/\`, \`html/\`, \`figs/\`, \`idem/\` subdirs; report returned paths verbatim.
- Configuration: \`unpaywallEmail\`, the Asta key, and the Sciverse token live in Settings → Plugins → Plugin configuration; when a tool reports one missing, tell the user to set it there.
- DOI hygiene: use the user's DOI directly; resolve titles via \`scholar_match_title\` or \`paper_fetch_resolve\`; never invent a DOI; pass DOIs, not titles, to download and batch.
- Content chain (ranked): \`arxiv_get_fulltext\` for arXiv papers; sciverse content tools for in-platform passages and figures; \`paper_pdf2md\` for a single arbitrary PDF only if a file is wanted; \`paper_fetch_download\`/\`batch\` only if the PDF file itself is wanted. Never download or extract speculatively.
- Pacing: Sciverse ~30 requests/minute per endpoint, back off on 429; keep \`top_k\` and \`page_size\` modest. \`paper_pdf2md\` is IP rate-limited.
- Exports: offer \`scholar_export_bibtex\` when the user collects references.`
