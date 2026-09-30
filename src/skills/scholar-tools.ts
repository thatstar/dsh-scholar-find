/**
 * scholar-tools skill: cross-tool policy for the 30 dsh-scholar-find tools —
 * the Shared behavior rulebook plus a routing map. Per-call parameter
 * semantics live in the tool descriptions/schemas (the single source); the
 * workflows live in their own skills, so this file holds no recipes.
 */

export const SCHOLAR_TOOLS_SKILL = {
  name: 'scholar-tools',
  description:
    'Cross-tool policy for the 30 dsh-scholar-find tools: the Shared behavior rulebook (error envelope, library paths, DOI hygiene, content chain, pacing) plus a routing map for the look-alike tools. Load when tool choice or error recovery matters.',
  whenToUse:
    'Any scholarly task where tool choice or recovery matters: routing between look-alike tools, error envelopes, rate limits, caps and the content chain.',
  source: 'runtime',
  content: `# Scholar tools — cross-tool policy (dsh-scholar-find)

Cross-tool policy for the 30 dsh-scholar-find tools. Every call's parameters
and caveats come from the tool's own description/schema (authoritative, always
present); the pipelines and output contracts live in the five workflow skills.
This skill carries only what no single tool owns: the Shared behavior rules and
the routing between look-alike tools.

## Shared behavior (cross-tool)

These rules apply to every scholar tool and belong to no single one; the
resident system-prompt section points here.

- Error envelope (all tools): errors carry \`code\`, \`retryable\`, \`retry_after_hours\`.
  - Non-retryable: \`validation_error\`, \`download_not_a_pdf\`, \`download_host_not_allowed\`, \`not_found\`, \`title_mismatch\`, \`source_title_conflict\`, \`content_not_found\`.
  - Retryable: all \`*_network_error\`, \`content_fetch_failed\`, \`rate_limited\`, \`server_error\`.
  - A transport error is not "paper not found"; back off on a rate limit rather than rephrasing the query.
  - An S2 upstream 429/5xx surfaces as \`[rate_limited|retryable|retry_after_hours=1]\` / \`[server_error|retryable]\` after its internal retries.
  - Sciverse is typed the same way (502/429 already retried client-side); \`content_not_found\` means that doc_id has no stored text — take another doc_id, not another retry.
- Library directory: all outputs under the library directory (\`defaultOutputDir\`, default \`.scholar/\`) with \`pdfs/\`, \`md/\`, \`html/\`, \`figs/\`, \`idem/\`, \`cards/\` subdirs; report returned paths verbatim.
- Configuration: \`unpaywallEmail\`, the Asta key and the Sciverse token live on the Web UI's Plugins page (\`dsh-scholar-find\`); when a tool reports one missing, say where to set it.
- Discovery triage: every search hit carries venue, field-of-study and open-access evidence; a narrow query's hits with no shared term are flagged \`offTopic\` (kept, not dropped — pass \`strictTopic: true\` to drop them). Triage on that evidence before carding.
- DOI hygiene: use the user's DOI directly; resolve titles via \`scholar_match_title\` or \`paper_fetch_resolve\`; never invent a DOI; pass DOIs, not titles, to download and batch. An identifier taken from a list/table is UNVERIFIED — confirm it with \`scholar_get_paper\` (pass \`expectedTitle\`) before writing it into a card or citation; a \`titleCheck\` mismatch means that id resolves to a different work.
- Content chain — ranked, fall through on failure:
  1. \`arxiv_get_fulltext\` — an arXiv work's own HTML.
  2. \`scholar_get_paper_snippets\` — Asta body text for a known paper.
  3. \`sciverse_read_content\` — in-platform passages; walk \`alt_doc_ids\` from \`sciverse_semantic_search\`'s \`doc_id_index\` when a doc_id has no stored text.
  4. \`paper_pdf2md\` — a single arbitrary PDF, only when a file is wanted.
  - \`paper_fetch_download\`/\`batch\` only when the PDF itself is wanted. Never download or extract speculatively.
  - \`sciverse_read_content\` always sends an explicit \`offset\` (default 0) — an omitted offset returns the whole document; page with \`next_offset\`, never with the returned character count.
- Sciverse scoping: \`sciverse_search_papers\` (metadata, capped counts) pins candidates → \`sciverse_semantic_search\` retrieves passages, and its \`filters.doc_id\` is the only HARD scope (≤1000 ids); the other filter fields are soft/approximate (missing metadata is not excluded).
- Coverage verdicts: citation/reference lists carry \`coverage\` (complete/truncated/partial/not_indexed/empty) — never present a partial list as a total.
- Pacing: Sciverse ~30 requests/minute per endpoint, back off on 429; keep \`top_k\` and \`page_size\` modest. \`paper_pdf2md\` is IP rate-limited.
- Exports: offer \`scholar_export_bibtex\` when the user collects references.

## Routing (which tool for which job)

Each tool's own description/schema is the authoritative per-call reference — this is
the cross-tool choice, including the look-alike pairs:

- **Discovery.** \`scholar_search_papers\` = Semantic Scholar corpus (ranked, boolean + filters). \`sciverse_search_papers\` = Sciverse corpus (structured screening: year/venue/subject/OA; capped counts) — call \`sciverse_list_catalog\` first when a field name or operator is uncertain. \`scholar_search_papers_by_snippet\` = papers containing a quoted passage; \`scholar_get_paper_snippets\` = ~500-word body text of ONE known paper (needs the Asta key). \`scholar_match_title\` → \`scholar_get_paper\` = title/DOI resolution plus the identity check.
- **Reading.** Ranked chain in Shared behavior: \`arxiv_get_fulltext\` → \`scholar_get_paper_snippets\` → \`sciverse_semantic_search\` + \`sciverse_read_content\` (in-platform passages) → \`paper_pdf2md\` for an arbitrary PDF. \`sciverse_get_resource\` fetches a figure/table referenced by a read.
- **Citations.** \`scholar_get_citations\` / \`scholar_get_references\` = one-hop S2 graph with a coverage verdict (Sciverse fallback when S2 has nothing); \`sciverse_list_paper_relations\` = deep paging of one paper's own relation list.
- **Authors.** \`scholar_search_authors\` → \`scholar_get_author\` → \`scholar_get_author_papers\`; for author/source metrics in the Sciverse corpus use \`sciverse_search_papers\` with \`collection\`.
- **Similar work.** \`scholar_get_recommendations\` — seeds beat keywords.
- **Acquisition.** \`paper_fetch_resolve\` (link only) → \`paper_fetch_download\` (one PDF) → \`paper_fetch_batch\` (many, resumable); \`paper_fetch_library\` and \`scholar_list_library\` show what already exists.
- **Writing.** \`scholar_format_references\` = styled, footnote-ready list; \`scholar_export_bibtex\` = raw BibTeX.
- **Memory.** \`scholar_card_save\` = the card of ONE investigated paper (write it at read time); \`scholar_card_list\` = recall the library before a report.
- **Aggregates.** \`sciverse_trend_scan\` = per-year counts / top-cited / venues; \`sciverse_evidence_pack\` = per-claim verbatim quotes.
`,
}
