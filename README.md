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

## Installation

```bash
npm run build
dsh plugin --profile web add .
```

Restart the deployment afterwards.

## Usage

- Name a **topic** — the assistant searches, then fetches what it finds.
- Give **DOIs** — they download straight away. Prefer DOIs over titles:
  a title can match the wrong paper.
- Set it up in **Settings → Plugins → Plugin configuration**: your email
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
