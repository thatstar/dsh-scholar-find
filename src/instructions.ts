/**
 * Companion instructions for the scholar tools, registered as a system-prompt
 * section by the plugin so the model knows when and how to use each tool
 * family. Guidance only — the model composes the pipeline per the user's goal.
 * @module dsh-scholar-find/instructions
 */

export const SCHOLAR_INSTRUCTIONS = `# Scholar tools (dsh-scholar-find)

Four tool families are available for academic paper research:

- \`scholar_search_*\` — discover and inspect papers through Semantic Scholar:
  ranked search with filters and boolean queries, exact title match, paper
  lookup, citations and references (with intent labels), recommendations,
  author profiles, and BibTeX export. \`scholar_get_paper_snippets\` retrieves
  ~500-word full-text content snippets from the Ai2 Asta corpus (the Semantic
  Scholar owner's full-text index, not exposed by the public S2 API).
- \`paper_fetch_*\` — obtain PDFs: \`paper_fetch_resolve\` finds the best
  open-access PDF URL for a DOI or title WITHOUT writing files;
  \`paper_fetch_download\` resolves and saves the PDF into the configured
  library directory; \`paper_fetch_batch\` downloads many DOIs with a
  resumable envelope; \`paper_pdf2md\` converts a single PDF (an https:// PDF
  URL or a local file path) to Markdown full text via the MinerU lightweight
  parse API and saves the .md into the library directory. \`scholar_list_library\`
  lists everything produced under the default output dir (PDFs, Markdown,
  figures), grouped by subdirectory.
- \`sciverse_*\` — Sciverse Open Platform content retrieval: structured paper
  search (\`sciverse_search_papers\`), natural-language semantic search with
  RAG passage chunks (\`sciverse_semantic_search\`), field catalog
  (\`sciverse_list_catalog\`), citation relations (\`sciverse_list_paper_relations\`),
  full-text slices (\`sciverse_read_content\`), and figures/tables
  (\`sciverse_get_resource\`, which validates the bytes are a real image and, by
  default, saves them into the session workspace — it returns the saved \`path\`,
  never the full base64 inline). \`sciverse_read_content\` surfaces each figure's
  \`alt\` caption alongside its \`file_name\`; pass that caption (and the paper
  identity via the \`paper\` argument) to \`sciverse_get_resource\` so the saved
  figure is self-describing (e.g. \`10.1038_xxx_Fig_2_Caption_architecture.png\`).
  Two workflow tools run multi-call pipelines in one call:
  \`sciverse_trend_scan\` (per-year paper counts + top-cited papers + venues for
  a topic — \`source:"s2"\` default: Semantic Scholar counts/citations, real
  values; \`source:"sciverse"\`: OpenAlex-topic-scoped Sciverse meta-search
  with exact counts for topics < 10000/yr) and
  \`sciverse_evidence_pack\` (verifiable per-claim citation packs,
  quote verified against the full text). One Bearer token (\`sciverseApiKeyRef\`).
- \`arxiv_*\` — official arXiv HTML full text: \`arxiv_get_fulltext\` fetches
  \`https://arxiv.org/html/<id>\` (arXiv's own HTML rendering of the paper,
  "experimental" — some papers have no HTML version and it reports
  \`available:false\`). Returns Markdown by default (math as LaTeX \`$...$\`;
  \`md:false\` gives article-scoped raw HTML); \`save:true\` (default) writes
  \`.scholar/md/<id>.md\` or \`.scholar/html/<id>.html\` and returns the path,
  \`save:false\` returns the full content inline (cap with \`maxChars\`). No API
  key needed; fetched through the configured proxy.

Usage rules:

1. Compose the pipeline per the user's goal — search first when the user
   names a topic, fetch directly when they already have DOIs. Never invent a
   DOI: use \`scholar_match_title\` or \`paper_fetch_resolve\` (title) to
   resolve one. **Prefer a DOI when the user has one** — title→DOI resolution
   (Crossref → Semantic Scholar) is fuzzy: it can fail or match a *different*
   paper. If a title won't resolve confidently, ask the user for the DOI
   instead of guessing.
2. PDF downloads and Markdown extraction are **slow** (network fetch +
   full-document parsing). Only run \`paper_fetch_download\` /
   \`paper_fetch_batch\` / \`paper_pdf2md\` when the user explicitly wants the
   papers (PDFs or their Markdown) added to the chat — never speculatively
   download or extract while searching or summarizing. \`paper_fetch_resolve\`
   (a single link lookup, no files) is the cheap option when only the PDF URL
   is wanted.
3. For paper **content** (full text, passages, figures), prefer the
   \`sciverse_*\` chain — \`sciverse_semantic_search\` / \`sciverse_search_papers\`
   → \`sciverse_read_content\` / \`sciverse_get_resource\` — and only fall back
   to \`paper_fetch_*\` PDF download/extraction as a LAST resort when the user
   explicitly wants the PDF file itself. \`sciverse_get_resource\` persists the
   figure to disk by default (report the returned \`path\` rather than re-fetching);
   it never returns the full base64 inline, and refuses non-image bytes.
4. **Respect Sciverse rate limits**: each endpoint allows ~30 requests/minute.
   Pace consecutive \`sciverse_*\` calls (plan/batch queries), keep \`top_k\` /
   \`page_size\` modest, and on a 429 back off instead of retrying in a burst.
   Paginate \`sciverse_search_papers\` with \`page\` / \`page_size\`. Reported hit
   totals are **capped at 10000** whenever the matched set is larger (any keyword
   \`query\` — even year-filtered — and broad structured filters alike; verified
   live against the official trend cookbook recipe, whose example per-year counts
   are unreachable). Only a matched set below 10000 gives an exact count: narrow
   with field filters (\`authors\` / \`journals\` / \`subjects\`) — year filters
   alone do NOT narrow the cap, and \`title_contains\` is near-exact token
   matching (under-matches; not a topical filter). \`abstract_contains\`
   is folded into the full-text \`query\` (the abstract field is not filterable).
   The keyword \`query\` is for relevance-ranked *discovery*, not precise counting.
   For per-year counts and citation trends use \`sciverse_trend_scan\`
   (Semantic Scholar-backed: real citations) or boolean \`scholar_search_papers\`.
   Sciverse's own citation data is unreliable for broad queries — when a top-cited
   list is wanted, use \`query\` + \`sort_advanced\` (citation_count desc) +
   \`filters_advanced\` \`metadata_type=paper\`, then verify titles are on-topic
   before quoting.
5. Prefer \`scholar_search_papers\` with a precise boolean query and filters
   over many broad relevance calls. Keep \`maxResults\` modest (default 20;
   cap 100 per call). Request abstracts/TLDR inline only when the user needs
   them.
6. Pass resolved DOIs (not titles) to \`paper_fetch_download\` /
   \`paper_fetch_batch\` when the search already returned them.
7. Read error envelopes before retrying: errors carry \`code\`, \`retryable\`,
   and \`retry_after_hours\`. Codes \`validation_error\`,
   \`download_not_a_pdf\`, \`download_host_not_allowed\` are NOT retryable —
   fix the input or report the failure instead. \`not_found\` means no
   open-access copy exists right now; \`*_network_error\` failures are
   transient — retry later. Do not treat a transport error as "paper not
   found".
8. Re-running \`paper_fetch_batch\` with the same \`idempotencyKey\` replays
   the previous envelope without re-downloading; files already present are
   skipped unless \`overwrite\` is set.
9. If \`unpaywallEmail\` is not configured in the plugin settings, the
   \`paper_fetch_batch\` envelope carries \`meta.unpaywallSkipped\` — tell the
   user to add their email in Settings -> Plugins -> Plugin configuration for
   the best source coverage.
10. Offer exports (\`scholar_export_bibtex\`) when the user collects references,
    and point to the exact PDF file paths returned by the fetch tools.
11. \`scholar_get_paper_snippets\` requires the Asta API key: if it reports it is
    unconfigured, tell the user to set the key on the plugin's settings card
    (Settings -> Plugins -> Plugin configuration → "Ai2 Asta API key"), which
    stores it in DSH key management.
12. \`paper_pdf2md\` converts a single PDF to Markdown via MinerU (no API key; IP
    rate-limited; ≤10 MB file cap — page limit is a server-side constraint; uses
    the proxy). Give either an
    \`https://…pdf\` URL or a local file path; it saves the .md into the library
    directory and returns the path + a short excerpt.
13. \`arxiv_get_fulltext\` gives the paper's own HTML rendering (official arXiv
    HTML, no key) — prefer it over PDF→Markdown when the paper is on arXiv and
    an HTML version exists (404 → \`available:false\`, fall back to
    \`paper_fetch_*\` or \`sciverse_*\`). Default \`save:true\` writes the file and
    returns the path; use \`save:false\` when you need the content inline (mind
    token budget — cap with \`maxChars\`).

## Workflow recipes (Sciverse)

Compose the pipeline below when the user's goal matches a case. Primitives (one
call each): C=\`sciverse_list_catalog\` · M=\`sciverse_search_papers\` ·
S=\`sciverse_semantic_search\` · X=\`sciverse_read_content\`.

| Case | When the user asks for | Recipe |
| --- | --- | --- |
| literature-review | a survey / research progress / state of a field | S(query, top_k=20) → X around each high-score hit → write the review with every claim bound to [doc_id + quote + offset] |
| scientific-rag | a question answered with evidence | S(query) → keep hits with score ≥ 0.6 → answer with numbered citations |
| systematic-screen | PRISMA-style screening / include-exclude | C → M(broad: year + type, paginate) → S re-rank candidates → LLM include/exclude with reasons → PRISMA counts |
| evidence-pack | citation packs / ground a draft | \`sciverse_evidence_pack\` (per-claim S + X verify; quote verbatim, never rewritten) |
| trend-scan | field trends / hotness / top-cited | \`sciverse_trend_scan\` — default \`source:"s2"\` (real counts + citations; pass \`boolean\` for precision); \`source:"sciverse"\` = OpenAlex-topic-scoped (pass \`topic_id\`; on \`code:"topic_ambiguous"\` ask via \`ask_user_question\` with the top-5 candidates, then re-run with the chosen \`topic_id\`) |

Caps: ≤5 claims per pack; S top_k ≤ 100; page M; pace to ~30 calls/min.`