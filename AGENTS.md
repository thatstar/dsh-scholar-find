# AGENTS.md — dsh-scholar-find

## Mission

Build a **scholar plugin** for DSH that offers **tools to the LLM** — not a
predefined work loop. The plugin has four tool families plus companion
instructions:

1. **`scholar_search_*`** — Semantic Scholar Graph API: paper search (bulk /
   relevance / snippets), paper lookup, citations, references, recommendations,
   authors, BibTeX export, and `scholar_get_paper_snippets` (~500-word full-text
   content via the Ai2 Asta MCP server, not exposed by the public S2 API).
2. **`paper_fetch_*`** — PDF acquisition: DOI/title → best OA PDF via the
   fallback chain (Unpaywall → Semantic Scholar → arXiv → Europe PMC/PMC →
   bioRxiv/medRxiv). We rely strictly on the OA sources' own return values: a
   direct PDF is tested, then a CloakBrowser fallback. If both fail, a **last
   automatic fallback** web-searches the paper's full title (via the DSH `web`
   service, the `web_search` backing) for a free PDF and tries to fetch it; if
   that also fails we report no PDF fetched. (No publisher-guess, Sci-Hub, or
   pirate fallback.) `paper_pdf2md` converts a single PDF (URL or local file) to
   Markdown full text via the MinerU lightweight parse API (no key; ≤10 MB file
   cap — page limit is a server-side constraint; uses the proxy) and saves the
   .md into the library directory.
3. **`sciverse_*`** — Sciverse Open Platform retrieval (one Bearer token, set
   as the `sciverseApiKeyRef` credential): structured paper search, semantic
   RAG search, field catalog, citation relations, full-text slices, and
   figures. **Fetched DIRECTLY — no proxy** (China-hosted service; routed
   around `proxyUrl` on purpose). Each endpoint is rate-limited to ~30
   requests/minute. Implemented as a **clean-room direct REST client**
   (`src/sciverse/client.ts` + `src/sciverse/payload.ts`) against the public
   HTTP API at `https://api.sciverse.space` — **no SDK dependency** (the
   `sciverse` npm package is not used; requests are socket-timeout bounded via
   `timedFetch` with the global fetch, so the proxy dispatcher never applies).
4. **`arxiv_*`** — official arXiv HTML full text: `arxiv_get_fulltext` fetches
   `https://arxiv.org/html/<id>` (arXiv's own LaTeXML-converted HTML,
   "experimental" — a subset of papers have no HTML version → `available:false`)
   and renders Markdown (default; math as LaTeX `$...$` from the page's
   `alttext`) or article-scoped raw HTML (`md:false`). Parsing uses **parse5**
   (WHATWG-spec, the only new dependency for this family); the LaTeXML→Markdown
   mapping is hand-rolled with deliberate degradation (unknown elements → text,
   math alttext → annotation → inner text, no `<article>` → whole-body text).
   `save:true` (default) writes `.scholar/md/<id>.md` / `.scholar/html/<id>.html`
   and returns the path; `save:false` returns the full content inline (cap with
   `maxChars`). No API key; fetched through the proxy (arXiv is international).

5. **Companion instructions** — a prompt section telling the LLM when and how
   to use each tool (parameter hygiene, envelope interpretation, retry policy).

The user configures plugin parameters (Unpaywall email, S2 API key, CloakBrowser
toggle, proxy, output directory, …) in the **DSH Web UI: Settings → Plugins →
Plugin configuration**; values persist to `$DSH_HOME/settings.yaml`.

Settings registration is a **runtime service call** (`ctx.settings.installSection`)
— the plugin imports nothing from `@deepseek-ai/dsh-settings` (no runtime import,
no type import, no direct dependency). The namespace/schema are validated by the
installed profile's copy, so an upstream dsh API change fails **loudly at plugin
activation** instead of being silently masked by a private nested copy.

## Implementation rules (mandatory)

- **TypeScript only.** The whole plugin is implemented in TypeScript for the
  Node.js host. No Python, no shelling out to Python.
- **Independent implementation.** The plugin is written from scratch against
  the *public HTTP APIs* (Semantic Scholar Graph API, Unpaywall API, Crossref,
  arXiv Atom, bioRxiv API, PMC/Europe PMC). Do **not** copy source code or
  designs from other projects (copyright / licensing independence is a project
  requirement). **Reference citations live only in `README.md`** — that is the
  single sanctioned place that names external skills.
- **No user-preset dependency.** The plugin is a self-contained
  host-composition unit — tools, settings section, and companion-instructions
  prompt row are mounted deployment-wide (host plane). No personalized agent
  preset is required or used.
- **No CLI.** The plugin ships no binary; every capability is a DSH tool. Retry
  hints in `paper_fetch_batch` envelopes (`next`) name the DSH tools to re-call,
  and the idempotency sidecar is `<defaultOutputDir>/idem/` (default `.scholar/idem/`).

  Research/consultation clones may live in `.research-tmp/` (git-ignored); they
  are disposable and never part of the shipped plugin.

## The `.notes/` rule (mandatory)

All research findings, analysis and thoughts, design decisions, and plans for
this project **must** be written down as Markdown files under `.notes/` in this
repo. A research/planning task is not "done" until its conclusions live there.

- `.notes/` is **git-ignored** — a local-only scratchpad. Do not rely on
  reading it from a fresh clone; `AGENTS.md` (committed) is the durable rule.
