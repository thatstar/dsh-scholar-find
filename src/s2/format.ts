/**
 * Present S2 papers/authors as compact Markdown for the model, plus BibTeX
 * export from the `citationStyles` field.
 * @module dsh-scholar-find/s2-format
 */

/** Lossless JSON value (matches the DSH tool-output contract). */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

interface PaperLike {
  title?: string
  year?: number | string
  citationCount?: number
  authors?: readonly { name?: string }[]
  venue?: string
  externalIds?: Record<string, string | undefined>
  tldr?: { text?: string }
  abstract?: string
  paperId?: string
  citationStyles?: { bibtex?: string }
  fieldsOfStudy?: readonly string[]
  isOpenAccess?: boolean
  publicationTypes?: readonly string[]
}

export function doiOfPaper(paper: PaperLike): string {
  return paper.externalIds?.DOI ?? ''
}

function firstAuthor(paper: PaperLike): string {
  const authors = paper.authors ?? []
  if (!authors.length) return ''
  const name = authors[0]?.name ?? ''
  return authors.length > 1 ? `${name} et al.` : name
}

/** Markdown summary table (# | Title | Year | Cites | First author | Venue | OA | Field). */
export function formatTable(papers: readonly PaperLike[], maxRows = 30): string {
  const rows = ['| # | Title | Year | Cites | First Author | Venue | OA | Field |', '|---|-------|------|-------|-------------|-------|----|-------|']
  for (const [i, p] of papers.slice(0, maxRows).entries()) {
    const oa = p.isOpenAccess === undefined ? '?' : p.isOpenAccess ? 'yes' : 'no'
    const field = (p.fieldsOfStudy ?? []).slice(0, 2).join('/')
    rows.push(`| ${i + 1} | ${(p.title ?? '').slice(0, 80)} | ${p.year ?? ''} | ${p.citationCount ?? 0} | ${firstAuthor(p).slice(0, 25)} | ${(p.venue ?? '').slice(0, 30)} | ${oa} | ${field.slice(0, 30)} |`)
  }
  return rows.join('\n')
}

/** Per-paper detailed entries with TLDR/abstract fallback. */
export function formatDetails(papers: readonly PaperLike[], maxPapers = 10): string {
  const lines: string[] = []
  for (const [i, p] of papers.slice(0, maxPapers).entries()) {
    const authors = (p.authors ?? []).slice(0, 5).map((a) => a.name ?? '').join(', ')
    const authorsFull = (p.authors ?? []).length > 5 ? `${authors} et al.` : authors
    const doi = doiOfPaper(p)
    const tldr = p.tldr?.text ?? ''
    const abstractFull = p.abstract ?? ''
    // The summary is the SHORT form (TLDR, else a 300-char abstract teaser);
    // the full abstract gets its own line below when the caller asked for it
    // (`scholar_get_paper` with includeAbstract — search rows never carry one).
    const summary = tldr || (abstractFull ? `${abstractFull.slice(0, 300)}${abstractFull.length > 300 ? '...' : ''}` : '')
    lines.push(`### ${i + 1}. ${p.title ?? 'Untitled'} (${p.year ?? '?'})`)
    lines.push(`**Authors:** ${authorsFull || 'unknown'}`)
    lines.push(doi ? `**Citations:** ${p.citationCount ?? 0} | **DOI:** ${doi}` : `**Citations:** ${p.citationCount ?? 0}`)
    // Venue / field-of-study / OA evidence so a hit can be triaged without
    // opening it (the model otherwise judges by title alone).
    const evidence = [
      p.venue ? `**Venue:** ${p.venue}` : '',
      p.fieldsOfStudy?.length ? `**Fields:** ${p.fieldsOfStudy.join(', ')}` : '',
      p.publicationTypes?.length ? `**Type:** ${p.publicationTypes.join(', ')}` : '',
      p.isOpenAccess === undefined ? '' : `**Open access:** ${p.isOpenAccess ? 'yes' : 'no'}`,
    ].filter(Boolean)
    if (evidence.length) lines.push(evidence.join(' | '))
    if (summary) lines.push(`**Summary:** ${summary}`)
    if (abstractFull) lines.push(`**Abstract:** ${abstractFull.slice(0, 1200)}${abstractFull.length > 1200 ? '...' : ''}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** Combined header + summary table + top-N details. */
export function formatResults(papers: readonly PaperLike[], queryDesc = ''): string {
  const header = queryDesc ? `## Search Results: ${queryDesc}\n\n**${papers.length} papers found.**\n` : `**${papers.length} papers found.**\n`
  // A list result is a POINTER, not a verified record: DOIs/paperIds copied out
  // of an enumeration table have resolved to unrelated papers in practice. Say
  // so once, here, so every list-producing tool carries the same caveat.
  const hasDoi = papers.some((p) => doiOfPaper(p))
  const caveat = hasDoi
    ? '\n> Identifiers below are **unverified**: confirm a DOI/paperId with `scholar_get_paper` (pass `expectedTitle`) or `scholar_match_title` before writing it into a card or citation.\n'
    : ''
  return `${header}${caveat}\n${formatTable(papers)}\n\n---\n\n${formatDetails(papers)}`
}

/** Author table (name, affiliations, papers, citations, h-index). */
export function formatAuthors(authors: readonly { name?: string; affiliations?: readonly string[]; paperCount?: number; citationCount?: number; hIndex?: number }[], maxRows = 20): string {
  const rows = ['| # | Name | Affiliations | Papers | Citations | h-index |', '|---|------|-------------|--------|-----------|---------|']
  for (const [i, a] of authors.slice(0, maxRows).entries()) {
    rows.push(`| ${i + 1} | ${(a.name ?? '').slice(0, 40)} | ${(a.affiliations ?? []).join(', ').slice(0, 40)} | ${a.paperCount ?? 0} | ${a.citationCount ?? 0} | ${a.hIndex ?? 0} |`)
  }
  return rows.join('\n')
}

/**
 * One BibTeX string per requested id, in the request order (`''` when that id
 * produced no entry — a null row or a record without `citationStyles.bibtex`).
 * Callers derive both "how many exported" and "which ids failed" from this one
 * projection, so the counts can never contradict the rendered text.
 */
export function bibtexEntries(papers: readonly (PaperLike | null | undefined)[]): string[] {
  return papers.map((p) => (typeof p?.citationStyles?.bibtex === 'string' ? p.citationStyles.bibtex : ''))
}

/** Project papers to the compact model-facing shape used in tool results. */
export function compactPapers(papers: readonly PaperLike[]): JsonValue[] {
  return papers.map((p) => ({
    paperId: p.paperId ?? null,
    title: p.title ?? null,
    year: p.year ?? null,
    citationCount: p.citationCount ?? 0,
    // Every element is a lossless string; empty/missing author names are dropped.
    authors: (p.authors ?? []).map((a) => a?.name ?? '').filter((n) => n !== ''),
    venue: p.venue ?? null,
    doi: doiOfPaper(p) || null,
    tldr: p.tldr?.text ?? null,
    // Present only when the caller requested it (get_paper with includeAbstract).
    ...(typeof p.abstract === 'string' && p.abstract ? { abstract: p.abstract } : {}),
    fieldsOfStudy: (p.fieldsOfStudy ?? []).map((f) => String(f)),
    isOpenAccess: p.isOpenAccess ?? null,
    publicationTypes: (p.publicationTypes ?? []).map((f) => String(f)),
    // A list/search row is never a verified identity — see formatResults.
    verification: 'unverified',
  }) as JsonValue)
}