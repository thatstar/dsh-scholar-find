/**
 * Title/identity verification helpers (pure, no I/O).
 *
 * Real-world failure mode this exists for: a DOI or paperId copied out of a
 * list/table result can resolve to an UNRELATED paper (a hard-sphere nucleation
 * record surfacing as a colloidal-gel PRL, an arXiv PDF for a different work by
 * overlapping authors). Reporting such a record confidently turns it into a
 * fabricated citation. So every resolution that has an expected title is
 * compared against the returned title and the verdict is surfaced to the model.
 *
 * The similarity primitive lives here (single source) and is imported by the
 * fetch chain's title→DOI resolver, so the DOI-resolution gate and the
 * post-resolution record check use exactly the same arithmetic.
 * @module dsh-scholar-find/verify
 */

/** Anything but alphanumerics/whitespace is a token boundary. */
const NON_TOKEN_RE = /[^a-z0-9\s]/g

/** Similarity at or above which two titles are the same work. */
export const TITLE_MATCH_MIN = 0.85
/**
 * Similarity at or above which two titles are plausibly the same work
 * (subtitle/abbreviation variance). Below this they are different papers.
 */
export const TITLE_SIMILARITY_MIN = 0.5

/** Lowercase, tokenizable form of a title (punctuation collapsed to spaces). */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(NON_TOKEN_RE, ' ').replace(/\s+/g, ' ').trim()
}

/** Normalized token set (lowercase, alphanumeric) for title similarity. */
export function titleTokens(title: string): Set<string> {
  return new Set(normalizeTitle(title).split(' ').filter(Boolean))
}

/** Jaccard similarity between two titles (0..1). Exact/close titles -> high. */
export function titleSimilarity(a: string, b: string): number {
  const A = titleTokens(a)
  const B = titleTokens(b)
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  const union = A.size + B.size - inter
  return union ? inter / union : 0
}

/**
 * `match`   — same work (>= {@link TITLE_MATCH_MIN});
 * `near`    — plausibly the same work (>= {@link TITLE_SIMILARITY_MIN});
 * `mismatch`— a different work (below it);
 * `unknown` — either side has no usable tokens (nothing to compare).
 */
export type TitleVerdict = 'match' | 'near' | 'mismatch' | 'unknown'

export interface TitleCheck {
  verdict: TitleVerdict
  /** Jaccard similarity of the normalized token sets (0 when unknown). */
  similarity: number
  expected?: string
  actual?: string
}

/**
 * Compare an expected title against the title a resolver actually returned.
 * A missing/empty title on either side is `unknown`, never a silent pass:
 * "we could not check" must not read as "it is the right paper".
 */
export function titleVerdict(expected?: string, actual?: string): TitleCheck {
  const e = (expected ?? '').trim()
  const a = (actual ?? '').trim()
  if (!e || !a) return { verdict: 'unknown', similarity: 0, ...(e ? { expected: e } : {}), ...(a ? { actual: a } : {}) }
  const similarity = titleSimilarity(e, a)
  const verdict: TitleVerdict = similarity >= TITLE_MATCH_MIN ? 'match' : similarity >= TITLE_SIMILARITY_MIN ? 'near' : 'mismatch'
  return { verdict, similarity, expected: e, actual: a }
}

/** True when a verdict is safe to treat as the requested work. */
export function titleAccepted(check: TitleCheck): boolean {
  return check.verdict === 'match' || check.verdict === 'near'
}

/** One-line, model-facing rendering of a title check. */
export function describeTitleCheck(check: TitleCheck): string {
  const pct = `${Math.round(check.similarity * 100)}%`
  switch (check.verdict) {
    case 'match': return `title verified (${pct} similarity)`
    case 'near': return `title near-match (${pct} similarity) — same work expected, verify before citing`
    case 'mismatch': return `TITLE MISMATCH (${pct} similarity) — the record is a DIFFERENT work; do not cite this identifier`
    case 'unknown': return 'title unverified (no comparable title on one side)'
  }
}
