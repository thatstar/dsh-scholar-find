# dsh-scholar-find

A plugin for **DeepSeek Harness (DSH)**: search academic literature, fetch
open-access PDFs, and convert PDFs to Markdown — all from the chat.

## Features

- **Search** — papers, citations, authors, recommendations, and full-text
  snippets (`scholar_search_*`).
- **Fetch** — find and download open-access PDFs, individually or in bulk,
  and convert PDFs to Markdown (`paper_fetch_*`). Open-access sources only —
  no paywall workarounds.

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
  (`unpaywallEmail`), optional API keys, a `proxyUrl` if you are behind a
  proxy, and a `pdfOutputDir` (default `scholar-pdfs`). Everything else has
  safe defaults.

## References

- [Agents365-ai/semanticscholar-skill](https://github.com/Agents365-ai/semanticscholar-skill)
- [Agents365-ai/paper-fetch](https://github.com/Agents365-ai/paper-fetch)

## License

MIT
