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
Cross-tool rules live in the scholar-tools skill's Shared behavior, as do the
per-tool behavioral details. **Load \`scholar-tools\` and \`scholar-memory\` first** —
the steps below assume both.

## Pipeline

Tool: sciverse_evidence_pack (per-claim semantic search plus full-text quote
verification; internal primitives S + X), K = scholar_card_save.

1. Split the draft or claim set into at most 5 claims per call; batch larger
   sets into several calls.
2. Call sciverse_evidence_pack with the claim batch.
3. Read each item's quote against its chunk offset; verify before use.
4. **K — card each verified source as you go**, not at the end: pass the
   \`doc_id\`, the \`offset\`, the verbatim \`quote\`, and the item's \`title\` as
   \`paperId\` — the pack carries no DOI (the endpoint serves a fixed hit shape),
   and K resolves the title itself. The pack is the answer; the card is what a
   later report recalls.

## Behavior

- Quotes are verbatim source text, never rewritten.
- Unverified items stay marked unverified — report them as such; do not card an unverified quote as evidence.
- A claim whose quote you could not verify is reported, never silently dropped.

## Output

One pack per call: claim → matched quote + doc_id/chunk_id + offset +
verified status. Unverified claims are listed separately, never silently
dropped. If the write-up carries a reference list, load \`scholar-citation-style\`
first.`,
}
