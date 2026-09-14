/**
 * Reference formatting (pure): turn paper metadata into a cited entry in a
 * declared style, plus the footnote-ready definition block.
 *
 * Finding 11 of the real-world report: the tools produced reference DATA but
 * gave no jurisdiction over citation FORMAT, so the model re-derived style,
 * marker form and punctuation per task (and got it wrong on the first pass).
 * Formatting decisions belong here, once.
 *
 * The emitted block follows the same contract as the `scholar-citation-style`
 * skill: `[^n]: entry` definitions separated by blank lines, numbered by
 * first-reference order (the DSH renderer numbers a footnote by its
 * first-reference position, so the literal digit must agree with it).
 * @module dsh-scholar-find/cite
 */

/** The citation styles this plugin can emit. */
export type CitationStyle = 'gb-t-7714-2015' | 'apa-7' | 'ieee' | 'nature' | 'bibtex'

export const CITATION_STYLES: readonly CitationStyle[] = ['gb-t-7714-2015', 'apa-7', 'ieee', 'nature', 'bibtex']

/** Reference type, used for the GB/T 7714 type marker. */
export type ReferenceType = 'journal' | 'book' | 'conference' | 'thesis' | 'preprint' | 'other'

/** The metadata one entry needs. Every field except `title` is optional. */
export interface ReferenceMeta {
  authors?: readonly string[]
  title?: string
  venue?: string
  year?: number | string
  volume?: string
  issue?: string
  pages?: string
  doi?: string
  url?: string
  type?: ReferenceType
  /** Pre-formatted BibTeX (from scholar_export_bibtex); used for the bibtex style. */
  bibtex?: string
}

/** A formatted entry: its 1-based footnote index and the rendered text. */
export interface FormattedReference {
  index: number
  style: CitationStyle
  text: string
}

/** GB/T 7714 type markers. */
const GB_TYPE_MARKER: Record<ReferenceType, string> = {
  journal: 'J',
  book: 'M',
  conference: 'C',
  thesis: 'D',
  preprint: 'EB/OL',
  other: 'Z',
}

function clean(s: string | undefined): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

/** Drop a trailing period so joins do not double punctuation. */
function trimTrailingPeriod(s: string): string {
  return s.replace(/\.\s*$/, '')
}

/** Terminate a sentence without doubling `?` / `!` / `.`. */
function sentence(s: string): string {
  const t = clean(s)
  return /[.?!]$/.test(t) ? t : `${t}.`
}

/** Page range normalized: S2 reports `357 - 362`, entries want `357-362`. */
function pagesOf(meta: ReferenceMeta): string {
  return clean(meta.pages).replace(/\s*[–—]\s*/g, '-').replace(/\s*-\s*/g, '-')
}

function yearOf(meta: ReferenceMeta): string {
  return clean(meta.year === undefined || meta.year === null ? '' : String(meta.year))
}

/** `Albert Einstein` -> `Einstein, A.`; a single token is left alone. */
export function apaAuthor(name: string): string {
  const parts = clean(name).split(' ').filter(Boolean)
  if (parts.length < 2) return parts[0] ?? ''
  const family = parts[parts.length - 1]!
  const initials = parts.slice(0, -1).map((p) => `${p[0]!.toUpperCase()}.`).join(' ')
  return `${family}, ${initials}`
}

/** `Albert Einstein` -> `A. Einstein` (IEEE order: initials first). */
export function ieeeAuthor(name: string): string {
  const parts = clean(name).split(' ').filter(Boolean)
  if (parts.length < 2) return parts[0] ?? ''
  const family = parts[parts.length - 1]!
  const initials = parts.slice(0, -1).map((p) => `${p[0]!.toUpperCase()}.`).join(' ')
  return `${initials} ${family}`
}

/** `Albert Einstein` -> `EINSTEIN A` (GB/T 7714: surname first, no periods). */
export function gbAuthor(name: string): string {
  const parts = clean(name).split(' ').filter(Boolean)
  if (parts.length < 2) return parts[0] ?? ''
  const family = parts[parts.length - 1]!.toUpperCase()
  const initials = parts.slice(0, -1).map((p) => p[0]!.toUpperCase()).join('')
  return `${family} ${initials}`.trim()
}

