/**
 * The scholar memory card: format, parse, and append-only merge (pure).
 *
 * The card is the plugin's *working memory* — one Markdown file per
 * investigated paper under `<defaultOutputDir>/cards/`. Until v0.2.0 the model
 * authored every card by hand (template + two citation API calls + provenance
 * formatting), and real-world use showed the cost was skipped or deferred to
 * report time, which is exactly when memory stops being memory (.notes/63,
 * 65, 77). `scholar_card_save` now does the mechanical work; this module is the
 * part of it that needs no filesystem and no network, so the format contract is
 * unit-testable on its own.
 *
 * Two invariants drive every function here:
 *
 * 1. **Append-only.** Merging never rewrites, reorders or drops existing
 *    content. The merge edits the raw text in place (line surgery inside a
 *    section), so anything this module does not model — prose, extra headings,
 *    a hand-written note — survives byte-for-byte. Only two lines are ever
 *    replaced rather than appended, both by design: the section's single
 *    `- coverage:` status line, and the `- **Keywords**:` line (the skill
 *    defines keywords as a set to be completed, not appended).
 * 2. **The quote carries the evidence.** An evidence line is
 *    `- [doc_id | offset | page] "verbatim quote" — finding (date)`, and the
 *    bracket always names a source (the Sciverse doc_id, else the card's own
 *    identifier for arXiv/PDF reads). A finding description alone is refused —
 *    a card records where a claim came from, not what the model concluded.
 * @module dsh-scholar-find/cardstore
 */

/** Section headers, in the order a new card renders them. */
export const CARD_HEADERS = {
  basic: '## Basic Information',
  backtrack: '## Citation Backtrack',
  forwardtrack: '## Citation Forwardtrack',
  evidence: '## Evidence List',
  evaluation: '## Evaluation Log',
} as const

export type CardSection = keyof typeof CARD_HEADERS

/** The placeholder a fresh section carries; the first real entry replaces it. */
export const CARD_SEED = '-'

/** Prefix of the one replaceable status line in a citation section. */
export const COVERAGE_PREFIX = '- coverage: '

/** Prefix of the explicit "the graph served nothing" entry. */
export const NO_CITATION_PREFIX = '- no citation data'

/** Provenance + quote bound into `## Evidence List`. */
export interface EvidenceInput {
  /** Verbatim source text. Required — the quote IS the evidence. */
  quote: string
  /** Sciverse doc_id the quote came from (churns on re-ingest, so it is stored). */
  docId?: string
  /** Character offset of the quote inside that doc_id. */
  offset?: number
  /** Page number when the source exposes one. */
  page?: number | string
  /** Fallback source label when there is no doc_id (e.g. `arXiv:2402.08954`). */
  source?: string
  /** Short description of what the quote shows. */
  finding?: string
}

/** One citation-list row, as S2 serves it. */
export interface CitationEntry {
  title?: string
  year?: number | string
  authors?: readonly string[]
  doi?: string
}

/** Identity + bibliographic fields written into `## Basic Information`. */
export interface CardMeta {
  /** DOI, else `arXiv:<id>`, else the S2 paperId — the card's key and slug. */
  identifier: string
  title?: string
  authors?: readonly string[]
  year?: number | string
  venue?: string
  abstract?: string
  keywords?: readonly string[]
}

/** A citation section's new content for one merge. */
export interface CitationUpdate {
  entries: readonly CitationEntry[]
  /** The `coverage.label` the tool returned, recorded verbatim. */
  coverage: string
}

export interface CardUpdate {
  /** Identity + bibliographic fields; `meta.keywords` also completes the
   * `- **Keywords**:` line (the one Basic Information line that may be
   * replaced rather than appended — keywords are a set, not a log). */
  meta: CardMeta
  evidence?: readonly EvidenceInput[]
  backtrack?: CitationUpdate
  forwardtrack?: CitationUpdate
  /** One `- [v{n} | date] ...` line for `## Evaluation Log`. */
  evaluation?: string
}

/** What a merge actually changed — the tool reports this, never re-derives it. */
export interface MergeDelta {
  evidence: number
  backtrack: number
  forwardtrack: number
  keywords: boolean
  evaluation: number
  /** Lines skipped because an equivalent one was already in the card. */
  duplicates: number
}

export interface MergeResult {
  markdown: string
  /** True when the input was empty/absent and a new card was rendered. */
  created: boolean
  delta: MergeDelta
}

