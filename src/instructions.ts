/**
 * Companion instructions for the scholar tools, registered as a system-prompt
 * section by the plugin so the model knows when and how to use each tool
 * family. Guidance only — the model composes the pipeline per the user's goal.
 * @module dsh-scholar-find/instructions
 */

export const SCHOLAR_INSTRUCTIONS = `# Scholar tools (dsh-scholar-find)

Two tool families are available for academic paper research:

- \`scholar_search_*\` — discover and inspect papers through Semantic Scholar:
  ranked search with filters and boolean queries, exact title match, paper
  lookup, citations and references (with intent labels), recommendations,
  author profiles, and BibTeX export. \`scholar_get_paper_content\` retrieves
  ~500-word full-text content snippets from the Ai2 Asta corpus (the Semantic
  Scholar owner's full-text index, not exposed by the public S2 API).
- \`paper_fetch_*\` — obtain PDFs: \`paper_fetch_resolve\` finds the best
  open-access PDF URL for a DOI or title WITHOUT writing files;
  \`paper_fetch_download\` resolves and saves the PDF into the configured
  library directory; \`paper_fetch_batch\` downloads many DOIs with a
  resumable envelope.

Usage rules:

1. Compose the pipeline per the user's goal — search first when the user
   names a topic, fetch directly when they already have DOIs. Never invent a
   DOI: use \`scholar_match_title\` or \`paper_fetch_resolve\` (title) to
   resolve one.
2. Prefer \`scholar_search_papers\` with a precise boolean query and filters
   over many broad relevance calls. Keep \`maxResults\` modest (default 20;
   cap 100 per call). Request abstracts/TLDR inline only when the user needs
   them.
3. Pass resolved DOIs (not titles) to \`paper_fetch_download\` /
   \`paper_fetch_batch\` when the search already returned them.
4. Read error envelopes before retrying: errors carry \`code\`, \`retryable\`,
   and \`retry_after_hours\`. Codes \`validation_error\`,
   \`download_not_a_pdf\`, \`download_host_not_allowed\` are NOT retryable —
   fix the input or report the failure instead. \`not_found\` means no
   open-access copy exists right now; \`*_network_error\` failures are
   transient — retry later. Do not treat a transport error as "paper not
   found".
5. Re-running \`paper_fetch_batch\` with the same \`idempotencyKey\` replays
   the previous envelope without re-downloading; files already present are
   skipped unless \`overwrite\` is set.
6. If \`unpaywallEmail\` is not configured in the plugin settings, an envelope
   field \`unpaywallSkipped\` is set — tell the user to add their email in
   Settings -> Plugins -> Plugin configuration for the best source coverage.
7. Offer exports (\`scholar_export_bibtex\`) when the user collects references,
   and point to the exact PDF file paths returned by the fetch tools.
8. \`scholar_get_paper_content\` requires the Asta API key: if it reports it is
   unconfigured, tell the user to set the key on the plugin's settings card
   (Settings -> Plugins -> Plugin configuration → "Ai2 Asta API key"), which
   stores it in DSH key management; the "Ai2 Asta key record" field names the
   credential record used.`