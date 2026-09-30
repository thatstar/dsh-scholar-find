import { describe, expect, it } from 'vitest'
import { SCHOLAR_INSTRUCTIONS, SCHOLAR_INSTRUCTIONS_FALLBACK } from '../src/instructions.js'
import { SCHOLAR_SKILLS } from '../src/skills/index.js'

/** All 30 registered tool names (src/tools/register.ts). */
const TOOL_NAMES = [
  'scholar_search_papers',
  'scholar_search_papers_by_snippet',
  'scholar_match_title',
  'scholar_get_paper',
  'scholar_get_paper_snippets',
  'scholar_get_citations',
  'scholar_get_references',
  'scholar_get_recommendations',
  'scholar_search_authors',
  'scholar_get_author',
  'scholar_get_author_papers',
  'scholar_export_bibtex',
  'scholar_card_save',
  'scholar_card_list',
  'paper_fetch_resolve',
  'paper_fetch_download',
  'paper_fetch_batch',
  'paper_fetch_library',
  'paper_pdf2md',
  'scholar_list_library',
  'arxiv_get_fulltext',
  'sciverse_list_catalog',
  'sciverse_search_papers',
  'sciverse_semantic_search',
  'sciverse_list_paper_relations',
  'sciverse_read_content',
  'sciverse_get_resource',
  'sciverse_trend_scan',
  'sciverse_evidence_pack',
  'scholar_format_references',
]

const WORKFLOW_SKILL_NAMES = [
  'scholar-literature-review',
  'scholar-scientific-rag',
  'scholar-systematic-screen',
  'scholar-evidence-pack',
  'scholar-trend-scan',
]

const byName = new Map(SCHOLAR_SKILLS.map(skill => [skill.name, skill]))

describe('scholar skills registry shape', () => {
  it('registers exactly the eight expected skills with unique names', () => {
    expect(SCHOLAR_SKILLS).toHaveLength(8)
    expect(new Set(SCHOLAR_SKILLS.map(skill => skill.name)).size).toBe(8)
    expect([...byName.keys()].sort()).toEqual(
      ['scholar-citation-style', 'scholar-evidence-pack', 'scholar-literature-review', 'scholar-memory', 'scholar-scientific-rag', 'scholar-systematic-screen', 'scholar-tools', 'scholar-trend-scan'].sort(),
    )
  })

  it('prefixes every skill name with scholar- to avoid catalog collisions', () => {
    for (const skill of SCHOLAR_SKILLS) {
      expect(skill.name.startsWith('scholar-')).toBe(true)
      expect(skill.name).toMatch(/^scholar-[a-z-]+$/)
    }
  })

  it('keeps every catalog description within the 500-char cap', () => {
    for (const skill of SCHOLAR_SKILLS) {
      expect(skill.description.length, skill.name).toBeLessThanOrEqual(500)
      expect(skill.description.length, skill.name).toBeGreaterThan(0)
      expect(skill.whenToUse.length, skill.name).toBeGreaterThan(0)
    }
  })

  it('carries a string source on every skill — the DSH validateDefinition contract', () => {
    for (const skill of SCHOLAR_SKILLS) {
      expect(typeof skill.source, skill.name).toBe('string')
      expect(skill.source.length, skill.name).toBeGreaterThan(0)
      // All seven are runtime registrations; DSH's registry requires the source
      // bucket and rejects undefined at load time (see .notes/62).
      expect(skill.source, skill.name).toBe('runtime')
    }
  })
})

describe('scholar-tools routing map (selection-bias invariants)', () => {
  const catalog = byName.get('scholar-tools')!

  it('names every one of the 30 tools (word-boundary, so siblings cannot mask a gap)', () => {
    for (const tool of TOOL_NAMES) {
      // A plain toContain would let `scholar_get_paper` be satisfied by
      // `scholar_get_paper_snippets`, so require a non-identifier character after.
      const pattern = new RegExp(tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?!\\w)')
      expect(catalog.content, tool).toMatch(pattern)
    }
  })

  it('routes the look-alike groups instead of restating per-tool behavior', () => {
    // The per-call Limitations/Exceptions roster moved into the tool
    // descriptions (see .notes/74) — the skill keeps only cross-tool policy.
    expect(catalog.content).toContain('## Routing (which tool for which job)')
    expect(catalog.content).not.toContain('  - Limitations:')
    expect(catalog.content).not.toContain('  - Exceptions:')
    expect(catalog.content).not.toContain('  - Prefer when:')
    for (const group of ['Discovery', 'Reading', 'Citations', 'Authors', 'Acquisition', 'Writing', 'Aggregates']) {
      expect(catalog.content, group).toContain(group)
    }
  })

  it('stays lean: the on-demand cross-tool policy is a single small load', () => {
    expect(catalog.content.length).toBeLessThan(6000)
  })

  it('carries no parameter rosters — schemas are the only parameter source', () => {
    expect(catalog.content).not.toContain('Parameters:')
  })

  it('documents the citation/reference coverage verdicts', () => {
    expect(catalog.content).toContain('not_indexed')
    expect(catalog.content).toContain('coverage` (complete/truncated/partial/not_indexed/empty)')
  })

  it('carries no workflow recipes — those live in the per-workflow skills', () => {
    expect(catalog.content).not.toContain('## Workflow recipes')
    expect(catalog.content).not.toContain('## Pipeline')
  })
})

