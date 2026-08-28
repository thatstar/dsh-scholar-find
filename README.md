# dsh-scholar-find

A plugin for **DeepSeek Harness (DSH)** that gives the model tools for
academic paper research. Search the literature with Semantic Scholar, fetch
open-access PDFs, and convert PDFs to Markdown — all from the chat.

## What you get

**`scholar_search_*`** — find and inspect papers on Semantic Scholar:
search with filters and boolean queries, match a title, look up papers,
citations, references, recommendations, authors, BibTeX export, and
full-text snippets.

**`paper_fetch_*`** — get the PDFs:
`resolve` finds the best open-access PDF link, `download` saves it,
`batch` downloads many DOIs at once, `library` lists what's saved, and
`pdf2md` turns a PDF into Markdown. Only open-access sources are used —
no Sci-Hub, no paywall guessing.

## Install

```bash
npm run build                          # build lib/ once
dsh plugin --profile web add .         # install into the web profile
# then restart the deployment
```

## Use

- Give the model a **topic** → it searches, then fetches the papers it finds.
- Give it **DOIs** → it downloads them straight away.
- **Prefer DOIs over titles** — resolving a title can match the wrong paper.

## Configuration

Open **Settings → Plugins → Plugin configuration** in the DSH Web UI
(namespace `dsh-scholar-find`). The essentials:

- `unpaywallEmail` — your email; enables the Unpaywall source (recommended).
- `s2ApiKeyRef` / `astaApiKeyRef` — optional API keys, entered on the card
  and stored in DSH key management.
- `proxyUrl` — set it if you fetch behind a proxy (e.g. `http://127.0.0.1:10808`).
- `pdfOutputDir` — where PDFs are saved (default `scholar-pdfs`).

Everything else has safe defaults.

## References

This is an independent, clean-room TypeScript implementation built on the
public HTTP APIs. Two projects were consulted for API semantics and UX
conventions only (never vendored or copied):

- [Agents365-ai/semanticscholar-skill](https://github.com/Agents365-ai/semanticscholar-skill)
- [Agents365-ai/paper-fetch](https://github.com/Agents365-ai/paper-fetch)

## License

MIT
