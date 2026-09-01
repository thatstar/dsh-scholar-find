/**
 * scholar-trend-scan skill: per-year publication counts, top-cited papers,
 * and venues for a topic. The `## Output` section is the extension point for
 * output control — extend it here without touching the other skills.
 */

export const SCHOLAR_TREND_SCAN_SKILL = {
  name: 'scholar-trend-scan',
  description:
    'Per-year publication counts, top-cited papers, and venues for a topic via sciverse_trend_scan (s2 default; OpenAlex-topic-scoped option). Load for field trends, hotness, or bibliometric counts.',
  whenToUse: 'The user asks for field trends, hotness, per-year counts, or top-cited papers.',
  content: `# Scholar workflow: trend scan

Per-year publication counts, top-cited papers, and venues for a topic.
Cross-tool rules stay in the system prompt's Shared behavior; per-tool
behavioral details live in the scholar-tools skill.

## Pipeline

Tool: sciverse_trend_scan.

1. Default source:"s2" — real Semantic Scholar counts and citations; pass
   boolean components for precision.
2. source:"sciverse" — OpenAlex-topic-scoped meta-search; pass topic_id.
3. On code:"topic_ambiguous", ask the user with the returned top-5 candidate
   topics, then re-run with the chosen topic_id.

## Behavior

- sciverse-source counts are exact only below the 10000 matched-set cap.
- Report which source produced the numbers; never mix sources silently.

## Output

A per-year counts table plus the in-topic top-cited list and venues, labeled
with the source used (s2, or sciverse + topic).`,
}
