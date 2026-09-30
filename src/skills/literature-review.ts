/**
 * scholar-literature-review skill: survey / research-progress /
 * state-of-the-field pipeline over the Sciverse content chain. The `## Output`
 * section is the extension point for output control — extend it here without
 * touching the other skills.
 */

export const SCHOLAR_LITERATURE_REVIEW_SKILL = {
  name: 'scholar-literature-review',
  description:
    'Survey / research-progress / state-of-the-field reviews over the Sciverse content chain: semantic retrieval, full-text verification, claim-bound writing. Load before writing any literature review.',
  whenToUse: 'The user asks for a survey, research progress, or the state of a field.',
  source: 'runtime',
  content: `# Scholar workflow: literature review

Survey / research-progress / state-of-the-field requests, answered from the
Sciverse content chain. Cross-tool rules (error envelope, pacing, library
directory) live in the scholar-tools skill's Shared behavior, as do the
per-tool behavioral details. **Load \`scholar-tools\` and \`scholar-memory\`
first** — the steps below assume both.

## Pipeline

Primitives: S = sciverse_semantic_search, X = sciverse_read_content,
K = scholar_card_save.

1. S(query, top_k=20) — retrieve passage chunks for the survey topic.
2. X around each high-score hit — extend context to verify before citing. Read
   the works you will actually cite, not every hit: past ~10 papers, prefer
   another S query over more reads.
3. **K — card the paper NOW**, before reading the next one. A RAG hit carries
   \`title\` and \`doc_id\`, **not** a DOI (the endpoint returns a fixed shape),
   so pass the hit's \`title\` as \`paperId\` (K resolves it) with the same
   \`expectedTitle\`, plus the verbatim \`quote\` and its \`docId\`/\`offset\`.
   Carding at report time is too late — the card is the record of the
   investigation, not a write-up artifact.
4. Write the review with every claim bound to [doc_id + quote + offset].

## Behavior

- Keep semantic hits with score ≥ 0.6; below that, widen the query instead of citing.
- Pace sciverse calls (~30 requests/minute per endpoint); batch reads where possible.
- \`scholar_card_save\` refuses an id whose title does not match \`expectedTitle\` — on \`refused\`, re-resolve the id with \`scholar_match_title\` and never cite it.
- Before writing the review, recall with \`scholar_card_list\` and write from the cards rather than re-deriving from the conversation.

## Output

A structured review in which every claim carries its [doc_id + quote + offset]
binding. No claim without a binding; quotes verbatim, never rewritten. If the
review carries a reference list, load \`scholar-citation-style\` first.`,
}
