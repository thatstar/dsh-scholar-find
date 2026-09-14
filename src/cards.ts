/**
 * The scholar card library's naming rule (pure).
 *
 * Cards live in `<defaultOutputDir>/cards/` and are named after the paper's
 * identifier. The rule used to be "replace `/` with `_`", which left `:`, `<>`,
 * `"`, `|`, `?`, `*` and whitespace in the filename — ambiguous on every
 * filesystem — and said nothing about non-DOI identifiers (arXiv ids, corpus
 * ids), so two papers could collapse onto one name or a write could fail.
 *
 * One canonical slug function, applied by the plugin itself: tools return
 * `paper.cardPath`, so the model never has to derive a filename.
 * @module dsh-scholar-find/cards
 */

/** The card subdirectory under the output dir. */
export const CARDS_SUBDIR = 'cards'

/** Characters allowed to survive in a card filename (everything else -> `_`). */
const UNSAFE_RE = /[^A-Za-z0-9._-]+/g

/** FNV-1a (32-bit) hex — a short, stable fallback for unusable identifiers. */
function shortHash(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * Canonical slug for an identifier: every character outside
 * `[A-Za-z0-9._-]` becomes `_`, runs collapse, and leading/trailing `_`/`.` are
 * trimmed. An identifier with nothing usable left falls back to
 * `card_<hash8>` so the name is still stable and unique.
 *
 * `10.1063/1.3506838`      -> `10.1063_1.3506838`
 * `10.1103/jwmw-3lds`      -> `10.1103_jwmw-3lds`
 * `arXiv:2402.08954`       -> `arXiv_2402.08954`
 * `DOI:10.1038/s41586-…`   -> `DOI_10.1038_s41586-…`
 */
export function cardSlug(identifier: string): string {
  const raw = (identifier ?? '').trim()
  const slug = raw
    .replace(UNSAFE_RE, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.]+|[_.]+$/g, '')
  return slug || `card_${shortHash(raw || 'empty')}`
}

/** Canonical card filename for an identifier (`<slug>.md`). */
export function cardFilename(identifier: string): string {
  return `${cardSlug(identifier)}.md`
}

/**
 * Workspace-relative path of a paper's card: `<outputDir>/cards/<slug>.md`.
 * `outputDir` is the configured `defaultOutputDir` (the tools echo the setting,
 * so the path matches what the model's file tools see).
 */
export function cardPath(outputDir: string, identifier: string): string {
  const root = (outputDir || '.scholar').replace(/\/+$/, '')
  return `${root}/${CARDS_SUBDIR}/${cardFilename(identifier)}`
}

/**
 * The identifier a paper should be carded under: its DOI, else its arXiv id
 * (prefixed, so `arXiv:…` and a bare DOI can never collide), else the S2
 * paperId. Returns undefined when the record carries nothing usable.
 */
export function cardIdentifier(paper: { externalIds?: Record<string, string | undefined>; paperId?: string } | undefined): string | undefined {
  if (!paper) return undefined
  const doi = paper.externalIds?.DOI?.trim()
  if (doi) return doi
  const arxiv = paper.externalIds?.ArXiv?.trim()
  if (arxiv) return `arXiv:${arxiv}`
  const paperId = paper.paperId?.trim()
  return paperId || undefined
}
