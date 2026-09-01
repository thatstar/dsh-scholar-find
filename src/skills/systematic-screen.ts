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
  content: `# Scholar workflow: systematic screening

PRISMA-style screening / include-exclude over the Sciverse corpus. Cross-tool
rules stay in the system prompt's Shared behavior; per-tool behavioral details
live in the scholar-tools skill.

## Pipeline

Primitives: C = sciverse_list_catalog, M = sciverse_search_papers,
S = sciverse_semantic_search.

1. C — confirm which fields and filters the collection supports.
2. M (broad: year + type, paginate) — build the candidate pool.
3. S — re-rank candidates against the inclusion criteria.
4. Include or exclude each candidate with a reason.
5. Report PRISMA counts.

## Behavior

- M hit totals cap at 10000 for large matched sets; narrow with field filters when precision matters.
- Keep S hits with score ≥ 0.6 for inclusion consideration.

## Output

PRISMA counts (identified / screened / excluded / included) plus the
per-candidate decision list; every exclusion carries its reason.`,
}
