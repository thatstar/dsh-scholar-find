/**
 * scholar-evidence-pack skill: verifiable per-claim citation packs for
 * grounding a draft or checking claims. The `## Output` section is the
 * extension point for output control — extend it here without touching the
 * other skills.
 */

export const SCHOLAR_EVIDENCE_PACK_SKILL = {
  name: 'scholar-evidence-pack',
  description:
    'Verifiable per-claim citation packs via sciverse_evidence_pack: semantic hits verified against full text, quotes verbatim. Load when grounding a draft or checking claims.',
  whenToUse: 'The user wants claims grounded with checkable quotes, or a draft fact-checked.',
  source: 'runtime',
  content: `# Scholar workflow: evidence pack

Verifiable per-claim citation packs for grounding a draft or checking claims.
Cross-tool rules stay in the system prompt's Shared behavior; per-tool
behavioral details live in the scholar-tools skill.

## Pipeline

Tool: sciverse_evidence_pack (per-claim semantic search plus full-text quote
verification; internal primitives S + X).

1. Split the draft or claim set into at most 5 claims per call; batch larger
   sets into several calls.
2. Call sciverse_evidence_pack with the claim batch.
3. Read each item's quote against its chunk offset; verify before use.

## Behavior

- Quotes are verbatim source text, never rewritten.
- Unverified items stay marked unverified — report them as such.
- Persist every investigated DOI as a card under \`{defaultOutputDir}/cards/\`, binding full-text quotes with provenance (see \`scholar-memory\`).

## Output

One pack per call: claim → matched quote + doc_id/chunk_id + offset +
verified status. Unverified claims are listed separately, never silently
dropped.`,
}
