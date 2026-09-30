/**
 * scholar-scientific-rag skill: a question answered with quoted evidence from
 * the Sciverse corpus. The `## Output` section is the extension point for
 * output control — extend it here without touching the other skills.
 */

export const SCHOLAR_SCIENTIFIC_RAG_SKILL = {
  name: 'scholar-scientific-rag',
  description:
    'Answer a question with quoted evidence from the Sciverse corpus: semantic retrieval, score filtering, numbered citations. Load before answering scholarly questions that need sourced passages.',
  whenToUse: 'The user asks a scholarly question that should be answered with sourced passages.',
  source: 'runtime',
  content: `# Scholar workflow: scientific RAG

A question answered with quoted evidence from the Sciverse corpus. Cross-tool
rules live in the scholar-tools skill's Shared behavior, as do the per-tool
behavioral details. **Load \`scholar-tools\` and \`scholar-memory\` first** —
the steps below assume both.

## Pipeline

Primitives: S = sciverse_semantic_search, K = scholar_card_save.

1. S(query) — retrieve passage chunks for the question.
2. **K — card each paper you actually read**, right after reading it and before
   moving on: a RAG hit has a \`title\` but no DOI, so pass the \`title\` as
   \`paperId\` with the same \`expectedTitle\`, plus the verbatim \`quote\` with
   \`docId\`/\`offset\`.
3. Answer with numbered citations; every statement traces to a cited chunk.

## Behavior

- Keep hits with score ≥ 0.6; below that, widen the query rather than citing a weak hit.
- One focused query per sub-question; extend context with sciverse_read_content when a chunk is truncated mid-argument.
- Pace sciverse calls (~30 requests/minute per endpoint).
- Skip carding a chunk you only skimmed past — cards are for papers actually read; reading the same paper again appends to its existing card.

## Output

A direct answer with numbered citations; each number maps to a retrieved
chunk (doc_id + offset). Unsupported statements are omitted, not guessed. If the
answer carries a reference list, load \`scholar-citation-style\` first.`,
}