describe('workflow skills (output-control extension points)', () => {
  it('registers exactly the five workflow skills', () => {
    const nonWorkflow = new Set(['scholar-tools', 'scholar-memory', 'scholar-citation-style'])
    expect(SCHOLAR_SKILLS.filter(skill => !nonWorkflow.has(skill.name)).map(skill => skill.name).sort())
      .toEqual([...WORKFLOW_SKILL_NAMES].sort())
  })

  it('gives every workflow skill a Pipeline / Behavior / Output structure', () => {
    for (const name of WORKFLOW_SKILL_NAMES) {
      const content = byName.get(name)!.content
      expect(content, name).toContain('## Pipeline')
      expect(content, name).toContain('## Behavior')
      expect(content, name).toContain('## Output')
    }
  })

  it('keeps each workflow skill lean (single-load budget under 2k chars)', () => {
    for (const name of WORKFLOW_SKILL_NAMES) {
      expect(byName.get(name)!.content.length, name).toBeLessThan(2000)
    }
  })

  it('cards investigated papers inside the Pipeline — write-time, not report-time', () => {
    // The defect this pins (.notes/77): the card instruction used to sit in
    // `## Behavior` as "Persist every investigated DOI as a card", which the
    // model executed as report-time cleanup over the papers that survived into
    // the report. The step now lives in the numbered Pipeline, at read time.
    // trend-scan only lists top-cited papers (never examines them), so it is
    // deliberately excluded — cards are for investigated papers only.
    for (const name of WORKFLOW_SKILL_NAMES.filter((n) => n !== 'scholar-trend-scan')) {
      const content = byName.get(name)!.content
      const pipeline = content.slice(content.indexOf('## Pipeline'), content.indexOf('## Behavior'))
      expect(pipeline, name).toContain('scholar_card_save')
      expect(content, name).toContain('scholar-memory')
      // The old deferral wording must not creep back.
      expect(content, name).not.toContain('Persist every investigated DOI')
    }
    expect(byName.get('scholar-trend-scan')!.content).not.toContain('scholar_card_save')
  })
})

describe('scholar-memory (DOI card library invariants)', () => {
  const memory = byName.get('scholar-memory')!

  it('targets the dynamic cards/ subfolder under the plugin output dir', () => {
    expect(memory.content).toContain('`cards/`')
    expect(memory.content).toContain('`defaultOutputDir`')
    expect(memory.content).toContain('`.scholar/`')
  })

  it('names the tool-derived filename rule without re-teaching it (.notes/78 R8)', () => {
    // The slug algorithm moved into the tool; the skill only needs to say the
    // tool owns the name and show what one looks like.
    expect(memory.content).toContain('keys and names every card')
    expect(memory.content).toContain('`10.1063_1.3506838.md`')
    expect(memory.content).toContain('`arXiv_2402.08954.md`')
    expect(memory.content).toContain('you never derive a path')
  })

  it('no longer tells the model to derive or fetch a card path (R7)', () => {
    // `scholar_card_save` owns the path; `scholar_get_paper` stopped reporting it.
    expect(memory.content).toContain('you never derive a path')
    expect(memory.content).not.toContain('cardPath')
  })

  it('lists the card sections it may read back, and the append-only core', () => {
    expect(memory.content).toContain('Never overwrite')
    expect(memory.content).toContain('append-only')
    for (const section of ['Evidence List', 'Evaluation Log', 'Citation Backtrack', 'Citation Forwardtrack', 'Basic Information']) {
      expect(memory.content, section).toContain(section)
    }
  })

  it('binds evidence to a verbatim quote with provenance', () => {
    expect(memory.content).toContain('verbatim')
    expect(memory.content).toContain('Never rephrase')
    expect(memory.content).toContain('is not evidence')
    expect(memory.content).toContain('`docId`')
    expect(memory.content).toContain('`offset`')
  })

  it('leaves citation population to the tool but keeps the completeness check', () => {
    // The two citation sections are the tool's job now; what the model must
    // still know is that completeness depends on them and how to check.
    expect(memory.content).toContain('scholar_card_list')
    expect(memory.content).toContain('`complete`')
    expect(memory.content).toContain('no citation data')
    expect(memory.content).toContain('provenance-bound evidence line')
  })

  it('hands the mechanical lifecycle to the tools and keeps only the discipline', () => {
    // .notes/77: the hand-authored lifecycle (template + two citation calls +
    // provenance formatting) was skipped or deferred twice in real use, so the
    // tools own it now. .notes/78 R8 then cut the skill back to what a tool
    // CANNOT enforce — it had been restating the tool's behaviour at ~2/3 of
    // its length, which is also how the two drift apart.
    expect(memory.content).toContain('scholar_card_save')
    expect(memory.content).toContain('scholar_card_list')
    expect(memory.content).toContain('Card at read time, not report time')
    expect(memory.content).toContain('Recall before you write')
    expect(memory.content).toContain('expectedTitle')
    expect(memory.content).toContain('a finding description')
    // The old escape hatch let the model defer to report time by treating a
    // cited paper as an investigated one.
    expect(memory.content).not.toContain('or cited into a report')
    // And the restated tool internals must not creep back.
    expect(memory.content).not.toContain('## Card template')
    expect(memory.content).not.toContain('[doc_id | offset | page if available]')
  })

  it('stays a small load: the discipline only, not the tool implementation (5,393 -> under 2,500, less than half)', () => {
    expect(memory.content.length).toBeLessThan(2500)
  })

  it('reads a coverage verdict honestly (not_indexed is not "cites nothing")', () => {
    expect(memory.content).toContain('not_indexed')
    expect(memory.content).toContain('never report it as a total')
  })

  it('is triggered by DOIs and report recall', () => {
    expect(memory.whenToUse).toContain('DOI')
    expect(memory.whenToUse).toContain('report')
  })
})