/** Card fields recovered from an existing file. */
export interface ParsedCard {
  /** False when the text does not look like a card (no Basic Information). */
  recognized: boolean
  identifier?: string
  title?: string
  authors: string[]
  year?: string
  venue?: string
  abstract?: string
  keywords: string[]
  backtrack: string[]
  forwardtrack: string[]
  backtrackCoverage?: string
  forwardtrackCoverage?: string
  evidence: string[]
  evaluations: string[]
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Authors as one card line: first three names, then `et al.`. */
export function formatCardAuthors(authors: readonly string[] | undefined): string {
  const names = (authors ?? []).map((a) => (a ?? '').trim()).filter(Boolean)
  if (!names.length) return '(not recorded)'
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} et al.`
}

/** Two significant digits collapse a long abstract without losing its topic. */
const ABSTRACT_MAX = 1_200

/** One `## Basic Information` body line. Values are never left blank. */
function basicLine(label: string, value: string | undefined): string {
  return `- **${label}**: ${value && value.trim() ? value.trim() : '(not recorded)'}`
}

/** The keyword line, shared by render and merge so the two cannot drift. */
export function keywordLine(keywords: readonly string[] | undefined): string {
  const list = (keywords ?? []).map((k) => (k ?? '').trim()).filter(Boolean)
  return basicLine('Keywords', list.join(', '))
}

/** A fresh card, matching the `scholar-memory` template. */
export function renderNewCard(meta: CardMeta, date: string): string {
  return [
    `# DOI: ${meta.identifier}`,
    '',
    CARD_HEADERS.basic,
    basicLine('Title', meta.title),
    basicLine('Authors', formatCardAuthors(meta.authors)),
    basicLine('Year', meta.year === undefined ? undefined : String(meta.year)),
    basicLine('Venue', meta.venue),
    basicLine('Identifier', meta.identifier),
    basicLine('Abstract', meta.abstract ? meta.abstract.slice(0, ABSTRACT_MAX) : undefined),
    keywordLine(meta.keywords),
    '',
    CARD_HEADERS.backtrack,
    CARD_SEED,
    '',
    CARD_HEADERS.forwardtrack,
    CARD_SEED,
    '',
    CARD_HEADERS.evidence,
    '',
    CARD_HEADERS.evaluation,
    `- [v1 | ${date}] card created`,
    '',
  ].join('\n')
}

/** `- Title (Year). Authors. DOI: x` — the one line per citation. */
export function citationLine(entry: CitationEntry): string {
  const title = (entry.title ?? '').trim() || 'Untitled'
  const year = entry.year === undefined || entry.year === '' ? '' : ` (${entry.year})`
  const authors = formatCardAuthors(entry.authors)
  const doi = (entry.doi ?? '').trim()
  return `- ${title}${year}. ${authors}.${doi ? ` DOI: ${doi}` : ''}`
}

/** Dedupe key for a citation: its DOI when it has one, else its lowercased title. */
export function citationKey(entry: CitationEntry): string {
  const doi = (entry.doi ?? '').trim().toLowerCase()
  if (doi) return `doi:${doi}`
  return `title:${(entry.title ?? '').trim().toLowerCase().replace(/\s+/g, ' ')}`
}

/** Dedupe key recovered from an already-written citation line. */
export function citationKeyFromLine(line: string): string {
  const doi = /\bDOI:\s*(\S+)/i.exec(line)
  if (doi?.[1]) return `doi:${doi[1].replace(/[.,;]+$/, '').toLowerCase()}`
  return `title:${line.replace(/^-\s*/, '').replace(/\s*\(\d{4}\)[\s\S]*$/, '').trim().toLowerCase().replace(/\s+/g, ' ')}`
}

/**
 * The provenance-bound evidence line. The bracket always names a source: the
 * Sciverse `doc_id` when there is one, else the fallback label (the card's own
 * identifier for arXiv HTML / a local PDF).
 */
export function evidenceLine(input: EvidenceInput, fallbackSource: string, date: string): string {
  const docId = (input.docId ?? '').trim()
  // The bracket ALWAYS names a source first: without a doc_id the line would
  // otherwise read `[offset 12]`, which names no source at all.
  const provenance: string[] = [docId || (input.source ?? '').trim() || fallbackSource]
  if (typeof input.offset === 'number' && Number.isFinite(input.offset)) provenance.push(`offset ${input.offset}`)
  if (input.page !== undefined && input.page !== '') provenance.push(`page ${input.page}`)
  const quote = input.quote.trim().replace(/\s*\n\s*/g, ' ')
  const finding = (input.finding ?? '').trim()
  return `- [${provenance.join(' | ')}] "${quote}"${finding ? ` — ${finding}` : ''} (${date})`
}

/** Dedupe key for an evidence line: the quote is what identifies it. */
function quoteKey(line: string): string {
  const m = /"([\s\S]*?)"/.exec(line)
  return (m?.[1] ?? line).replace(/\s+/g, ' ').trim().toLowerCase()
}

/** The display quote for an evidence line (used by the completeness/dup check). */
export function evidenceQuoteOf(input: EvidenceInput): string {
  return input.quote.replace(/\s+/g, ' ').trim().toLowerCase()
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Body lines of one `## ` section, excluding the header and blank padding. */
function sectionBody(text: string, header: string): string[] | undefined {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.trim() === header)
  if (start < 0) return undefined
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith('## ')) { end = i; break }
  }
  return lines.slice(start + 1, end).map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim() !== '')
}

