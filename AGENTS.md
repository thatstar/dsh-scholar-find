# AGENTS.md — dsh-scholar-find

## Mission

Build a **scholar plugin** for DSH that offers **tools to the LLM** — not a
predefined work loop. The plugin has six tool families plus companion
instructions:

1. **`scholar_search_*`** — Semantic Scholar Graph API: paper search (bulk /
   relevance / snippets), paper lookup, citations, references, recommendations,
   authors, BibTeX export, and `scholar_get_paper_snippets` (~500-word full-text
   content via the Ai2 Asta MCP server, not exposed by the public S2 API).
   Identity is verified, not assumed: `scholar_get_paper` takes an
   `expectedTitle` and returns a `titleCheck` verdict (`match`/`near`/
   `mismatch`/`unknown`), `scholar_match_title` refuses a confident wrong
   record, list rows carry `verification: 'unverified'`, and every search hit
   carries venue / fieldsOfStudy / publicationTypes / isOpenAccess so discovery
   can be triaged (`offTopic` annotation for narrow queries, `strictTopic` to
   drop) without opening each record. The title comparison itself is
   **Unicode-aware and variant-aware** (`src/verify.ts`): words for spaced
   scripts, character bigrams for Han/Kana/Hangul, and the score is the best
   pairing across `titleVariants` — because the Sciverse RAG endpoint renders a
   title bilingually (`中文 | English`) while its metadata index is monolingual.
   Both were live defects that made the gate return the refusing `mismatch` for
   the SAME work, on the corpus this plugin advertises (`.notes/78` R1b,
   `.notes/79`).
   Citation/reference lists carry a
   `coverage` verdict (`complete`/`truncated`/`partial`/`not_indexed`/`empty`)
   instead of presenting an index gap as a total, and fall back to the Sciverse
   relations index when S2 serves nothing for a DOI.
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
   Every tool description follows the official MCP skeleton (**`Use when` /
   `Not for` / `Returns`** + per-parameter gotchas; the model never sees
   `output.schema`, so the description is the only return contract) and mirrors
   the documented API defaults: `page_size` 25 (range 1–200), an explicit
   `offset` on every `/content` read (an omitted offset returns the WHOLE
   document and ignores `limit`), boosts gated on a query with no sort, the
   10000 count/paging ceiling without a `cursor`, and `filters`/`sort`/`fields`
   names that must match `meta-catalog` exactly. Those numeric bounds are also
   **enforced in code** (`clampNumber` in `payload.ts`, shared by the sciverse
   client) because the harness schema DSL has no `minimum`/`maximum`: an
   out-of-range `page_size`/`top_k`/`limit` is clamped before the request, and a
   `page * page_size` window above 10000 answers a typed `validation_error`
   instead of burning a call on the gateway's 400 — on `sciverse_search_papers`
   for any query, and on `sciverse_list_paper_relations` for **CITATIONS only**
   (REFERENCES/RELATED_WORKS page freely, live-verified). `/resource` 507, the
   gateway's answer for a well-formed but absent asset, is classified as a
   non-retryable `not_found` to match the description. `test/prompts.spec.ts` pins
   that contract. The resident surface is budgeted: `test/prompts.spec.ts`
   guards the L1 total recursively — the tool description plus every nested
   parameter/item description, i.e. all of `input_schema` — at ≤31,100 chars
   (measured 31,072). Raised from 29,000 by the `.notes/77` card tools, then
   rebalanced by `.notes/78`: R2 moved the filter-operator semantics out of
   `sciverse_search_papers` into `sciverse_list_catalog` (the declared
   authority) and R3 spent part of it on the read-time card trigger (landing at
   31,001); R4–R12 then closed three more gaps — a first attempt at putting
   `unique_id` on evidence items (later reverted, `.notes/79`), the three
   sibling readers named by `sciverse_read_content`, the card-recall pointer on
   `scholar_list_library` — after trimming ~200 chars of fat. The on-demand side
   fell ~1,900 chars in the same batch; the boolean `query` tutorial was then
   cut to its operational essentials and the identity tools stopped emitting a
   card path (R7/R12 tail). `.notes/79` added title-capable carding and the
   variant-aware title gate, landing at 31,072. The `scholar-tools` skill is a single small
   load (~5.8k chars).
