import { describe, expect, it } from 'vitest'
import { SCHOLAR_INSTRUCTIONS } from '../src/instructions.js'
import { SCHOLAR_SKILLS } from '../src/skills/index.js'

/** All 28 registered tool names (src/tools/register.ts). */
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

describe('scholar-tools catalog (selection-bias invariants)', () => {
  const catalog = byName.get('scholar-tools')!

  it('names every one of the 28 tools', () => {
    for (const tool of TOOL_NAMES) {
      expect(catalog.content).toContain(`- ${tool}:`)
    }
  })

  it('gives every tool the standardized Limitations / Exceptions / Prefer-when entries', () => {
    expect((catalog.content.match(/  - Limitations:/g) ?? []).length).toBe(TOOL_NAMES.length)
    expect((catalog.content.match(/  - Exceptions:/g) ?? []).length).toBe(TOOL_NAMES.length)
    expect((catalog.content.match(/  - Prefer when:/g) ?? []).length).toBe(TOOL_NAMES.length)
  })

  it('covers the tool families', () => {
    expect(catalog.content).toContain('## scholar_search_*')
    expect(catalog.content).toContain('## scholar_format_*')
    expect(catalog.content).toContain('## paper_fetch_*')
    expect(catalog.content).toContain('## arxiv_*')
    expect(catalog.content).toContain('## sciverse_*')
  })

  it('carries no parameter rosters — schemas are the only parameter source', () => {
    expect(catalog.content).not.toContain('Parameters:')
  })

  it('documents the citation/reference coverage verdicts', () => {
    expect(catalog.content).toContain('not_indexed')
    expect(catalog.content).toContain('coverage (complete/truncated/partial/not_indexed/empty)')
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

  it('hooks the investigating workflows to the card library (scholar-memory)', () => {
    // trend-scan only lists top-cited papers (never examines them), so it is
    // deliberately excluded — cards are for investigated papers only.
    for (const name of WORKFLOW_SKILL_NAMES.filter((n) => n !== 'scholar-trend-scan')) {
      const content = byName.get(name)!.content
      expect(content, name).toContain('Persist every investigated DOI as a card under `{defaultOutputDir}/cards/`, binding full-text quotes with provenance (see `scholar-memory`)')
    }
    expect(byName.get('scholar-trend-scan')!.content).not.toContain('Persist every investigated DOI')
  })
})

describe('scholar-memory (DOI card library invariants)', () => {
  const memory = byName.get('scholar-memory')!

  it('targets the dynamic cards/ subfolder under the plugin output dir', () => {
    expect(memory.content).toContain('`cards/`')
    expect(memory.content).toContain('`defaultOutputDir`')
    expect(memory.content).toContain('`.scholar/`')
  })

  it('documents the canonical card-filename slug (all unsafe characters)', () => {
    expect(memory.content).toContain('canonical slug')
    expect(memory.content).toContain('[A-Za-z0-9._-]')
    expect(memory.content).toContain('`10.1063_1.3506838.md`')
    expect(memory.content).toContain('`10.1103_jwmw-3lds.md`')
    expect(memory.content).toContain('`arXiv_2402.08954.md`')
  })

  it('points the model at the tool-supplied cardPath', () => {
    expect(memory.content).toContain('cardPath')
    expect(memory.content).toContain('scholar_get_paper')
  })

  it('carries the operation guidelines, append-only core, and the card template', () => {
    expect(memory.content).toContain('## Operation guidelines')
    expect(memory.content).toContain('Never overwrite')
    expect(memory.content).toContain('## Card template')
    expect(memory.content).toContain('## Evidence List')
    expect(memory.content).toContain('## Evaluation Log')
    expect(memory.content).toContain('## Citation Backtrack')
    expect(memory.content).toContain('## Citation Forwardtrack')
    expect(memory.content).toContain('## Basic Information')
  })

  it('resolves the Backtrack/Forwardtrack empty `-` seeds on first append', () => {
    expect(memory.content).toContain('First-append seeds')
    expect(memory.content).toContain('replace that seed with the first real entry')
  })

  it('binds evidence with full-text provenance (doc_id/offset/page + verbatim quote)', () => {
    expect(memory.content).toContain('provenance-bound, verbatim')
    expect(memory.content).toContain('[doc_id | offset | page if available]')
    expect(memory.content).toContain('never rephrased')
    expect(memory.content).toContain('sciverse_evidence_pack')
    expect(memory.content).toContain('arxiv:2402.08954')
  })

  it('mandates citation back/forward-track population at card creation', () => {
    expect(memory.content).toContain('Card lifecycle')
    expect(memory.content).toContain('Populate citations (mandatory)')
    expect(memory.content).toContain('scholar_get_references')
    expect(memory.content).toContain('scholar_get_citations')
    expect(memory.content).toContain('required, not optional')
    expect(memory.content).toContain('no citation data')
  })

  it('treats a card as complete only with populated citations and provenance-bound evidence', () => {
    expect(memory.content).toContain('A card is complete only when')
    expect(memory.content).toContain('at least one provenance-bound line')
  })

  it('requires the citation coverage label to be recorded verbatim', () => {
    expect(memory.content).toContain('coverage.label')
    expect(memory.content).toContain('not_indexed')
    expect(memory.content).toContain('never write it as a')
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

describe('resident instructions (slim core invariants)', () => {
  it('lists every one of the 28 tools at selection level', () => {
    for (const tool of TOOL_NAMES) {
      expect(SCHOLAR_INSTRUCTIONS).toContain(`- ${tool}:`)
    }
  })

  it('routes to all seven on-demand skills by name', () => {
    for (const skill of SCHOLAR_SKILLS) {
      expect(SCHOLAR_INSTRUCTIONS).toContain(`\`${skill.name}\``)
    }
  })

  it('defers detail to skills: no per-tool Limitations/Exceptions rosters and no recipes', () => {
    expect(SCHOLAR_INSTRUCTIONS).not.toContain('  - Limitations:')
    expect(SCHOLAR_INSTRUCTIONS).not.toContain('## Pipeline')
    expect(SCHOLAR_INSTRUCTIONS).not.toContain('## Workflow recipes')
  })

  it('keeps the cross-tool behavioral floor: error envelope, paths, keys, DOI hygiene, pacing', () => {
    expect(SCHOLAR_INSTRUCTIONS).toContain('Error envelope')
    expect(SCHOLAR_INSTRUCTIONS).toContain('retry_after_hours')
    expect(SCHOLAR_INSTRUCTIONS).toContain('never invent a DOI')
    expect(SCHOLAR_INSTRUCTIONS).toContain('~30 requests/minute')
    expect(SCHOLAR_INSTRUCTIONS).toContain('Never download or extract speculatively')
    expect(SCHOLAR_INSTRUCTIONS).toContain("Web UI's Plugins page")
  })
})

describe('sciverse failure handling (typed envelope + content fallbacks)', () => {
  it('names the typed sciverse error codes in the resident Shared behavior', () => {
    expect(SCHOLAR_INSTRUCTIONS).toContain('content_not_found')
    expect(SCHOLAR_INSTRUCTIONS).toContain('content_fetch_failed')
  })

  it('carries the ranked content chain with the Asta step and alt_doc_ids recovery', () => {
    expect(SCHOLAR_INSTRUCTIONS).toContain('scholar_get_paper_snippets')
    expect(SCHOLAR_INSTRUCTIONS).toContain('alt_doc_ids')
    expect(SCHOLAR_INSTRUCTIONS).toContain('doc_id_index')
  })

  it('catalog documents the doc_id alternates on the content tools', () => {
    const catalog = byName.get('scholar-tools')!
    expect(catalog.content).toContain('alt_doc_ids')
    expect(catalog.content).toContain('doc_id_index')
  })
})