describe('scholar-citation-style (bibliography contract)', () => {
  const style = byName.get('scholar-citation-style')!

  it('targets footnote markers and blank-line-separated definitions', () => {
    expect(style.content).toContain('[^n]')
    expect(style.content).toContain('[^n]: <full entry>')
    expect(style.content).toContain('blank line')
  })

  it('explains the renderer behaviour the rules come from', () => {
    expect(style.content).toContain('first-reference position')
    expect(style.content).toContain('one back-reference marker per entry')
    expect(style.content).toContain('never referenced is dropped')
    // The renderer no longer emits one marker per citation — the skill must not
    // claim it does (that text was written before the renderer fix).
    expect(style.content).not.toContain('one back-reference is emitted per rendered citation')
    expect(style.content).not.toContain('↩ ↩2')
  })

  it('forbids the invented marker form and marker restatement in tables', () => {
    expect(style.content).toContain('Never invent a marker form')
    expect(style.content).toContain('No markers in appendix/summary tables')
  })

  it('ships the style templates including GB/T 7714-2015', () => {
    for (const token of ['GB/T 7714-2015', 'APA 7', 'IEEE', 'Nature', 'BibTeX']) {
      expect(style.content, token).toContain(token)
    }
    expect(style.content).toContain('[J]')
  })

  it('covers Chinese-report punctuation', () => {
    expect(style.content).toContain('full-width')
    expect(style.content).toContain('ASCII superscript')
  })
})