4. **`arxiv_*`** — official arXiv HTML full text: `arxiv_get_fulltext` fetches
   `https://arxiv.org/html/<id>` (arXiv's own LaTeXML-converted HTML,
   "experimental" — a subset of papers have no HTML version → `available:false`)
   and renders Markdown (default; math as LaTeX `$...$` from the page's
   `alttext`) or article-scoped raw HTML (`md:false`). Parsing uses **parse5**
   (WHATWG-spec, the only new dependency for this family); the LaTeXML→Markdown
   mapping is hand-rolled with deliberate degradation (unknown elements → text,
   math alttext → annotation → inner text, no `<article>` → whole-body text).
   `save:true` (default) writes `.scholar/md/<id>.md` / `.scholar/html/<id>.html`
   and saves the figures under `.scholar/figs/` (paths returned); `save:false`
   returns the full content inline (cap with `maxChars`) and attaches the
   figures as inline images via the attachment service (`ctx.attachments` +
   `admitEncodedImages`) for vision models — text-only routes degrade to URL
   placeholders. No API key; fetched through the proxy (arXiv is international).

5. **`scholar_format_*`** — reference formatting: `scholar_format_references`
   turns resolved metadata (or explicit items) into entries in ONE declared
   citation style — GB/T 7714-2015, APA 7, IEEE, Nature, BibTeX — and returns a
   footnote-ready `[^n]:` block, so citation format is decided by the plugin
   once instead of re-derived per report. Pure formatters live in `src/cite.ts`.

6. **`scholar_card_*`** — the memory card library: `scholar_card_save` records
   ONE investigated paper and `scholar_card_list` recalls the library
   (`identifier`, title, keywords, counts, `complete`). The format, the
   append-only merge and the dedupe rules are a pure module
   (`src/cardstore.ts`); the tool owns the filesystem and the network.
   **Append-only is enforced by line surgery**, so anything the parser does not
   model survives byte-for-byte; only the single `- coverage:` status line and
   the `Keywords` line are ever refreshed rather than appended.
   **Identity resolution is dual-source** (`.notes/78` R1): Semantic Scholar
   first, then a Sciverse DOI lookup when S2 has no record — the corpus that
   holds the paper verifies the paper — and only when BOTH miss does the card
   degrade to `unverified` (the citation sections then record the S2 gap
   explicitly instead of spending three doomed paced calls). The hard refusal is
   reserved for the case the gate was built for: a resolved record whose title
   genuinely differs. `referenceCount` rides along on the identity lookup, so a
   card costs **three** paced S2 requests, not four (R7). Backtrack/Forwardtrack
   come from S2 with the `coverage` label recorded verbatim, and evidence is
   provenance-bound or not written at all. (An R5 attempt to carry `unique_id`
   on evidence items was **reverted**: live probing showed `/agentic-search`
   serves a fixed hit shape with no `unique_id` and no `doi`, and ignores every
   projection — `.notes/79`.)
   **`paperId` accepts a title as well as an id** (`.notes/79`): the Sciverse
   RAG endpoint serves a fixed hit shape with no `unique_id` and no `doi`, so a
   title is the only identifier that path has. A title resolves through
   `scholar_match_title`, then a Sciverse BM25 lookup gated on the same title
   check, and the card is still keyed by the real DOI the Sciverse row supplies.
   Neither `scholar_get_paper` nor `scholar_match_title` emits a card path any
   more (R7): with the path derived by the tool that writes, the line had no
   consumer and read as state on a pure metadata lookup. The naming rule lives
   in `scholar_card_save` alone. Written because two rounds of prompt-only
   enforcement (`.notes/63`, 65) failed in real use: the model deferred carding
   to report time or skipped it, so the mechanical lifecycle moved into a tool
   (`.notes/77`).