/** GB/T 7714 author list: first 3, then `, 等`; single author stays bare. */
function gbAuthors(authors: readonly string[]): string {
  const list = authors.map(gbAuthor).filter(Boolean)
  if (!list.length) return ''
  if (list.length <= 3) return list.join(', ')
  return `${list.slice(0, 3).join(', ')}, 等`
}

/** APA author list: comma-separated, `&` before the last. */
function apaAuthors(authors: readonly string[]): string {
  const list = authors.map(apaAuthor).filter(Boolean)
  if (!list.length) return ''
  if (list.length === 1) return list[0]!
  if (list.length === 2) return `${list[0]}, & ${list[1]}`
  return `${list.slice(0, -1).join(', ')}, & ${list[list.length - 1]}`
}

/** IEEE author list: `A. B. Author and C. D. Author`. */
function ieeeAuthors(authors: readonly string[]): string {
  const list = authors.map(ieeeAuthor).filter(Boolean)
  if (!list.length) return ''
  if (list.length === 1) return list[0]!
  if (list.length === 2) return `${list[0]} and ${list[1]}`
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`
}

/** Nature author list: `Einstein, A. et al.` (or a single name). */
function natureAuthors(authors: readonly string[]): string {
  const list = authors.map(apaAuthor).filter(Boolean)
  if (!list.length) return ''
  return list.length === 1 ? list[0]! : `${list[0]}, et al.`
}

function bibtexKey(meta: ReferenceMeta): string {
  const family = clean(meta.authors?.[0] ?? '').split(' ').filter(Boolean).pop() ?? 'ref'
  const word = clean(meta.title).split(' ').filter(Boolean)[0] ?? ''
  const year = yearOf(meta)
  return `${family}${year}${word}`.replace(/[^A-Za-z0-9]/g, '') || 'ref'
}

/** Generate a minimal BibTeX entry when none was supplied. */
function bibtexEntry(meta: ReferenceMeta): string {
  const fields: Array<[string, string]> = []
  if (meta.title) fields.push(['title', `{${clean(meta.title)}}`])
  if (meta.authors?.length) fields.push(['author', `{${meta.authors.map(clean).filter(Boolean).join(' and ')}}`])
  if (meta.venue) fields.push([meta.type === 'conference' ? 'booktitle' : 'journal', `{${clean(meta.venue)}}`])
  if (yearOf(meta)) fields.push(['year', `{${yearOf(meta)}}`])
  if (meta.volume) fields.push(['volume', `{${clean(meta.volume)}}`])
  if (meta.issue) fields.push(['number', `{${clean(meta.issue)}}`])
  if (meta.pages) fields.push(['pages', `{${pagesOf(meta)}}`])
  if (meta.doi) fields.push(['doi', `{${clean(meta.doi)}}`])
  const kind = meta.type === 'book' ? 'book' : meta.type === 'conference' ? 'inproceedings' : 'article'
  return `@${kind}{${bibtexKey(meta)},\n${fields.map(([k, v]) => `  ${k} = ${v}`).join(',\n')}${fields.length ? ',' : ''}\n}`
}

/** One entry, rendered in the requested style. */
export function formatReference(meta: ReferenceMeta, style: CitationStyle): string {
  const authors = (meta.authors ?? []).map(clean).filter(Boolean)
  const title = clean(meta.title) || 'Untitled'
  const venue = clean(meta.venue)
  const year = yearOf(meta)
  const doi = clean(meta.doi)
  const link = doi ? `https://doi.org/${doi}` : clean(meta.url)

  switch (style) {
    case 'gb-t-7714-2015': {
      const marker = GB_TYPE_MARKER[meta.type ?? 'journal']
      const by = gbAuthors(authors)
      const locator = [meta.volume ? clean(meta.volume) : '', meta.issue ? `(${clean(meta.issue)})` : ''].join('')
      const tail = [locator, pagesOf(meta)].filter(Boolean).join(': ')
      const parts = [
        by ? `${trimTrailingPeriod(by)}. ` : '',
        `${trimTrailingPeriod(title)}[${marker}]. `,
        venue ? `${trimTrailingPeriod(venue)}` : '',
        year ? `, ${year}` : '',
        tail ? `, ${tail}` : '',
        '.',
      ]
      return `${parts.join('').replace(/\s+/g, ' ').replace(/,\s*\./g, '.').trim()}${doi ? ` DOI: ${doi}.` : ''}`
    }
    case 'apa-7': {
      const by = apaAuthors(authors)
      const volumeIssue = meta.volume ? `${clean(meta.volume)}${meta.issue ? `(${clean(meta.issue)})` : ''}` : ''
      const tail = [venue, volumeIssue, pagesOf(meta)].filter(Boolean).join(', ')
      return `${by ? `${by} ` : ''}(${year || 'n.d.'}). ${sentence(title)} ${tail ? `${trimTrailingPeriod(tail)}. ` : ''}${link}`
        .replace(/\s+/g, ' ')
        .replace(/\.\s*\./g, '.')
        .trim()
    }
    case 'ieee': {
      const by = ieeeAuthors(authors)
      const bits = [
        by ? `${by}, ` : '',
        `"${trimTrailingPeriod(title)}," `,
        venue ? `${venue}` : '',
        meta.volume ? `, vol. ${clean(meta.volume)}` : '',
        meta.issue ? `, no. ${clean(meta.issue)}` : '',
        meta.pages ? `, pp. ${pagesOf(meta)}` : '',
        year ? `, ${year}` : '',
        '.',
        doi ? ` doi: ${doi}.` : '',
      ]
      return bits.join('').replace(/\s+/g, ' ').replace(/,\s*\./g, '.').trim()
    }
    case 'nature': {
      const by = natureAuthors(authors)
      const tail = [venue, meta.volume ? clean(meta.volume) : '', pagesOf(meta)].filter(Boolean).join(' ')
      return `${by ? `${by} ` : ''}${sentence(title)} ${tail ? `${tail} ` : ''}(${year || 'n.d.'}).${doi ? ` https://doi.org/${doi}` : ''}`
        .replace(/\s+/g, ' ')
        .trim()
    }
    case 'bibtex':
      return meta.bibtex?.trim() || bibtexEntry(meta)
  }
}

