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
directory) stay in the system prompt's Shared behavior; per-tool behavioral
details live in the scholar-tools skill.

## Pipeline

Primitives: S = sciverse_semantic_search, X = sciverse_read_content.

1. S(query, top_k=20) — retrieve passage chunks for the survey topic.
2. X around each high-score hit — extend context to verify before citing.
3. Write the review with every claim bound to [doc_id + quote + offset].

## Behavior

- Keep semantic hits with score ≥ 0.6; below that, widen the query instead of citing.
- Pace sciverse calls (~30 requests/minute per endpoint); batch reads where possible.
- Persist every investigated DOI as a card under \`{defaultOutputDir}/cards/\` (see \`scholar-memory\`).

## Output

A structured review in which every claim carries its [doc_id + quote + offset]
binding. No claim without a binding; quotes verbatim, never rewritten.`,
}