/** `- **Label**: value` for one Basic Information field. */
function basicValue(body: readonly string[], label: string): string | undefined {
  const re = new RegExp(`^-\\s*\\*\\*${label}\\*\\*:\\s*(.*)$`, 'i')
  for (const line of body) {
    const m = re.exec(line.trim())
    if (m?.[1] !== undefined) {
      const v = m[1].trim()
      return v === '(not recorded)' ? undefined : v
    }
  }
  return undefined
}

/**
 * Recover the card's fields. A file without `## Basic Information` is reported
 * `recognized: false` — the caller must not "merge" into an arbitrary Markdown
 * file that happens to sit in `cards/`.
 */
export function parseCard(text: string): ParsedCard {
  const basic = sectionBody(text, CARD_HEADERS.basic)
  const idLine = /^#\s*DOI:\s*(.+)$/m.exec(text)
  const keywordsRaw = basic ? basicValue(basic, 'Keywords') : undefined
  const backtrack = sectionBody(text, CARD_HEADERS.backtrack) ?? []
  const forwardtrack = sectionBody(text, CARD_HEADERS.forwardtrack) ?? []
  const evidence = sectionBody(text, CARD_HEADERS.evidence) ?? []
  const evaluations = sectionBody(text, CARD_HEADERS.evaluation) ?? []
  const authorsRaw = basic ? basicValue(basic, 'Authors') : undefined
  return {
    recognized: basic !== undefined,
    ...(idLine?.[1] ? { identifier: idLine[1].trim() } : {}),
    ...(basic ? { title: basicValue(basic, 'Title') } : {}),
    authors: authorsRaw ? authorsRaw.replace(/\s+et al\.?$/i, '').split(',').map((a) => a.trim()).filter(Boolean) : [],
    ...(basic ? { year: basicValue(basic, 'Year') } : {}),
    ...(basic ? { venue: basicValue(basic, 'Venue') } : {}),
    ...(basic ? { abstract: basicValue(basic, 'Abstract') } : {}),
    keywords: keywordsRaw ? keywordsRaw.split(',').map((k) => k.trim()).filter(Boolean) : [],
    // The placeholder seed and the coverage status line are layout, not
    // content: neither counts as an entry (nor as "the section is populated").
    backtrack: backtrack.filter((l) => !l.startsWith(COVERAGE_PREFIX) && l.trim() !== CARD_SEED),
    forwardtrack: forwardtrack.filter((l) => !l.startsWith(COVERAGE_PREFIX) && l.trim() !== CARD_SEED),
    ...(backtrack.find((l) => l.startsWith(COVERAGE_PREFIX)) ? { backtrackCoverage: backtrack.find((l) => l.startsWith(COVERAGE_PREFIX))!.slice(COVERAGE_PREFIX.length) } : {}),
    ...(forwardtrack.find((l) => l.startsWith(COVERAGE_PREFIX)) ? { forwardtrackCoverage: forwardtrack.find((l) => l.startsWith(COVERAGE_PREFIX))!.slice(COVERAGE_PREFIX.length) } : {}),
    evidence,
    evaluations,
  }
}

/**
 * A card is complete when both citation sections carry content (entries, or an
 * explicit "no citation data" line) and `## Evidence List` has at least one
 * provenance-bound line — the completeness rule from the `scholar-memory` skill,
 * checked mechanically here instead of by re-reading the file.
 */
export function cardIsComplete(card: ParsedCard): boolean {
  const populated = (lines: readonly string[]): boolean => lines.some((l) => l.trim() !== '' && l.trim() !== CARD_SEED)
  return populated(card.backtrack) && populated(card.forwardtrack) && card.evidence.some((l) => /^-\s*\[[^\]]+\]\s*"/.test(l.trim()))
}