- Naming: zero-padded numbered Markdown (`01-findings.md`, `02-thoughts.md`,
  `03-plan.md`, `04-tool-catalog.md`, …), with `.notes/README.md` as the index.
- Prefer referencing `.notes/` files over dumping their content into chat.
- Anything discovered that changes the plan must update `.notes/` alongside
  the conversation.

## Installation (per-profile DSH plugin)

The plugin is an **npm package** whose `package.json` declares
`dsh.bundle.patch` (pointing at the package's `cordis.patch.yml`, which
carries the plugin rows). The user installs it per profile with the DSH
plugin CLI — **checkout location is irrelevant**:

```bash
dsh plugin --profile web add <spec>      # spec: relative path | file: | git URL | registry name
dsh plugin --profile web remove <name>
dsh plugin --profile web list            # pnpm list passthrough
```

The CLI initializes the profile on first use, runs pnpm in the profile
directory (relative specs anchored to the invoking directory), and re-
conciles `dsh.profile.bundles` from the installed state. After install the
deployment must reload to activate the rows.

Build note: `lib/` is **not git-tracked** (built by `prepare`, mirroring
upstream dsh plugins — only the published/installed package carries `lib/`).
A local `link:`/`file:` install does not run `prepare`, so build once with
`npm run build` before `dsh plugin add`; a git/registry install runs `prepare`
automatically. Live examples already in this
deployment: `dsh-better-sidebar`, `@anysearch/anysearch-dsh`.

## Configuration (user-owned, via Web UI settings, not env vars in code)

| Setting (namespace `dsh-scholar-find`) | Purpose |
| --- | --- |
| `unpaywallEmail` | Required for the Unpaywall source; also used as Crossref `mailto`. |
| `s2ApiKeyRef` | Optional S2 key — a **DSH credential reference** (the record name; resolved via `ctx.credentials`). The key literal is entered on the card's write-only "Semantic Scholar API key" control, which writes to the **DSH credentials domain** (`api.credentials.set`) — never stored in the settings section. **Decided: anonymous mode** (empty ref → 5 s pacing). |
| `astaApiKeyRef` | Optional Ai2 Asta corpus MCP key — a **DSH credential reference** (the record name; resolved via `ctx.credentials`). The key literal is entered on the card's write-only "Ai2 Asta API key" control, which writes to the **DSH credentials domain** (`api.credentials.set`). Enables `scholar_get_paper_snippets` (~500-word full text). |
| `sciverseApiKeyRef` | Sciverse Open Platform Bearer token — a **DSH credential reference** (default `SCIVERSE_API_TOKEN`), entered on the card's write-only "Sciverse API token" control, which writes to the **DSH credentials domain**. Enables the `sciverse_*` tools. Sciverse is fetched **directly (no proxy)** — China-hosted. |
| `cloakEnabled` | Opt-in CloakBrowser fallback for Cloudflare/WAF-gated PDFs (heavy; off by default). |
| `proxyUrl` | Outbound HTTP proxy (e.g. `http://127.0.0.1:10808`); used for OA fetches, the CloakBrowser, and its binary download. |
| `defaultOutputDir` | Root output directory. **Decided: `.scholar`** (resolved against the session workspace); each tool owns a subdirectory: `pdfs/` (PDFs), `md/` (Markdown, incl. `arxiv_get_fulltext`), `html/` (arXiv HTML pages), `figs/` (Sciverse figures), `idem/` (batch-idempotency sidecar). |
| `maxResultsPerSearch`, `fetchTimeoutSec`, … | Tunables with safe defaults. |

## Code policy

Implementation is **complete** and committed:
The repository root is the pure-TypeScript DSH plugin (**27 tools**: `scholar_search_*`
incl. `scholar_get_paper_snippets` via the Ai2 Asta MCP server, `paper_fetch_*`,
`arxiv_*` (`arxiv_get_fulltext` — official arXiv HTML full text as Markdown or
article-scoped HTML, parse5-based), and
`sciverse_*` via the Sciverse Open Platform — including the two workflow tools
`sciverse_trend_scan` (dual-source: default Semantic Scholar counts/citations,
real values; `source:"sciverse"` = OpenAlex-topic-scoped Sciverse meta-search
with exact counts below the server's 10000 cap and in-topic top-cited) and
`sciverse_evidence_pack`),
settings section, companion instructions, client-half settings card. **199 passing unit tests**, `lib/` **not git-tracked** (built by `prepare`/`build`), **installed
into the live profile** (`dsh plugin --profile web add .` — bundle reconciled).
The fetch chain is OA-sources only (Unpaywall → S2 → arXiv → PMC → bioRxiv):
direct → CloakBrowser fallback → last-resort title web-search fallback → report
no PDF. No Sci-Hub / publisher-guess / institutional fallback.

The three API keys (`s2ApiKeyRef`, `astaApiKeyRef`, `sciverseApiKeyRef`) use the
**native DSH credentials-domain pattern**: the settings section carries only the
credential **reference** (record name), the card's write-only key controls write
the literal to the **DSH credentials domain** (`api.credentials.set`), and the
keys are resolved at runtime via `ctx.credentials.resolve(credentialRef(...))` —
never stored in the settings section/repo.

Keep everything TypeScript-only, clean-room, and test-covered.
