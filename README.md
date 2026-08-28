# dsh-scholar-find

A **DeepSeek Harness (DSH) plugin** that gives the model a coherent set of
academic-paper research tools — **tools to the LLM**, not a predefined work
loop. Pure TypeScript, Node host, no Python, no external runtime.

## Features

Two tool families plus companion instructions:

- **`scholar_search_*`** — Semantic Scholar Graph API: ranked/bulk search with
  boolean queries and filters, exact-title match, paper lookup, citations and
  references (with intent labels), recommendations, author profiles, BibTeX
  export, and `scholar_get_paper_snippets` (~500-word full-text content via the
  Ai2 Asta MCP server, a corpus the public S2 API does not expose).
- **`paper_fetch_*`** — open-access PDF acquisition: `resolve` (best OA PDF URL
  without writing files), `download`, `batch` (resumable, idempotent), `library`
  (list), and `pdf2md` (PDF → Markdown via the MinerU lightweight parse API).
  The resolve chain is **OA-sources only** — Unpaywall → Semantic Scholar →
  arXiv (with export-API metadata enrichment) → Europe PMC/PMC → bioRxiv/medRxiv
  — then an opt-in CloakBrowser fallback, then a last-resort title web-search
  fallback. **No Sci-Hub, no publisher-guess, no pirate sources.** Downloads are
  validated by `%PDF` magic + a configurable size cap behind an SSRF gate; files
  land in a configured library directory (default `scholar-pdfs`) with a
  deterministic `{author}-{year}-{title}.pdf` name.
- **Companion instructions** — a system-prompt section telling the model when
  and how to use each tool (parameter hygiene, envelope interpretation, retry
  policy).

The two API keys (Semantic Scholar, Ai2 Asta) use the **native DSH credentials
domain**: the settings section stores only a credential *reference* (record
name); the key literals are entered on the settings card's write-only controls
and live in DSH key management — never in the settings file or this repo.

## Installation

The plugin is an npm package whose `cordis.patch.yml` declares its rows:

```bash
npm run build        # tsc + client bundle (a local file:/link: install skips prepare)
dsh plugin --profile web add .     # or: a git URL / registry name
# then RESTART the deployment to load the plugin
```

## Usage

Compose the pipeline per the goal: **search first** when the user names a
topic; **fetch directly when they already have DOIs**. Prefer DOIs over
titles — title→DOI resolution (Crossref → Semantic Scholar) is fuzzy and can
match a different paper. Read the error envelopes before retrying: `code`,
`retryable`, `retry_after_hours` distinguish never-retryable (`validation_error`,
`download_not_a_pdf`, `download_host_not_allowed`) from transient `*_network_error`
from `not_found` (retry only after embargo/preprint availability changes).

## Configuration

Set via the DSH Web UI: **Settings → Plugins → Plugin configuration**
(namespace `dsh-scholar-find`):

| Setting | Purpose |
| --- | --- |
| `unpaywallEmail` | Required for the Unpaywall source; also used as Crossref `mailto`. |
| `s2ApiKeyRef` / `astaApiKeyRef` | DSH credential **references** (record names; defaults `S2_API_KEY` / `ASTA_API_KEY`). The key literals go on the card's write-only controls → DSH key management. |
| `cloakEnabled` | Opt-in CloakBrowser fallback for Cloudflare/WAF-gated PDFs. |
| `proxyUrl` | Outbound HTTP proxy (e.g. `http://127.0.0.1:10808`) for all OA fetches, the CloakBrowser, and its binary download. |
| `pdfOutputDir` | Where PDFs (and `.md`) land; relative to the session workspace. |
| `maxResultsPerSearch` | Default result cap for `scholar_search_*` (per-call ceiling 100). |
| `fetchTimeoutSec`, `maxPdfSizeMb`, `s2RequestGapMs` | Request timeout, download size cap, and S2 pacing override. |

## Architecture (brief)

- `src/fetch/` — the resolve chain (`chain.ts`, split into named source steps
  over a `ChainState`), orchestration/envelopes (`service.ts`, `envelope.ts`),
  safety gate (`safety.ts`), transport (`transport.ts` with a shared
  `timedFetch`/`sleep`), and the CloakBrowser fallback.
- `src/s2|asta|mineru/` — independent HTTP clients for Semantic Scholar, the
  Ai2 Asta MCP server, and MinerU's parse API. The S2 client paces requests
  (shared clock across tool calls, configurable gap) and retries 429/504.
- `src/settings.ts` + `src/client/` — the settings section (single-sourced
  defaults, `SEARCH_RESULT_CAP`) and the Web settings card.
- All outbound traffic funnels through `pluginFetch` (browser UA + proxy).

This plugin ships **no CLI binary** — everything is exposed as DSH tools; the
retry hints inside `paper_fetch_batch` envelopes (`next`) therefore name the
DSH tools to re-call, and the idempotency sidecar lives in `.dsh-scholar-idem/`.

## References

This is an **independent, clean-room TypeScript implementation** written
against the public HTTP APIs. Two external skill repos were consulted for
**API semantics and UX conventions only** (never vendored, never copied; this
is the only place they are cited):

- [Agents365-ai/semanticscholar-skill](https://github.com/Agents365-ai/semanticscholar-skill)
  — S2 REST endpoint semantics, query/filter vocabulary, result presentation
  conventions.
- [Agents365-ai/paper-fetch](https://github.com/Agents365-ai/paper-fetch) —
  source-chain ordering, safety requirements (SSRF gate, `%PDF` check, size
  cap), agent-facing result envelope design.

## License

MIT. See `package.json`.