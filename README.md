# dsh-scholar-find

A plugin for **DeepSeek Harness (DSH)**: search academic literature, fetch
open-access PDFs, and convert PDFs to Markdown — all from the chat.

## Features

- **Search** — papers, citations, authors, recommendations, and full-text
  snippets (`scholar_search_*`).
- **Fetch** — find and download open-access PDFs, individually or in bulk,
  and convert them to Markdown (`paper_fetch_*`). Open-access sources only —
  no paywall workarounds.
- **Sciverse** — search and read papers from the Sciverse corpus: structured
  and semantic (RAG) search, full-text slices, citation relations, and
  figures (`sciverse_*`).
- **arXiv HTML** — official arXiv HTML full text by arXiv id, rendered as
  Markdown (or article-scoped raw HTML) (`arxiv_get_fulltext`).
- **References** — format a reference list in one declared citation style
  (GB/T 7714-2015, APA 7, IEEE, Nature, BibTeX) and get a footnote-ready
  definition block (`scholar_format_references`), plus the on-demand
  `scholar-citation-style` contract and the `scholar-memory` DOI card library.
- **Honest by default** — identifiers taken from a list are verified against
  the title you expect before they can be carded or cited, a PDF whose record
  is a different work is refused rather than downloaded, and citation lists
  carry a coverage verdict (`complete`/`truncated`/`partial`/`not_indexed`)
  instead of presenting an index gap as a total.

## Installation

```bash
npm run build
dsh plugin --profile web add .
```

`dsh plugin` forwards to pnpm, so pnpm must be on `PATH` (or be named by the
plugin manager's `pnpmCommand`). Only a **git** spec makes the target machine
build anything — pnpm builds a git checkout through a bare `<pm> install`, which
needs `npm` and `node` on `PATH` as well, plus the `allowBuilds` entry it prints.
A path or tarball spec is installed exactly as it comes.

### Distributing a prebuilt artifact

So to install on a machine whose Node lives inside an app bundle (DSH desktop on
Windows), ship it built:

```bash
npm run pack:dist                              # → dist/dsh-scholar-find/ + dist/dsh-scholar-find-<version>.tgz
npm run pack:dist -- --out ../dsh-scholar-find-dist
```

Then on the target machine:

```bash
dsh plugin --profile web add <folder>/dsh-scholar-find-0.2.0.tgz   # or …/<folder>/dsh-scholar-find
```

The staged package ships `lib/` already compiled and its `package.json` has the
`prepare` script removed, so no install path — not even a git URL pointing at the
staged folder — can trigger a build there. Its runtime dependencies (`parse5`,
`undici`, `playwright-core`, `cloakbrowser`) are still resolved from the
registry. Prefer the tarball: a directory spec installs as a `link:`, a symlink
that breaks if the folder moves.

Restart the deployment afterwards. The build target is the **DSH 0.2.0-rc.1**
generation (`cordis ~4.0.4`, `@deepseek-ai/schemastery ^3.18.4`): the settings
page, the client module graph, and the plugin `Config` schema all follow that
generation's contracts. The four `@deepseek-ai/dsh-*` peers are declared as
ranges (`>=0.1.7-rc.1 <0.2.0 || >=0.2.0-rc.1 <0.3.0`) rather than exact pins, so
a runtime bump inside a supported line does not trip the profile's
peer-compatibility gate.

### Configuration

Open the Web UI's **Plugins** page and pick the **dsh-scholar-find** bundle;
its configuration renders on the bundle's own page (the harness moved plugin
configuration off the read-only Settings inventory in 0.1.7). Values are saved
into the active profile's patch document
(`$DSH_HOME/profiles/<profile>/cordis.patch.yml`) as

```yaml
- id: dsh-scholar-find
  config:
    unpaywallEmail: you@example.org
```

and apply live — no restart. API keys are the exception: their literals go to
the DSH credentials domain (key management), and the card shows only whether a
key is configured. Nothing needs editing by hand.

## Usage

- Name a **topic** — the assistant searches, then fetches what it finds.
- Give **DOIs** — they download straight away. Prefer DOIs over titles:
  a title can match the wrong paper (and if it does, the fetch refuses and
  says so instead of handing you the wrong PDF).
- Ask for a **reference list** — it comes back in the style you name, with
  `[^n]` footnote definitions ready to paste.
- Set it up on the Web UI's **Plugins** page (**dsh-scholar-find** → its
  configuration): your email
  (`unpaywallEmail`), optional API keys (`s2ApiKeyRef` / `astaApiKeyRef` /
  `sciverseApiKeyRef`), a `proxyUrl` if you are behind a proxy, and a
  `defaultOutputDir` (default `.scholar`, with `pdfs/`/`md/`/`html/`/`figs/`/
  `idem/`/`cards/` subfolders per tool — `cards/` holds the DOI card library
  the assistant maintains for investigated papers). Everything else has safe
  defaults.

## References

- [Agents365-ai/semanticscholar-skill](https://github.com/Agents365-ai/semanticscholar-skill)
- [Agents365-ai/paper-fetch](https://github.com/Agents365-ai/paper-fetch)
- [arXiv: HTML as an accessible format for papers](https://info.arxiv.org/about/accessible_HTML.html)

## License

MIT
