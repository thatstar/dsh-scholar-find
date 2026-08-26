/**
 * Present S2 papers/authors as compact Markdown for the model, plus BibTeX
 * export from the `citationStyles` field.
 * @module dsh-scholar/s2-format
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
}

function doiOf(paper: PaperLike): string {
  return paper.externalIds?.DOI ?? ''
}

function firstAuthor(paper: PaperLike): string {
  const authors = paper.authors ?? []
  if (!authors.length) return ''
  const name = authors[0]?.name ?? ''
  return authors.length > 1 ? `${name} et al.` : name
}

/** Markdown summary table (# | Title | Year | Cites | First author | Venue). */
export function formatTable(papers: readonly PaperLike[], maxRows = 30): string {
  const rows = ['| # | Title | Year | Cites | First Author | Venue |', '|---|-------|------|-------|-------------|-------|']
  for (const [i, p] of papers.slice(0, maxRows).entries()) {
    rows.push(`| ${i + 1} | ${(p.title ?? '').slice(0, 80)} | ${p.year ?? ''} | ${p.citationCount ?? 0} | ${firstAuthor(p).slice(0, 25)} | ${(p.venue ?? '').slice(0, 30)} |`)
  }
  return rows.join('\n')
}

/** Per-paper detailed entries with TLDR/abstract fallback. */
export function formatDetails(papers: readonly PaperLike[], maxPapers = 10): string {
  const lines: string[] = []
  for (const [i, p] of papers.slice(0, maxPapers).entries()) {
    const authors = (p.authors ?? []).slice(0, 5).map((a) => a.name ?? '').join(', ')
    const authorsFull = (p.authors ?? []).length > 5 ? `${authors} et al.` : authors
    const doi = doiOf(p)
    const tldr = p.tldr?.text ?? ''
    const abstract = (p.abstract ?? '').slice(0, 300)
    const summary = tldr || (abstract.length ? `${abstract}${(p.abstract ?? '').length > 300 ? '...' : ''}` : '')
    lines.push(`### ${i + 1}. ${p.title ?? 'Untitled'} (${p.year ?? '?'})`)
    lines.push(`**Authors:** ${authorsFull || 'unknown'}`)
    lines.push(doi ? `**Citations:** ${p.citationCount ?? 0} | **DOI:** ${doi}` : `**Citations:** ${p.citationCount ?? 0}`)
    if (summary) lines.push(`**Summary:** ${summary}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** Combined header + summary table + top-N details. */
export function formatResults(papers: readonly PaperLike[], queryDesc = ''): string {
  const header = queryDesc ? `## Search Results: ${queryDesc}\n\n**${papers.length} papers found.**\n` : `**${papers.length} papers found.**\n`
  return `${header}\n${formatTable(papers)}\n\n---\n\n${formatDetails(papers)}`
}

/** Author table (name, affiliations, papers, citations, h-index). */
export function formatAuthors(authors: readonly { name?: string; affiliations?: readonly string[]; paperCount?: number; citationCount?: number; hIndex?: number }[], maxRows = 20): string {
  const rows = ['| # | Name | Affiliations | Papers | Citations | h-index |', '|---|------|-------------|--------|-----------|---------|']
  for (const [i, a] of authors.slice(0, maxRows).entries()) {
    rows.push(`| ${i + 1} | ${(a.name ?? '').slice(0, 40)} | ${(a.affiliations ?? []).join(', ').slice(0, 40)} | ${a.paperCount ?? 0} | ${a.citationCount ?? 0} | ${a.hIndex ?? 0} |`)
  }
  return rows.join('\n')
}

/** BibTeX concatenation; requires the `citationStyles` field on every paper. */
export function exportBibtex(papers: readonly PaperLike[]): string {
  return papers
    .map((p) => p.citationStyles?.bibtex)
    .filter((b): b is string => Boolean(b))
    .join('\n\n')
}

/** Project papers to the compact model-facing shape used in tool results. */
export function compactPapers(papers: readonly PaperLike[]): JsonValue[] {
  return papers.map((p) => ({
    paperId: p.paperId,
    title: p.title,
    year: p.year,
    citationCount: p.citationCount,
    authors: (p.authors ?? []).map((a) => a.name),
    venue: p.venue,
    doi: doiOf(p) || undefined,
    tldr: p.tldr?.text,
  }) as unknown as JsonValue)
}