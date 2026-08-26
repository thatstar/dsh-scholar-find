# AGENTS.md — dsh-scholar-find

## Mission

Build a **scholar plugin** for DSH that offers **tools to the LLM** — not a
predefined work loop. The plugin has two tool families plus companion
instructions:

1. **`scholar_search_*`** — Semantic Scholar Graph API: paper search (bulk /
   relevance / snippets), paper lookup, citations, references, recommendations,
   authors, BibTeX export.
2. **`paper_fetch_*`** — PDF acquisition: DOI/title → best OA PDF via the
   fallback chain (Unpaywall → Semantic Scholar → arXiv → Europe PMC/PMC →
   bioRxiv/medRxiv → publisher direct (opt-in) → Sci-Hub (opt-in)), with
   download, batch, and dry-run resolution.
3. **Companion instructions** — a prompt section telling the LLM when and how
   to use each tool (parameter hygiene, envelope interpretation, retry policy).

The user configures plugin parameters (Unpaywall email, S2 API key, Sci-Hub
toggle, output directory, …) in the **DSH Web UI: Settings → 插件 (Plugins) →
插件配置 (Plugin Config)**; values persist to `$DSH_HOME/settings.yaml`.

## Implementation rules (mandatory)

- **TypeScript only.** The whole plugin is implemented in TypeScript for the
  Node.js host. No Python, no shelling out to Python.
- **Independent implementation.** The plugin is written from scratch against
  the *public HTTP APIs* (Semantic Scholar Graph API, Unpaywall API, Crossref,
  arXiv Atom, bioRxiv API, PMC/Europe PMC). Do **not** copy source code from
  other projects — including the reference skill repos below (copyright /
  licensing independence is a project requirement).
- **No user-preset dependency.** The plugin is a self-contained
  host-composition unit — tools, settings section, and companion-instructions
  prompt row are mounted deployment-wide (host plane). No personalized agent
  preset is required or used.
- **Reference-only repos.** The following repos are *references* for API
  behavior and tool UX design — never an upstream to vendor, sync, or import:

  | Repo | What we take from it |
  | --- | --- |
  | [Agents365-ai/semanticscholar-skill](https://github.com/Agents365-ai/semanticscholar-skill) | S2 REST endpoint semantics, query/filter vocabulary, result presentation conventions |
  | [Agents365-ai/paper-fetch](https://github.com/Agents365-ai/paper-fetch) | Source-chain ordering, safety requirements (SSRF gate, `%PDF` check, size cap), agent-facing result envelope design |

  Research clones may live in `.research-tmp/` (git-ignored) for consultation;
  they are disposable and never part of the shipped plugin.

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
deployment must reload to activate the rows. Live examples already in this
deployment: `dsh-better-sidebar`, `@anysearch/anysearch-dsh`.

## Configuration (user-owned, via Web UI settings, not env vars in code)

| Setting (namespace `dsh-scholar-find`) | Purpose |
| --- | --- |
| `unpaywallEmail` | Required for the Unpaywall source; also used as Crossref `mailto`. |
| `s2ApiKeyRef` | Optional S2 key as a **DSH credential reference** (record name in `~/.dsh/.credentials.yaml`, resolved via `ctx.credentials` — same pattern as `llm-pi-ai` model keys). **Decided: anonymous mode** (empty → 5 s pacing). |
| `scihubEnabled` | Enable the Sci-Hub last-resort fallback. **Decided: off.** |
| `institutionalEnabled` | Opt-in publisher-direct fallback (user's own subscription access). |
| `pdfOutputDir` | Where downloaded PDFs land. **Decided: `scholar-pdfs`** (resolved against the session workspace). |
| `maxResultsPerSearch`, `fetchTimeoutSec`, … | Tunables with safe defaults. |

## Code policy

Implementation (Phase 3) is **done** and Phase 4 is **in progress**:
`packages/scholar/` is a pure-TypeScript DSH plugin (15 tools, settings
section, companion instructions, **client-half settings card**), 31 passing
unit tests, committed `lib/` build, **installed into the live profile**
(`dsh plugin --profile web add ./packages/scholar` — bundle reconciled,
host row mounts cleanly, live API smoke passed). The missing settings card
was a client-half gap: the Plugins tab only renders cards registered through
the `settings.plugin.item` slot, so the fix ships a self-contained client
bundle (`lib/client.js`, `__ModuleLoader__` format). Remaining: **one more
deployment restart**, user sets `unpaywallEmail` in Settings → 插件 → 插件配置,
in-session end-to-end verification. Future changes must keep the plugin
TypeScript-only, clean-room, and test-covered.