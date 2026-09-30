/**
 * scholar-memory skill: the persistent DOI card library — the plugin's working
 * memory. One Markdown card per INVESTIGATED paper under
 * `<defaultOutputDir>/cards/`, written at read time rather than report time.
 *
 * Since v0.2.0 the mechanical lifecycle (identity gate, citation population,
 * append-only merge, provenance format, filenames) belongs to
 * `scholar_card_save` / `scholar_card_list`. `.notes/78` R8 cut this skill back
 * to what a tool cannot enforce — when to card, what counts as evidence, how to
 * read a card honestly — because restating the tool's own behaviour was ~2/3 of
 * its body and drifted from it.
 */

export const SCHOLAR_MEMORY_SKILL = {
  name: 'scholar-memory',
  description:
    'Working memory for investigated papers: one persistent Markdown DOI card each under the output dir (cards/), written by scholar_card_save at read time (append-only, provenance-bound evidence, citation back/forward-tracking) and recalled by scholar_card_list before a report.',
  whenToUse: 'A DOI is under investigation, or a final report must recall previously examined papers.',
  source: 'runtime',
  content: `# Scholar memory: the DOI card library

The card library is your **working memory**: one Markdown card per paper you
actually investigated, under \`cards/\` in the plugin's output dir
(\`defaultOutputDir\`, default \`.scholar/\`, resolved against the session
workspace). A report recalls what was examined from these cards — which only
works if the card is written *while you investigate*.

Two tools own it: **\`scholar_card_save\`** (create/append) and
**\`scholar_card_list\`** (recall). They handle identity lookup, the header,
citation population, provenance formatting, the append-only merge and the
filename. What is left to you:

- **Card at read time, not report time.** Call \`scholar_card_save\` the moment a
  paper is fetched or read in depth, before the next one — never during the
  write-up, where the card is reconstructed from the conversation. Card only
  what you investigated; reading a paper again appends to its card.
- **Always pass \`expectedTitle\`.** On a mismatch the tool writes **nothing**
  (\`status: "refused"\`): re-resolve the id or ask the user, and never cite it. A
  card marked \`unverified\` means no source held that record.
- **The quote is the evidence.** Pass the verbatim \`quote\` with its \`docId\` /
  \`offset\` (or \`page\`). Never rephrase a source's words — a finding description
  without a quote is not evidence and is not written.
- **Never overwrite a card by hand.** The merge is append-only: only the
  \`- coverage:\` status line and the \`Keywords\` line are refreshed, and the tool
  does both. Use your file tools to read a card, not to edit one.
- **Check completeness before reporting.** \`scholar_card_list\` reports
  \`complete\` per card — both citation sections populated (entries, or an
  explicit "no citation data" line) and ≥1 provenance-bound evidence line. A
  \`not_indexed\` section means the graph has nothing for that record, not that
  the work cites nothing — never report it as a total.
- **Recall before you write.** Run \`scholar_card_list\` first and write from the
  cards it returns instead of re-deriving what you examined.

The tool keys and names every card (a DOI becomes \`10.1063_1.3506838.md\`, an
arXiv id \`arXiv_2402.08954.md\`); you never derive a path. Sections: Basic Information,
Citation Backtrack, Citation Forwardtrack, Evidence List, Evaluation Log.`,
}