7. **Companion instructions** (variant D, one-sentence resident pointer) — the
   resident prompt section (`SCHOLAR_INSTRUCTIONS`, `src/instructions.ts`) is a
   **single sentence**: it names the six tool families, carries the read-time
   carding hook, and points at the
   `scholar-*` skills as the only place the scholarly rules live. Everything
   else is on-demand, registered as runtime contributions via
   `ctx.skills.register`: the `scholar-tools` skill carries the cross-tool
   Shared behavior rulebook (error envelope, library directory, configuration,
   discovery triage, DOI hygiene, content chain, pacing, coverage verdicts,
   exports) **plus a routing map** over the 30 tools (the look-alike groups) —
   no per-tool roster: each tool's description/schema is the authoritative
   per-call reference (see `.notes/74`); one skill per workflow
   (`scholar-literature-review`, `scholar-scientific-rag`,
   `scholar-systematic-screen`, `scholar-evidence-pack`, `scholar-trend-scan`),
   each carrying its pipeline and a `## Output` section that is the extension
   point for output control, and `scholar-memory` — the persistent DOI card
   library (`cards/` under the output dir): append-only provenance-bound
   evidence (doc_id/offset/page + verbatim quotes) and mandatory citation
   back/forward-track population per investigated paper, so final reports can
   recall what was examined and reproduce its sourcing. The four investigating
   workflows (literature-review, scientific-rag, systematic-screen,
   evidence-pack) carry the card step as a **numbered Pipeline node at read
   time** — `scholar_card_save` right after the read, before the next paper —
   and a recall step (`scholar_card_list`) before the write-up; trend-scan is
   deliberately excluded (it lists top-cited papers without examining them).
   (Until `.notes/77` that hook was a `## Behavior` bullet, "persist every
   investigated DOI as a card", which real use executed as report-time cleanup
   over whatever survived into the report.) The eighth skill,
   `scholar-citation-style`,
   is the citation/bibliography contract (first-mention-only `[^n]` markers,
   blank-line-separated definitions in first-reference order, no markers in
   summary tables, per-report style declaration, entry templates and
   Chinese-report punctuation) — its rules mirror the DSH renderer's actual
   behaviour. The section is registered as a **provider function**
   (`text: () => ctx.get('skills') ? SCHOLAR_INSTRUCTIONS :
   SCHOLAR_INSTRUCTIONS_FALLBACK`), so the fallback is chosen per assembly:
   a profile **with** the skill service pays the one sentence (546 chars ≈
   140 tokens, down from the 6,458-char ≈ 1,700-token section);
   a profile **without** it renders `SCHOLAR_INSTRUCTIONS_FALLBACK` — the old
   full rulebook — because there is nothing left to load on demand.
   `skills` is deliberately NOT in `inject`, so such a profile still loads
   every tool. Every workflow names its dependencies as **load instructions**
   ("Load `scholar-tools` … first"), not as cross-references — the same defect
   the user reported for carding, one level up (`.notes/78` R6). `scholar-memory`
   was cut to **2,371 chars** (from 5,393) by that batch's R8: it had been
   restating the tool's own lifecycle, which is both wasted load and a drift
   surface. The fallback is a near-clone of the `scholar-tools` Shared behavior
   section and had silently drifted twice (it lost the `next_offset` paging rule
   and kept calling `scholar_search_papers` "the default discovery tool" long
   after every workflow moved to Sciverse entry); `test/skills.spec.ts` now pins
   rule **coverage** between the two surfaces rather than wording (R10).