// ---------------------------------------------------------------------------
// Append-only merge (line surgery: untouched text stays byte-identical)
// ---------------------------------------------------------------------------

/** `[start, end)` of a section's body in the raw line array. */
function bodyRange(lines: readonly string[], header: string): { start: number; end: number } | undefined {
  const start = lines.findIndex((l) => l.trim() === header)
  if (start < 0) return undefined
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i]!.startsWith('## ')) { end = i; break }
  }
  return { start: start + 1, end }
}

/**
 * Insert `added` at the end of `header`'s body, replacing the bare `-` seed
 * (and dropping a trailing blank line so the section stays tight). When the
 * section is absent it is appended at the end of the file.
 */
function insertIntoSection(text: string, header: string, added: readonly string[]): string {
  if (!added.length) return text
  const lines = text.split('\n')
  const range = bodyRange(lines, header)
  if (!range) {
    const trimmed = text.replace(/\n+$/, '')
    return `${trimmed}\n\n${header}\n${added.join('\n')}\n`
  }
  const body = lines.slice(range.start, range.end)
  // Drop trailing blank lines (they belong to the layout, not the content).
  let bodyEnd = body.length
  while (bodyEnd > 0 && body[bodyEnd - 1]!.trim() === '') bodyEnd--
  const kept = body.slice(0, bodyEnd).filter((l) => l.trim() !== CARD_SEED)
  const next = [...kept, ...added]
  const tail = body.slice(bodyEnd)
  const rebuilt = [...lines.slice(0, range.start), ...next, ...tail, ...lines.slice(range.end)]
  return rebuilt.join('\n')
}

/** Replace the single `predicate` line inside a section; returns null when absent. */
function replaceInSection(text: string, header: string, predicate: (line: string) => boolean, replacement: string): string | null {
  const lines = text.split('\n')
  const range = bodyRange(lines, header)
  if (!range) return null
  for (let i = range.start; i < range.end; i++) {
    if (predicate(lines[i]!.trim())) {
      const copy = [...lines]
      copy[i] = replacement
      return copy.join('\n')
    }
  }
  return null
}

/** Fill `- **Keywords**: …` in Basic Information; null when the line is absent. */
function replaceKeywords(text: string, line: string): string | null {
  return replaceInSection(text, CARD_HEADERS.basic, (l) => /^-\s*\*\*Keywords\*\*:/i.test(l), line)
}

/** Replace the citation section's status line with the newest coverage label. */
function replaceCoverage(text: string, header: string, label: string): string | null {
  return replaceInSection(text, header, (l) => l.startsWith(COVERAGE_PREFIX), `${COVERAGE_PREFIX}${label}`)
}

/** Content lines already present in a citation section (coverage line excluded). */
function existingCitationKeys(text: string, header: string): Set<string> {
  const body = sectionBody(text, header) ?? []
  return new Set(body.filter((l) => !l.startsWith(COVERAGE_PREFIX) && l.trim() !== CARD_SEED).map(citationKeyFromLine))
}

/**
 * Merge one update into an existing card (or render a new one when `existing`
 * is empty/absent). Append-only: existing lines are never rewritten, only
 * appended to. Returns the full new text plus what actually changed.
 */
export function mergeCard(existing: string | undefined, update: CardUpdate, date: string): MergeResult {
  const delta: MergeDelta = { evidence: 0, backtrack: 0, forwardtrack: 0, keywords: false, evaluation: 0, duplicates: 0 }
  if (!existing || !existing.trim()) {
    // A brand-new card goes through the same section path as an update, so the
    // seed-replacement rules live in exactly one place.
    return { markdown: applySections(renderNewCard(update.meta, date), update, date, delta), created: true, delta }
  }

  const parsed = parseCard(existing)
  let text = `${existing.replace(/\n+$/, '')}\n`
  // The bibliographic header is refreshed only where the card has a hole: the
  // append-only rule protects content, and a card whose title reads
  // "(not recorded)" is useless for the report-time recall it exists for.
  if (parsed.recognized) text = backfillBasic(text, update.meta)
  if (update.meta.keywords?.length) {
    const replaced = replaceKeywords(text, keywordLine(update.meta.keywords))
    if (replaced !== null) {
      if (replaced !== text) delta.keywords = true
      text = replaced
    }
  }
  text = applySections(text, update, date, delta)
  return { markdown: text.endsWith('\n') ? text : `${text}\n`, created: false, delta }
}

