/**
 * scholar-memory skill: the persistent DOI card library. Every investigated
 * paper gets a Markdown card under `<defaultOutputDir>/cards/`, named after
 * its DOI (`/` → `_`), so final reports can recall what was examined. The
 * append-only update rules and the card template are the core contract.
 */

export const SCHOLAR_MEMORY_SKILL = {
  name: 'scholar-memory',
  description:
    'Track investigated papers as persistent Markdown DOI cards under the plugin output dir (cards/ subfolder), for final reports: append-only evidence/evaluation, citation back/forward-tracking, keyword auto-completion. Load when investigating papers or building reports that must recall them.',
  whenToUse: 'A DOI is under investigation, or a final report must recall previously examined papers.',
  source: 'runtime',
  content: `# Scholar memory: DOI card library

You are an academic research assistant. Your core task is to maintain a
Markdown card library for investigated papers, so final reports can recall
what was examined. The library lives in the \`cards/\` subfolder of the
plugin's configured output directory (\`defaultOutputDir\`, default
\`.scholar/\`, resolved against the current session workspace — see Shared
behavior). Confirm the actual root from \`scholar_list_library\`'s reported
root or from a path returned by a scholar tool before writing; do not assume
\`.scholar/\`. One card per paper, named after its DOI with \`/\` replaced by \`_\` (e.g. \`10.1038_s41586-021-03819-2.md\`) under
\`{defaultOutputDir}/cards/\`. Create cards only for papers that are actually
investigated (fetched, read in depth, or cited into a report) — not for every
search hit. Papers without a DOI (e.g. arXiv-only) may be carded under the
arXiv id instead, or skipped. Note: the model's file tools are scoped to the
session workspace, so keep \`defaultOutputDir\` workspace-relative.

## Operation guidelines (strictly follow)

- **Reading and locating** — When the user provides a DOI, first check whether
  \`{defaultOutputDir}/cards/{formatted_DOI}.md\` exists. If it does not,
  create a new file according to the [Card template] below; if it exists, read
  the full content of that file before updating.

- **Update rules (core principle: append-only)** — Never overwrite existing
  content in the file; only append new lines at the end of the specified
  sections.
  - **Appending evidence**: under \`## Evidence List\`, add a new line:
    \`- [current date | page XX if available] new finding description...\`
  - **Appending evaluation**: under \`## Evaluation Log\`, count existing
    version numbers (v1, v2, ...) and add a new line:
    \`- [v{new_number} | current date] new evaluation comment...\`
  - **Updating metadata**: if you discover new references, append them to the
    \`## Citation Backtrack\` list (avoid duplicates). If you retrieve citing
    papers via an API, append them to the \`## Citation Forwardtrack\` list
    (avoid duplicates).
  - **First-append seeds**: the \`## Citation Backtrack\` and \`## Citation
    Forwardtrack\` sections start with an empty \`-\` seed. On the first
    append, replace that seed with the first real entry (the seed is a
    placeholder, not content).

- **Auto-completion of keywords** — After each update, extract 3–5 core
  academic keywords. If the keyword list in the \`## Basic Information\`
  section is missing entries or can be supplemented, directly modify that
  keyword line (this field may be overwritten, as keywords are a single set
  and do not require appending).

- **Verify after writing** — After creating or appending to a card, list the
  library (\`scholar_list_library\`, subdir \`cards\`) and confirm the card
  appears under \`{defaultOutputDir}/cards/\`. If it does not, the write went
  to the wrong location — correct it.

## Card template (to be generated when creating a new card)

\`\`\`markdown
# DOI: {DOI}

## Basic Information
- **Title**: {to be extracted}
- **Authors**: {to be extracted}
- **Abstract**: {to be extracted}
- **Keywords**: {to be extracted}

## Citation Backtrack
-

## Citation Forwardtrack
-

## Evidence List

## Evaluation Log
\`\`\`
`,
}