The user configures plugin parameters (Unpaywall email, API keys, CloakBrowser
toggle, proxy, output directory, …) on the **DSH Web UI's Plugins page** — the
**dsh-scholar-find** bundle's own configuration (0.1.7 removed the Settings →
Plugins → Plugin configuration surface; the read-only settings inventory no
longer holds plugin forms). Values persist to the active profile's patch
document (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`) as an id-targeted
`- id: dsh-scholar-find` row and apply live.

Settings registration is the **plugin's own Cordis `Config` schema**
(`src/settings.ts`, exported as `Config` from `src/index.ts`): the loader parses
the profile row with it, and every field is `.volatile()`, which is what the
settings service projects into the editable form and what lets a saved value be
committed into the running references without remounting the plugin. The plugin
still imports nothing from `@deepseek-ai/dsh-settings` (no runtime import, no
type import, no direct dependency) — the schema, the namespace, and the writes
are validated by the installed profile's copy, so an upstream dsh API change
fails **loudly at plugin activation** instead of being silently masked by a
private nested copy. The numeric bounds live in that schema (the write-time
boundary) and `assertServiceableScholarSettings()` re-checks the config the
running fiber actually carries at activation.

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
  host-composition unit — tools, its own Config (settings) schema, and companion-instructions
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
A local `link:`/`file:`/tarball install never runs `prepare`, so build once with
`npm run build` before `dsh plugin add`; only a **git** spec runs it (pnpm's
`prepare-package` builds the checkout with a bare `<pm> install`, so that path
needs pnpm + npm + node on `PATH` **and** an `allowBuilds` entry). For machines
where Node lives inside an app bundle (DSH desktop on Windows), `npm run
pack:dist` (`scripts/pack-dist.mjs`) stages a prebuilt `dist/dsh-scholar-find/`
plus `dist/dsh-scholar-find-<version>.tgz`, whose manifest has `prepare` removed
— installing either runs no build at all. Live examples already in this
deployment: `dsh-better-sidebar`, `@anysearch/anysearch-dsh`.

**Runtime generation.** The build target is the **DSH 0.2.0-rc.1** generation
(`cordis ~4.0.4`, `@deepseek-ai/schemastery ^3.18.4`, `@deepseek-ai/dsh-*`
dev dependencies pinned to `0.2.0-rc.1`). The four host peers (`dsh-attachment`,
`dsh-credentials`, `dsh-llm`, `dsh-tools`) are ranges —
`>=0.1.7-rc.1 <0.2.0 || >=0.2.0-rc.1 <0.3.0` — because the runtime gates every
profile bundle whose `@deepseek-ai/dsh*` peers do not satisfy the running
version (`evaluatePluginCompatibility` in `@deepseek-ai/dsh-app-boot`): an exact
pin silently drops the bundle from the composition. Widen the ranges (and move
the dev dependencies) together when the runtime generation changes.

## Configuration (user-owned, via the Web UI Plugins page, not env vars in code)

| Config field (entry id `dsh-scholar-find`) | Purpose |
| --- | --- |
| `unpaywallEmail` | Required for the Unpaywall source; also used as Crossref `mailto`. |
| `s2ApiKeyRef` | Optional S2 key — a **DSH credential reference** (the record name; resolved via `ctx.credentials`). The key literal is entered on the page's write-only "Semantic Scholar API key" control, which writes to the **DSH credentials domain** (`api.credentials.set`) — never stored in the settings row. **Decided: anonymous mode** (empty ref → 5 s pacing). |
| `astaApiKeyRef` | Optional Ai2 Asta corpus MCP key — a **DSH credential reference** (the record name; resolved via `ctx.credentials`). The key literal is entered on the page's write-only "Ai2 Asta API key" control, which writes to the **DSH credentials domain** (`api.credentials.set`). Enables `scholar_get_paper_snippets` (~500-word full text). |
| `sciverseApiKeyRef` | Sciverse Open Platform Bearer token — a **DSH credential reference** (default `SCIVERSE_API_TOKEN`), entered on the page's write-only "Sciverse API token" control, which writes to the **DSH credentials domain**. Enables the `sciverse_*` tools. Sciverse is fetched **directly (no proxy)** — China-hosted. |
| `cloakEnabled` | Opt-in CloakBrowser fallback for Cloudflare/WAF-gated PDFs (heavy; off by default). |
| `proxyUrl` | Outbound HTTP proxy (e.g. `http://127.0.0.1:10808`); used for OA fetches, the CloakBrowser, and its binary download. |
| `defaultOutputDir` | Root output directory. **Decided: `.scholar`** (resolved against the session workspace); each tool owns a subdirectory: `pdfs/` (PDFs), `md/` (Markdown, incl. `arxiv_get_fulltext`), `html/` (arXiv HTML pages), `figs/` (Sciverse figures), `idem/` (batch-idempotency sidecar), `cards/` (the `scholar-memory` DOI card library, written and read by the `scholar_card_*` tools). |
| `maxResultsPerSearch`, `fetchTimeoutSec`, … | Tunables with safe defaults. |

## Code policy

Implementation is **complete** and committed:
The repository root is the pure-TypeScript DSH plugin (**30 tools**: `scholar_search_*`
incl. `scholar_get_paper_snippets` via the Ai2 Asta MCP server, `scholar_format_references`,
`scholar_card_*` (the memory card library — `scholar_card_save` /
`scholar_card_list`, backed by the pure `src/cardstore.ts`),
`paper_fetch_*`,
`arxiv_*` (`arxiv_get_fulltext` — official arXiv HTML full text as Markdown or
article-scoped HTML, parse5-based), and
`sciverse_*` via the Sciverse Open Platform — including the two workflow tools
`sciverse_trend_scan` (dual-source: default Semantic Scholar counts/citations,
real values; `source:"sciverse"` = OpenAlex-topic-scoped Sciverse meta-search
with exact counts below the server's 10000 cap and in-topic top-cited) and
`sciverse_evidence_pack`),
Config schema, companion instructions, client-half settings page. **465 passing unit tests**, `lib/` **not git-tracked** (built by `prepare`/`build`), **installed
into the live profile** (`dsh plugin --profile web add .` — bundle reconciled).
The fetch chain is OA-sources only (Unpaywall → S2 → arXiv → PMC → bioRxiv):
direct → CloakBrowser fallback → last-resort title web-search fallback → report
no PDF. No Sci-Hub / publisher-guess / institutional fallback. The fetch chain
applies an identity gate (`title_mismatch` / `source_title_conflict`, both
non-retryable) so a plausible-looking PDF for a different work is refused rather
than returned, and a web-search-only hit is reported `verified: false`.

Sciverse failures are typed envelopes, not thrown errors: the client parses the
nested `{error:{code}}` body the gateway sends, retries 429/5xx/timeout
(1+2 attempts with backoff), and `sciverse_read_content` walks `alt_doc_ids`
(reported by `doc_id_index` on semantic hits) so one missing artifact does not
end a read.

The three API keys (`s2ApiKeyRef`, `astaApiKeyRef`, `sciverseApiKeyRef`) use the
**native DSH credentials-domain pattern**: the settings row carries only the
credential **reference** (record name), the page's write-only key controls write
the literal to the **DSH credentials domain** (`api.credentials.set`), and the
keys are resolved at runtime via `ctx.credentials.resolve(credentialRef(...))` —
never stored in the settings row/repo.

Keep everything TypeScript-only, clean-room, and test-covered.