/** Fill only the Basic Information lines that are missing or unrecorded. */
function backfillBasic(text: string, meta: CardMeta): string {
  let out = text
  const replace = (label: string, value: string | undefined): void => {
    if (!value || !value.trim()) return
    const re = new RegExp(`^-\\s*\\*\\*${label}\\*\\*:\\s*\\(not recorded\\)\\s*$`, 'i')
    const replaced = replaceInSection(out, CARD_HEADERS.basic, (l) => re.test(l), basicLine(label, value))
    if (replaced !== null) out = replaced
  }
  replace('Title', meta.title)
  replace('Authors', meta.authors?.length ? formatCardAuthors(meta.authors) : undefined)
  replace('Year', meta.year === undefined ? undefined : String(meta.year))
  replace('Venue', meta.venue)
  replace('Abstract', meta.abstract ? meta.abstract.slice(0, ABSTRACT_MAX) : undefined)
  return out
}

/** Append evidence + citation sections; shared by the create and update paths. */
function applySections(text: string, update: CardUpdate, date: string, delta: MergeDelta): string {
  let out = text
  if (update.evidence?.length) {
    const seen = new Set((sectionBody(out, CARD_HEADERS.evidence) ?? []).map(quoteKey))
    const fresh: string[] = []
    for (const ev of update.evidence) {
      if (!ev.quote || !ev.quote.trim()) continue
      const key = evidenceQuoteOf(ev)
      if (seen.has(key)) { delta.duplicates++; continue }
      seen.add(key)
      fresh.push(evidenceLine(ev, update.meta.identifier, date))
    }
    if (fresh.length) {
      out = insertIntoSection(out, CARD_HEADERS.evidence, fresh)
      delta.evidence += fresh.length
    }
  }
  for (const [header, section] of [
    [CARD_HEADERS.backtrack, update.backtrack],
    [CARD_HEADERS.forwardtrack, update.forwardtrack],
  ] as const) {
    if (!section) continue
    // The coverage label is a status line, not content: it is refreshed in
    // place (inserted first on a fresh card so it heads the section).
    out = replaceCoverage(out, header, section.coverage)
      ?? insertIntoSection(out, header, [`${COVERAGE_PREFIX}${section.coverage}`])
    const seen = existingCitationKeys(out, header)
    const fresh: string[] = []
    for (const entry of section.entries) {
      const key = citationKey(entry)
      if (seen.has(key)) { delta.duplicates++; continue }
      seen.add(key)
      fresh.push(citationLine(entry))
    }
    if (fresh.length) {
      out = insertIntoSection(out, header, fresh)
      if (header === CARD_HEADERS.backtrack) delta.backtrack += fresh.length
      else delta.forwardtrack += fresh.length
    } else if (!(sectionBody(out, header) ?? []).some((l) => l.startsWith(NO_CITATION_PREFIX))) {
      // A zero-row answer is a fact about the graph, not a blank section — the
      // completeness rule counts a seeded section as populated.
      out = insertIntoSection(out, header, [`${NO_CITATION_PREFIX} (S2: ${section.coverage})`])
    }
  }
  if (update.evaluation) {
    out = insertIntoSection(out, CARD_HEADERS.evaluation, [update.evaluation])
    delta.evaluation++
  }
  return out
}

// ---------------------------------------------------------------------------
// Recall (the report-time half: what does the library already know?)
// ---------------------------------------------------------------------------

/** One row of the card library, for the report-time recall call. */
export interface CardSummary {
  file: string
  identifier?: string
  title?: string
  year?: string
  keywords: string[]
  /** Provenance-bound evidence lines. */
  evidence: number
  backtrack: number
  forwardtrack: number
  /** The newest `## Evaluation Log` line, if any. */
  lastEvaluation?: string
  /** Both citation sections populated and ≥1 provenance-bound evidence line. */
  complete: boolean
  /** False when the file is not a scholar card (unknown Markdown in `cards/`). */
  recognized: boolean
}

/** Summarize one card file so a report can recall it without re-reading each. */
export function summarizeCard(markdown: string, file: string): CardSummary {
  const card = parseCard(markdown)
  return {
    file,
    ...(card.identifier ? { identifier: card.identifier } : {}),
    ...(card.title ? { title: card.title } : {}),
    ...(card.year ? { year: card.year } : {}),
    keywords: card.keywords,
    evidence: card.evidence.filter((l) => /^-\s*\[[^\]]+\]\s*"/.test(l.trim())).length,
    backtrack: card.backtrack.length,
    forwardtrack: card.forwardtrack.length,
    ...(card.evaluations.length ? { lastEvaluation: card.evaluations[card.evaluations.length - 1] } : {}),
    complete: cardIsComplete(card),
    recognized: card.recognized,
  }
}
