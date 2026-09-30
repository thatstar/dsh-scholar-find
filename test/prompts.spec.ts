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
  it('registers 30 tools', () => {
    expect(harness.tools).toHaveLength(30)
  })

  it('gives every description the full Use when / Not for / Returns skeleton', () => {
    for (const t of harness.tools) {
      expect(t.description, t.name).toContain('Use when:')
      expect(t.description, t.name).toContain('Not for:')
      expect(t.description, t.name).toContain('Returns:')
    }
  })

  it('keeps the resident tool surface within budget (see .notes/74, 77, 78)', () => {
    // L1 = everything the provider sends as the tool's `input_schema`: the tool
    // description plus EVERY nested parameter/item description (all of them are
    // prompt cost, so the walk is recursive). Measured 28,634 after the
    // .notes/74 cleanup + the .notes/75 review fixes (34,047 before the
    // cleanup); the guard stops the surface from silently growing back.
    //
    // Raised to 31,300 by .notes/77, which added the two `scholar_card_*` tools
    // (2,496 chars) so the memory lifecycle is executed by a tool instead of
    // re-derived by hand in every session. That trade is deliberate: the
    // ~2.5k resident chars buy back the work the model was silently skipping.
    // .notes/78 R2/R3 then moved the filter-operator semantics into the
    // catalog (the declared authority) and spent part of the saving on the
    // read-time card trigger, landing at 31,001 — so the guard tightened to
    // 31,100. R4–R12 closed three more gaps (unique_id in the evidence pack,
    // the three sibling readers named by sciverse_read_content, the card-recall
    // pointer on scholar_list_library) and trimmed ~200 chars of fat to pay for
    // them: net +91 for three real chain repairs, with ~3,000 chars removed
    // from the on-demand side in the same batch. Guard moved to 31,200 to match.
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
    expect(total).toBeLessThanOrEqual(31100)
    // A lower bound too: an empty/partial tool list must not pass the guard.
    expect(total).toBeGreaterThan(25000)
  })

  it('names the look-alike alternative in Not for where tools overlap', () => {
    // Crossrefs the model needs without loading a skill: S2 vs Sciverse search,
    // S2 graph vs Sciverse relations, the three body-text paths.
    expect(tool('scholar_search_papers').description).toContain('scholar_search_papers_by_snippet')
    // The two corpora must name each other (R11), not just live in the skill.
    expect(tool('scholar_search_papers').description).toContain('sciverse_search_papers')
    expect(tool('sciverse_search_papers').description).toContain('scholar_search_papers')
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
    // Trimmed to the operational essentials (R12 tail); the rules that must
    // survive are the operator set, precedence and the hard-requirement trap.
    const q = params('sciverse_search_papers').query?.description ?? ''
    expect(q).toContain('Boolean')
    expect(q).toContain('NOT > AND > OR')
    expect(q).toContain('EVERY term is required')
    expect(q).toContain('64 terms')
  })

  it('states the boost gating (query-only, ignored with a sort)', () => {
    expect(params('sciverse_search_papers').freshness_boost?.description).toContain('no sort is set')
    expect(params('sciverse_search_papers').language_affinity?.description ?? '').toMatch(/hard-?exclude/i)
  })

  it('routes filter semantics to the catalog instead of restating them (R2)', () => {
    // The operator set, the per-field applicable operators and the enum values
    // moved OUT of this description and INTO the runtime catalog, which is the
    // declared authority — restating them here cost resident chars and could
    // drift. The pointer is what must survive.
    const filters = params('sciverse_search_papers').filters_advanced?.description ?? ''
    expect(filters).toContain('`sciverse_list_catalog`')
    expect(filters).toMatch(/operator/i)
    expect(tool('sciverse_list_catalog').description).toContain('must match it exactly')
    // The catalog must promise what its render actually delivers (see the
    // render test in tools.spec.ts) — the two include_* params were no-ops.
    expect(tool('sciverse_list_catalog').description).toContain('applicable filter operators')
  })

  it('names the card tool on every reader — the trigger belongs at read time (R3)', () => {
    // .notes/78 NEW-2: zero tool descriptions mentioned `scholar_card_save`, so
    // the only trigger was a resident sentence and a skill body. A paper becomes
    // cardable at the moment it is READ, so the readers must say so.
    for (const name of ['sciverse_read_content', 'arxiv_get_fulltext', 'scholar_get_paper_snippets', 'paper_pdf2md']) {
      expect(tool(name).description, name).toContain('scholar_card_save')
    }
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
