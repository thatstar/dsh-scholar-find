/**
 * scholar-tools skill: the per-tool behavioral catalog for all 27
 * dsh-scholar-find tools — selection, behavior, recovery. Workflows live in
 * their own skills; this file holds no recipes.
 */

export const SCHOLAR_TOOLS_SKILL = {
  name: 'scholar-tools',
  description:
    'Per-tool behavioral catalog for all 27 dsh-scholar-find tools: Limitations / Exceptions / Prefer-when for every search, fetch, arXiv, and sciverse tool. Load when tool choice, call behavior, or error recovery matters.',
  whenToUse:
    'Any scholarly task where per-tool behavioral detail is needed: choosing between overlapping tools, error recovery, rate-limit or cap semantics.',
  content: `# Scholar tool catalog (dsh-scholar-find)

Per-tool behavioral catalog for all 27 dsh-scholar-find tools: selection,
behavior, recovery. Construct every call from the tool's own parameter
schema. Cross-tool rules (error envelope, library directory, configuration,
DOI hygiene, content chain, pacing) stay in the system prompt's Shared
behavior. Workflow pipelines and their output contracts live in the five
scholar-* workflow skills.

## scholar_search_* — Semantic Scholar discovery and graph

- scholar_search_papers: ranked paper search with filters; the default discovery tool.
  - Limitations: bulk plus filters beats many broad calls; abstracts/TLDR only on request.
  - Exceptions: envelope errors (see Shared behavior); empty result is not an API failure — broaden the query before retrying.
  - Prefer when: the user names a topic or asks for literature with year/venue/citation filters.
- scholar_search_papers_by_snippet: full-text passage search returning the matching snippet per paper.
  - Limitations: full-text index coverage; snippet search, not metadata search.
  - Exceptions: envelope errors; empty result means the index lacks that passage.
  - Prefer when: the user quotes or paraphrases a specific method or sentence and wants the papers containing it.
- scholar_match_title: exact title to paperId/DOI/metadata resolution.
  - Limitations: exact matching; near-duplicates possible — verify the returned title.
  - Exceptions: no confident match — ask the user for the DOI instead of guessing.
  - Prefer when: an exact title needs its DOI/paperId before other calls.
- scholar_get_paper: one paper by ID (DOI:/ARXIV:/PMID:/PMCID:/CorpusId: forms).
  - Limitations: one paper per call; prefix required.
  - Exceptions: not_found means wrong ID or not indexed; verify the prefix form.
  - Prefer when: a DOI or arXiv id is already in hand and metadata is needed.
- scholar_get_paper_snippets: ~500-word full-text snippets from the Ai2 Asta corpus.
  - Limitations: requires the Asta API key; corpus coverage varies by paper.
  - Exceptions: unconfigured key — direct the user to Settings → Plugins → Plugin configuration.
  - Prefer when: a specific passage from one known paper is needed and the key is configured.
- scholar_get_citations: papers citing a known paper, with intent labels.
  - Limitations: S2 graph coverage; one hop per call.
  - Exceptions: envelope errors; empty results are normal for very new papers.
  - Prefer when: who-cites-X or citation-context questions on S2-indexed papers.
- scholar_get_references: papers a known paper cites (backward edges).
  - Limitations: one hop; no intent labels.
  - Exceptions: envelope errors.
  - Prefer when: what-does-X-cite questions or building a related-work pool.
- scholar_get_recommendations: similar-paper recommendations from seed papers.
  - Limitations: quality depends on seed specificity.
  - Exceptions: envelope errors; irrelevant output calls for better seeds, not more calls.
  - Prefer when: find-papers-similar-to-X requests — more precise than keyword search.
- scholar_search_authors: author search by name.
  - Limitations: common names are ambiguous.
  - Exceptions: multiple plausible hits — disambiguate by affiliation before scholar_get_author.
  - Prefer when: the user names a researcher rather than a paper.
- scholar_get_author: one author profile by authorId.
  - Limitations: one author per call.
  - Exceptions: wrong authorId shows as a profile mismatch — re-disambiguate.
  - Prefer when: affiliations, paper count, citations, or h-index of a resolved author are asked.
- scholar_get_author_papers: one author's publication list.
  - Limitations: long lists for prolific authors — filter after the call.
  - Exceptions: envelope errors.
  - Prefer when: list-X's-papers requests or scanning an author's output for a topic.
- scholar_export_bibtex: BibTeX export for up to 500 papers.
  - Limitations: export only; no metadata enrichment.
  - Exceptions: invalid ids are reported per-item.
  - Prefer when: the user collects references — offer it at the end of a search task.

## paper_fetch_* — OA PDF acquisition and conversion

- paper_fetch_resolve: best OA PDF URL for a DOI or title, writing no files.
  - Limitations: OA sources only (Unpaywall, S2, arXiv, PMC, bioRxiv); no paywalled copies.
  - Exceptions: not_found means no OA copy right now — not retryable; transport errors are transient.
  - Prefer when: only the PDF URL or link is wanted — the cheap option.
- paper_fetch_download: resolve and save one PDF into the library (pdfs/).
  - Limitations: slow (network plus checks); runs only on explicit user request.
  - Exceptions: not_found / download_not_a_pdf / download_host_not_allowed are non-retryable — report, do not loop.
  - Prefer when: the user explicitly wants the PDF file itself.
- paper_fetch_batch: many DOIs or titles in one resumable envelope.
  - Limitations: slow; per-item results; needs unpaywallEmail for the Unpaywall source.
  - Exceptions: one failed item does not discard the batch; retry hints arrive in next; re-call with the same key to resume.
  - Prefer when: the user explicitly wants several PDFs at once.
- paper_fetch_library: list PDFs already in the library (pdfs/).
  - Limitations: pdfs/ only — use scholar_list_library for everything.
  - Exceptions: an empty list is normal before any download.
  - Prefer when: checking whether a PDF is already downloaded before fetching again.
- paper_pdf2md: one PDF (URL or local path) to Markdown via MinerU.
  - Limitations: 10 MB cap (server-side); IP rate-limited; no API key.
  - Exceptions: oversize or parse failures arrive as error codes — split the source or fall back to sciverse slices.
  - Prefer when: the user wants full Markdown of one non-arXiv PDF.
- scholar_list_library: everything produced under the output dir, grouped by subdir.
  - Limitations: lists files only; no content preview.
  - Exceptions: empty subdirs are normal.
  - Prefer when: resuming work or reporting produced artifacts and paths.

## arxiv_* — official arXiv HTML full text

- arxiv_get_fulltext: one arXiv paper's own HTML rendering as Markdown or article-scoped HTML.
  - Limitations: arXiv-only; HTML is experimental — a subset of papers have none.
  - Exceptions: available:false (404) — fall back to paper_fetch_* or sciverse_*; figures land in figs/ with paths returned.
  - Prefer when: content of an arXiv paper is wanted — first choice over PDF-to-Markdown.

## sciverse_* — Sciverse Open Platform retrieval

- sciverse_list_catalog: discover searchable fields and enum values for a collection.
  - Limitations: metadata discovery only.
  - Exceptions: unknown field names — re-check the catalog before filtering.
  - Prefer when: unsure which sciverse_search_papers field or filter to use.
- sciverse_search_papers: structured metadata search with field filters and pagination.
  - Limitations: hit totals cap at 10000 when the matched set is larger.
  - Exceptions: cap reached — narrow with field filters, not year filters; precise counting goes through sciverse_trend_scan or boolean scholar_search_papers.
  - Prefer when: structured screening (year, type, venue) or top-cited lists are wanted.
- sciverse_semantic_search: natural-language RAG over passage chunks.
  - Limitations: chunk-based, not full documents; scores matter for thresholds.
  - Exceptions: low-score hits — keep score ≥ 0.6 for evidence use; extend context via sciverse_read_content.
  - Prefer when: a question should be answered with quoted evidence passages.
- sciverse_list_paper_relations: paginated CITATIONS / REFERENCES / RELATED_WORKS for one paper.
  - Limitations: relations above 10000 return 429 on this endpoint.
  - Exceptions: 429 — switch to the references_unique_id filter in sciverse_search_papers.
  - Prefer when: deep pagination through one paper's citation relations is needed.
- sciverse_read_content: character-range slice of a paper's full text by doc_id.
  - Limitations: slices only — compose multiple reads for long spans.
  - Exceptions: never guess offsets — re-read from the returned next_offset.
  - Prefer when: verifying or reading around a passage found by sciverse_semantic_search.
- sciverse_get_resource: fetch one figure or table image by file name; saves to disk.
  - Limitations: returns a saved path, never base64; refuses non-image bytes.
  - Exceptions: validation failure means the file was not an image — recheck the alt text.
  - Prefer when: the user wants a specific figure or table from a sciverse-indexed paper.
- sciverse_trend_scan: per-year counts, top-cited papers, and venues for a topic in one call.
  - Limitations: sciverse counts are exact only below the 10000 cap; s2 mode needs no topic.
  - Exceptions: topic_ambiguous — ask the user with the returned top-5 candidate topics, then re-run with topic_id.
  - Prefer when: field trends, hotness, or per-year publication counts are asked.
- sciverse_evidence_pack: verifiable per-claim citation packs (semantic hit plus full-text quote check).
  - Limitations: at most 5 claims — batch large drafts into several calls; quotes are verbatim, never rewritten.
  - Exceptions: unverified items stay marked unverified — report them as such.
  - Prefer when: grounding a draft or answer with checkable quotes.`,
}