/**
 * Format a whole list. `startIndex` is the footnote number of the first entry
 * (default 1); entries are numbered consecutively from it.
 */
export function formatReferences(items: readonly ReferenceMeta[], style: CitationStyle, startIndex = 1): FormattedReference[] {
  const start = Number.isFinite(startIndex) ? Math.max(1, Math.trunc(startIndex)) : 1
  return items.map((meta, i) => ({ index: start + i, style, text: formatReference(meta, style) }))
}

/**
 * The ready-to-paste footnote section: one `[^n]: entry` per line, separated by
 * a BLANK line (consecutive definition lines merge into one paragraph in
 * CommonMark — the wall-of-text failure), in first-reference order.
 */
export function footnoteBlock(entries: readonly FormattedReference[]): string {
  return entries.map((e) => `[^${e.index}]: ${e.text.replace(/\n+/g, ' ').trim()}`).join('\n\n')
}

/** Map a Semantic Scholar paper object onto {@link ReferenceMeta}. */
export function referenceMetaFromS2Paper(p: Record<string, any> | undefined | null): ReferenceMeta {
  if (!p) return {}
  const journal = (p.journal ?? {}) as Record<string, unknown>
  const types = Array.isArray(p.publicationTypes) ? (p.publicationTypes as string[]) : []
  const type: ReferenceType = types.some((t) => /book/i.test(t))
    ? 'book'
    : types.some((t) => /conference/i.test(t))
      ? 'conference'
      : 'journal'
  const authors = Array.isArray(p.authors) ? (p.authors as Array<{ name?: string }>).map((a) => a?.name ?? '').filter(Boolean) : []
  const volume = typeof journal.volume === 'string' ? journal.volume : undefined
  const pages = typeof journal.pages === 'string' ? journal.pages : undefined
  const venue = (typeof journal.name === 'string' && journal.name) || (typeof p.venue === 'string' ? p.venue : undefined)
  return {
    ...(authors.length ? { authors } : {}),
    ...(typeof p.title === 'string' ? { title: p.title } : {}),
    ...(venue ? { venue } : {}),
    ...(typeof p.year === 'number' || typeof p.year === 'string' ? { year: p.year } : {}),
    ...(volume ? { volume } : {}),
    ...(pages ? { pages } : {}),
    ...(typeof p.externalIds?.DOI === 'string' ? { doi: p.externalIds.DOI } : {}),
    ...(typeof p.citationStyles?.bibtex === 'string' ? { bibtex: p.citationStyles.bibtex } : {}),
    type,
  }
}
