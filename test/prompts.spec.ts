/**
 * Prompt-shape invariants (see .notes/73 — audit against the official Sciverse
 * MCP tool prompts).
 *
 * Tool descriptions are model-facing product surface: the model sees
 * name + description + parameters only (never `output.schema`), and every
 * description is resident on every request. These tests pin the shape the
 * audit established, so a later edit cannot silently drop the selection signal
 * or re-introduce a wrong API default.
 */
import { describe, expect, it } from 'vitest'
import { makeScholarContext, type CapturedTool } from './harness.js'

/** Parameters as the plugin declares them (description-bearing JSON schema). */
type Params = Record<string, { description?: string }>

function paramsOf(tool: CapturedTool): Params {
  return (tool.parameters.properties ?? {}) as Params
}

const harness = makeScholarContext()
const tool = (name: string): CapturedTool => {
  const t = harness.byName.get(name)
  if (!t) throw new Error(`no tool named ${name}`)
  return t
}
const params = (name: string): Params => paramsOf(tool(name))

describe('tool descriptions — shared skeleton', () => {
  it('registers 28 tools', () => {
    expect(harness.tools).toHaveLength(28)
  })

  it('gives every description the full Use when / Not for / Returns skeleton', () => {
    for (const t of harness.tools) {
      expect(t.description, t.name).toContain('Use when:')
      expect(t.description, t.name).toContain('Not for:')
      expect(t.description, t.name).toContain('Returns:')
    }
  })

  it('keeps the resident tool surface within budget (see .notes/74)', () => {
    // L1 = everything the provider sends as the tool's `input_schema`: the tool
    // description plus EVERY nested parameter/item description (all of them are
    // prompt cost, so the walk is recursive). Measured 28,279 after the
    // .notes/74 cleanup + the .notes/75 review fixes (34,047 before the
    // cleanup); the guard stops the surface from silently growing back.
    const surface = (node: unknown): number => {
      if (!node || typeof node !== 'object') return 0
      const schema = node as { description?: unknown; properties?: Record<string, unknown>; items?: unknown }
      let n = typeof schema.description === 'string' ? schema.description.length : 0
      if (schema.properties) for (const child of Object.values(schema.properties)) n += surface(child)
      if (schema.items) n += surface(schema.items)
      return n
    }
    const total = harness.tools.reduce(
      (sum, t) => sum + surface({ description: t.description, properties: t.parameters.properties }),
      0,
    )
    expect(total).toBeLessThanOrEqual(29000)
  })

  it('names the look-alike alternative in Not for where tools overlap', () => {
    // Crossrefs the model needs without loading a skill: S2 vs Sciverse search,
    // S2 graph vs Sciverse relations, the three body-text paths.
    expect(tool('scholar_search_papers').description).toContain('scholar_search_papers_by_snippet')
    expect(tool('scholar_get_citations').description).toContain('sciverse_list_paper_relations')
    expect(tool('sciverse_search_papers').description).toContain('sciverse_semantic_search')
    expect(tool('sciverse_semantic_search').description).toContain('sciverse_read_content')
    expect(tool('sciverse_read_content').description).toContain('sciverse_get_resource')
  })
})

describe('sciverse parameter semantics match the API docs', () => {
  it('documents the real page_size default (25), not the old "default 10"', () => {
    expect(params('sciverse_search_papers').page_size?.description).toContain('default 25')
    expect(params('sciverse_list_paper_relations').page_size?.description).toContain('default 25')
    expect(JSON.stringify(params('sciverse_search_papers'))).not.toContain('default 10')
    expect(JSON.stringify(params('sciverse_list_paper_relations'))).not.toContain('default 10')
  })

  it('spells out the read_content offset trap and the limit defaults', () => {
    expect(params('sciverse_read_content').offset?.description).toContain('WHOLE document')
    expect(params('sciverse_read_content').limit?.description).toContain('4096')
    expect(tool('sciverse_read_content').description).toContain('next_offset')
  })

  it('documents the doc_id hard scope and soft filters of semantic search', () => {
    const filters = params('sciverse_semantic_search').filters?.description ?? ''
    expect(filters).toContain('HARD scope')
    expect(filters).toContain('SCOPE_TOO_LARGE')
    expect(tool('sciverse_semantic_search').description).toContain('SOFT')
  })

  it('warns on sort_by_year that query + explicit sort degrades the query', () => {
    expect(params('sciverse_search_papers').sort_by_year?.description).toContain('degrades the query')
    expect(params('sciverse_search_papers').query?.description).toContain('Boolean syntax')
  })

  it('states the boost gating (query-only, ignored with a sort)', () => {
    expect(params('sciverse_search_papers').freshness_boost?.description).toContain('no sort is set')
    expect(params('sciverse_search_papers').language_affinity?.description ?? '').toMatch(/hard-?exclude/i)
  })

  it('requires catalog-exact field names and documents the operator set', () => {
    expect(params('sciverse_search_papers').filters_advanced?.description).toContain('MUST match `sciverse_list_catalog`')
    expect(tool('sciverse_list_catalog').description).toContain('must match it exactly')
  })

  it('documents the empty-title relation rows (OpenAlex ids are not resolvable)', () => {
    expect(tool('sciverse_list_paper_relations').description).toContain('EMPTY title')
    expect(tool('sciverse_list_paper_relations').description).toContain('openalex')
  })

  it('keeps the paging ceiling and the relation limits visible', () => {
    expect(tool('sciverse_search_papers').description).toContain('page * page_size = 10000')
    expect(tool('sciverse_list_paper_relations').description).toContain('400')
    expect(tool('sciverse_list_paper_relations').description).toContain('unique_id')
  })
})
