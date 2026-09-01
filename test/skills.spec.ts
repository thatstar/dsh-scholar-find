import { describe, expect, it } from 'vitest'
import { SCHOLAR_INSTRUCTIONS } from '../src/instructions.js'
import { SCHOLAR_SKILLS } from '../src/skills/index.js'

/** All 27 registered tool names (src/tools/register.ts). */
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
  it('registers exactly the six expected skills with unique names', () => {
    expect(SCHOLAR_SKILLS).toHaveLength(6)
    expect(new Set(SCHOLAR_SKILLS.map(skill => skill.name)).size).toBe(6)
    expect([...byName.keys()].sort()).toEqual(
      ['scholar-evidence-pack', 'scholar-literature-review', 'scholar-scientific-rag', 'scholar-systematic-screen', 'scholar-tools', 'scholar-trend-scan'].sort(),
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
})

describe('scholar-tools catalog (selection-bias invariants)', () => {
  const catalog = byName.get('scholar-tools')!

  it('names every one of the 27 tools', () => {
    for (const tool of TOOL_NAMES) {
      expect(catalog.content).toContain(`- ${tool}:`)
    }
  })

  it('gives every tool the standardized Limitations / Exceptions / Prefer-when entries', () => {
    expect((catalog.content.match(/  - Limitations:/g) ?? []).length).toBe(TOOL_NAMES.length)
    expect((catalog.content.match(/  - Exceptions:/g) ?? []).length).toBe(TOOL_NAMES.length)
    expect((catalog.content.match(/  - Prefer when:/g) ?? []).length).toBe(TOOL_NAMES.length)
  })

  it('covers exactly the four tool families', () => {
    expect(catalog.content).toContain('## scholar_search_*')
    expect(catalog.content).toContain('## paper_fetch_*')
    expect(catalog.content).toContain('## arxiv_*')
    expect(catalog.content).toContain('## sciverse_*')
  })

  it('carries no parameter rosters — schemas are the only parameter source', () => {
    expect(catalog.content).not.toContain('Parameters:')
  })

  it('carries no workflow recipes — those live in the per-workflow skills', () => {
    expect(catalog.content).not.toContain('## Workflow recipes')
    expect(catalog.content).not.toContain('## Pipeline')
  })
})

describe('workflow skills (output-control extension points)', () => {
  it('registers exactly the five workflow skills', () => {
    expect(SCHOLAR_SKILLS.filter(skill => skill.name !== 'scholar-tools').map(skill => skill.name).sort())
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
})

describe('resident instructions (slim core invariants)', () => {
  it('lists every one of the 27 tools at selection level', () => {
    for (const tool of TOOL_NAMES) {
      expect(SCHOLAR_INSTRUCTIONS).toContain(`- ${tool}:`)
    }
  })

  it('routes to all six on-demand skills by name', () => {
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
    expect(SCHOLAR_INSTRUCTIONS).toContain('Settings → Plugins → Plugin configuration')
  })
})
