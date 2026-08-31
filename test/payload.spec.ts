import { describe, expect, it } from 'vitest'
import { buildAgenticSearchPayload, buildMetaSearchPayload } from '../src/sciverse/payload.js'

describe('buildMetaSearchPayload', () => {
  it('passes through scalar args only when defined', () => {
    const p = buildMetaSearchPayload({ query: 'neural networks', page: 2, page_size: 25, collection: 'papers' })
    expect(p).toEqual({ query: 'neural networks', page: 2, page_size: 25, collection: 'papers' })
  })

  it('maps structured constraints to filters', () => {
    const p = buildMetaSearchPayload({
      title_contains: 'molecular dynamics',
      authors: ['A', 'B'],
      year_from: 2015,
      year_to: 2019,
      journals: ['Nature'],
      subjects: ['Chemistry'],
    })
    expect(p.filters).toEqual([
      { field: 'title', operator: 'FILTER_OP_CONTAINS', value: 'molecular dynamics' },
      { field: 'author', operator: 'FILTER_OP_IN', value: ['A', 'B'] },
      { field: 'publication_published_year', operator: 'FILTER_OP_GTE', value: 2015 },
      { field: 'publication_published_year', operator: 'FILTER_OP_LTE', value: 2019 },
      { field: 'publication_venue_name_unified', operator: 'FILTER_OP_IN', value: ['Nature'] },
      { field: 'subjects', operator: 'FILTER_OP_IN', value: ['Chemistry'] },
    ])
  })

  it('never emits an abstract filter (abstract is not filterable upstream)', () => {
    const p = buildMetaSearchPayload({ abstract_contains: 'x' })
    expect(p.filters).toBeUndefined()
    expect(p.abstract_contains).toBeUndefined()
  })

  it('passes filters_advanced through with the EQ operator default', () => {
    const p = buildMetaSearchPayload({
      filters_advanced: [
        { field: 'references_unique_id', value: 'paper:10.1109/cvpr.2016.90' },
        { field: 'publication_published_year', operator: 'FILTER_OP_GTE', value: 2023 },
      ],
    })
    expect(p.filters).toEqual([
      { field: 'references_unique_id', operator: 'FILTER_OP_EQ', value: 'paper:10.1109/cvpr.2016.90' },
      { field: 'publication_published_year', operator: 'FILTER_OP_GTE', value: 2023 },
    ])
  })

  it('auto sort: keyword query present → no sort (query and sort are mutually exclusive)', () => {
    const p = buildMetaSearchPayload({ query: 'graphene', year_from: 2020 })
    expect(p.sort).toBeUndefined()
  })

  it('auto sort: structured-only → year desc', () => {
    const p = buildMetaSearchPayload({ title_contains: 'x' })
    expect(p.sort).toEqual([{ field: 'publication_published_year', order: 'SORT_ORDER_DESC' }])
  })

  it('explicit sort_by_year asc plus sort_advanced passthrough', () => {
    const p = buildMetaSearchPayload({
      sort_by_year: 'asc',
      sort_advanced: [{ field: 'citation_count' }, { field: 'publication_published_date', order: 'SORT_ORDER_ASC' }],
    })
    expect(p.sort).toEqual([
      { field: 'publication_published_year', order: 'SORT_ORDER_ASC' },
      { field: 'citation_count', order: 'SORT_ORDER_DESC' },
      { field: 'publication_published_date', order: 'SORT_ORDER_ASC' },
    ])
  })

  it('sort_by_year none → no sort even without a query', () => {
    const p = buildMetaSearchPayload({ sort_by_year: 'none' })
    expect(p.sort).toBeUndefined()
  })
})

describe('buildAgenticSearchPayload', () => {
  it('maps mode fast to retrieval es', () => {
    expect(buildAgenticSearchPayload({ query: 'q', mode: 'fast', top_k: 5 })).toEqual({
      query: 'q',
      top_k: 5,
      retrieval: 'es',
    })
  })

  it('maps mode quality to hybrid + sub_queries 3', () => {
    expect(buildAgenticSearchPayload({ query: 'q', mode: 'quality' })).toEqual({
      query: 'q',
      retrieval: 'hybrid',
      sub_queries: 3,
    })
  })

  it('strips undefined keys and passes filters through', () => {
    const p = buildAgenticSearchPayload({ query: 'q', mode: 'balanced', top_k: undefined, filters: { lang: 'en' } })
    expect(p).toEqual({ query: 'q', retrieval: 'hybrid', filters: { lang: 'en' } })
  })

  it('explicit retrieval / sub_queries override the mode map', () => {
    expect(buildAgenticSearchPayload({ query: 'q', mode: 'fast', retrieval: 'hybrid' })).toEqual({
      query: 'q',
      retrieval: 'hybrid',
    })
  })

  it('rejects unknown modes', () => {
    expect(() => buildAgenticSearchPayload({ query: 'q', mode: 'bogus' })).toThrow(/mode must be one of/)
  })

  it('no mode → clean passthrough', () => {
    expect(buildAgenticSearchPayload({ query: 'q' })).toEqual({ query: 'q' })
  })
})
