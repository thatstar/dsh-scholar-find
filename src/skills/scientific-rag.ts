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
rules stay in the system prompt's Shared behavior; per-tool behavioral details
live in the scholar-tools skill.

## Pipeline

Primitives: S = sciverse_semantic_search.

1. S(query) — retrieve passage chunks for the question.
2. Keep hits with score ≥ 0.6; discard weaker ones.
3. Answer with numbered citations; every statement traces to a cited chunk.

## Behavior

- One focused query per sub-question; extend context with sciverse_read_content when a chunk is truncated mid-argument.
- Pace sciverse calls (~30 requests/minute per endpoint).
- Persist every investigated DOI as a card under \`{defaultOutputDir}/cards/\` (see \`scholar-memory\`).

## Output

A direct answer with numbered citations; each number maps to a retrieved
chunk (doc_id + offset). Unsupported statements are omitted, not guessed.`,
}
