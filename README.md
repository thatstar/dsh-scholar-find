# dsh-scholar-find

A plugin for **DeepSeek Harness (DSH)**: search academic literature, fetch
open-access PDFs, and convert PDFs to Markdown — all from the chat.

## What you get

**`scholar_search_*`** — search the literature: papers, citations,
authors, recommendations, and full-text snippets.

**`paper_fetch_*`** — get the papers: find and download open-access PDFs
(individually or in bulk), and convert them to Markdown. Open-access
sources only — no paywall workarounds.

## Install

```bash
npm run build
dsh plugin --profile web add .
```

Then restart the deployment.

## Use

- Give the model a **topic** → it searches, then fetches the papers it finds.
- Give it **DOIs** → it downloads them straight away.
- **Prefer DOIs over titles** — resolving a title can match the wrong paper.

## Configuration

Open **Settings → Plugins → Plugin configuration** in the DSH Web UI:

- `unpaywallEmail` — your email (recommended).
- `s2ApiKeyRef` / `astaApiKeyRef` — optional API keys.
- `proxyUrl` — set if you fetch behind a proxy (e.g. `http://127.0.0.1:10808`).
- `pdfOutputDir` — where PDFs are saved (default `scholar-pdfs`).

Everything else has safe defaults.

## References

- [Agents365-ai/semanticscholar-skill](https://github.com/Agents365-ai/semanticscholar-skill)
- [Agents365-ai/paper-fetch](https://github.com/Agents365-ai/paper-fetch)

## License

MIT
