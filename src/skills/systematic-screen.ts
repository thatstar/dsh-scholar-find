/**
 * scholar-systematic-screen skill: PRISMA-style screening / include-exclude
 * over the Sciverse corpus. The `## Output` section is the extension point
 * for output control — extend it here without touching the other skills.
 */

export const SCHOLAR_SYSTEMATIC_SCREEN_SKILL = {
  name: 'scholar-systematic-screen',
  description:
    'PRISMA-style systematic screening: field catalog, broad structured search, semantic re-ranking, include/exclude with reasons, PRISMA counts. Load for screening, inclusion/exclusion, or review-protocol tasks.',
  whenToUse: 'The user asks for systematic screening, inclusion/exclusion, or a review protocol.',
  source: 'runtime',
  content: `# Scholar workflow: systematic screening

PRISMA-style screening / include-exclude over the Sciverse corpus. Cross-tool
rules live in the scholar-tools skill's Shared behavior, as do the per-tool
behavioral details. **Load \`scholar-tools\` and \`scholar-memory\` first** —
the steps below assume both.

## Pipeline

Primitives: C = sciverse_list_catalog, M = sciverse_search_papers,
S = sciverse_semantic_search, K = scholar_card_save.

1. C — confirm which fields and filters the collection supports.
2. M (broad: year + type) — build the candidate pool. Paginate until the pool
   covers the period or reaches your screening budget (state the budget); stop
   before the 10000 window ceiling, which is a hard rejection, not a clamp.
3. S — re-rank the pool against the inclusion criteria, **scoped to it**:
   \`S(query, filters.doc_id=[M's doc_ids])\`. \`doc_id\` is the only HARD scope
   (≤1000) — without it S is an independent search, not a re-rank, and the pool
   you built is ignored.
4. Include or exclude each candidate with a reason.
5. **K — card each candidate you actually read full-text**, immediately after
   the read and before the next candidate: pass the \`unique_id\` M returned (a
   \`paper:<doi>\`, which K accepts) or the title as \`paperId\`. Screening by
   title/abstract alone does not warrant a card; every title/abstract screen that
   you took to full text does.
6. Report PRISMA counts.

## Behavior

- M hit totals cap at 10000 for large matched sets; narrow with field filters when precision matters.
- Keep S hits with score ≥ 0.6 for inclusion consideration.
- Card the paper, not the decision: the decision list is the output, the card is the evidence behind it.

## Output

PRISMA counts (identified / screened / excluded / included) plus the
per-candidate decision list; every exclusion carries its reason. If the write-up
carries a reference list, load \`scholar-citation-style\` first.`,
}