describe('resident instructions (one-sentence pointer + skill-carried detail)', () => {
  it('stays a single sentence: no roster, no per-tool Limitations/Exceptions, no recipes', () => {
    expect(SCHOLAR_INSTRUCTIONS).not.toContain('\n')
    expect(SCHOLAR_INSTRUCTIONS.endsWith('.')).toBe(true)
    expect(SCHOLAR_INSTRUCTIONS).not.toContain('  - Limitations:')
    expect(SCHOLAR_INSTRUCTIONS).not.toContain('## Pipeline')
    expect(SCHOLAR_INSTRUCTIONS).not.toContain('## Workflow recipes')
    expect(SCHOLAR_INSTRUCTIONS).not.toContain('## Shared behavior')
    for (const tool of TOOL_NAMES) {
      expect(SCHOLAR_INSTRUCTIONS).not.toContain(`- ${tool}:`)
    }
  })

  it('names the tool families and points at the skill catalog as the only place the rules live', () => {
    expect(SCHOLAR_INSTRUCTIONS).toContain('scholar_search_*')
    expect(SCHOLAR_INSTRUCTIONS).toContain('paper_fetch_*')
    expect(SCHOLAR_INSTRUCTIONS).toContain('arxiv_*')
    expect(SCHOLAR_INSTRUCTIONS).toContain('sciverse_*')
    expect(SCHOLAR_INSTRUCTIONS).toContain('scholar_card_*')
    expect(SCHOLAR_INSTRUCTIONS).toContain('`skill` tool')
    expect(SCHOLAR_INSTRUCTIONS).toContain('scholar-*')
  })

  it('carries the read-time carding hook — the one rule that cannot wait for a skill load', () => {
    // The reported defect (.notes/77) was a card written at report time rather
    // than at read time. The workflow skills carry the full contract, but this
    // is the reminder that has to survive even when no skill is loaded.
    expect(SCHOLAR_INSTRUCTIONS).toContain('scholar_card_save')
    expect(SCHOLAR_INSTRUCTIONS).toContain('as you read it')
  })

  it('keeps the fallback rulebook in step with the scholar-tools skill (R10)', () => {
    // The fallback (rendered only when the profile exposes no skills service) is
    // a near-clone of the Shared behavior section, and it had already drifted
    // twice: it lost the `next_offset` paging rule and still called
    // scholar_search_papers "the default discovery tool" while every workflow
    // enters from Sciverse. Nothing guarded it, because it is invisible to the
    // L1 budget walk. This pins rule coverage, not wording, so the two cannot
    // silently diverge again.
    const catalog = SCHOLAR_SKILLS.find((s) => s.name === 'scholar-tools')!.content
    // Shared behavior only — the routing map is deliberately NOT duplicated in
    // the fallback, and the sub-bullets of a split rule are not labels.
    const shared = catalog.slice(catalog.indexOf('## Shared behavior (cross-tool)'), catalog.indexOf('## Routing'))
    const labels = shared
      .split('\n')
      .filter((l) => l.startsWith('- '))
      .map((l) => /^- ([^:—]+)/.exec(l)?.[1]?.trim())
      .filter((l): l is string => Boolean(l))
    expect(labels.length).toBeGreaterThanOrEqual(8)
    for (const label of labels) {
      expect(SCHOLAR_INSTRUCTIONS_FALLBACK, label).toContain(`- ${label}`)
    }
    // The specific rule that drifted.
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain('next_offset')
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).not.toContain('the default discovery tool')
  })

  it('stays under a hard length guard', () => {
    // Guards against the section creeping back toward the ~6.5 kB it replaced
    // (measured: 456 chars, see .notes/71).
    expect(SCHOLAR_INSTRUCTIONS.length).toBeLessThan(600)
  })

  it('keeps the full rules in the fallback rendered only without a skills service', () => {
    for (const tool of TOOL_NAMES) {
      expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain(`- ${tool}:`)
    }
    for (const skill of SCHOLAR_SKILLS) {
      expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain(`\`${skill.name}\``)
    }
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain('## Shared behavior')
  })

  it('keeps the cross-tool behavioral floor in the fallback: error envelope, paths, keys, DOI hygiene, pacing', () => {
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain('Error envelope')
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain('retry_after_hours')
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain('never invent a DOI')
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain('~30 requests/minute')
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain('Never download or extract speculatively')
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain("Web UI's Plugins page")
  })
})

describe('cross-tool rules survive in the on-demand skill', () => {
  it('carries the Shared behavior rulebook in the scholar-tools skill', () => {
    const catalog = byName.get('scholar-tools')!
    expect(catalog.content).toContain('## Shared behavior (cross-tool)')
    expect(catalog.content).toContain('Error envelope')
    expect(catalog.content).toContain('retry_after_hours')
    expect(catalog.content).toContain('never invent a DOI')
    expect(catalog.content).toContain('~30 requests/minute')
    expect(catalog.content).toContain('Never download or extract speculatively')
    expect(catalog.content).toContain("Web UI's Plugins page")
  })
})

describe('sciverse failure handling (typed envelope + content fallbacks)', () => {
  it('names the typed sciverse error codes in the skill-carried Shared behavior', () => {
    const catalog = byName.get('scholar-tools')!
    expect(catalog.content).toContain('content_not_found')
    expect(catalog.content).toContain('content_fetch_failed')
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain('content_not_found')
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain('content_fetch_failed')
  })

  it('carries the ranked content chain with the Asta step and alt_doc_ids recovery', () => {
    const catalog = byName.get('scholar-tools')!
    expect(catalog.content).toContain('scholar_get_paper_snippets')
    expect(catalog.content).toContain('alt_doc_ids')
    expect(catalog.content).toContain('doc_id_index')
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain('scholar_get_paper_snippets')
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain('alt_doc_ids')
    expect(SCHOLAR_INSTRUCTIONS_FALLBACK).toContain('doc_id_index')
  })

  it('catalog documents the doc_id alternates on the content tools', () => {
    const catalog = byName.get('scholar-tools')!
    expect(catalog.content).toContain('alt_doc_ids')
    expect(catalog.content).toContain('doc_id_index')
  })
})
