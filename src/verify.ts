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

/**
 * Anything that is not a letter, a number or whitespace is a token boundary.
 * Unicode-aware on purpose: the ASCII-only form (`[^a-z0-9\s]`) deleted every
 * CJK character, so a Chinese title normalized to the empty string and
 * `titleSimilarity` returned 0 — for two IDENTICAL titles. Since 0 is the
 * `mismatch` verdict, the identity gate refused every Chinese work it was
 * shown, including the GB/T 7714-2015 corpus this plugin advertises
 * (.notes/78 R1b).
 */
const NON_TOKEN_RE = /[^\p{L}\p{N}\s]/gu

/**
 * Scripts written without spaces. Such a run is one "word" to a whitespace
 * tokenizer, so two different Chinese titles share no token at all; these runs
 * are tokenized into character bigrams instead, which makes a near-identical
 * title score high and an unrelated one score low.
 */
const TOKEN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]+|[\p{L}\p{N}]+/gu
/** Per-character test used to route a matched piece to the bigram path. */
const UNSPACED_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

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

/**
 * Normalized token set for title similarity: words for spaced scripts,
 * character bigrams for the unspaced ones (Han/Kana/Hangul).
 */
export function titleTokens(title: string): Set<string> {
  const tokens = new Set<string>()
  for (const match of normalizeTitle(title).matchAll(TOKEN_RE)) {
    const piece = match[0]
    if (!UNSPACED_CHAR_RE.test(piece)) {
      tokens.add(piece)
      continue
    }
    if (piece.length === 1) {
      tokens.add(piece)
      continue
    }
    for (let i = 0; i < piece.length - 1; i++) tokens.add(piece.slice(i, i + 2))
  }
  return tokens
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
 * The Sciverse RAG endpoint renders a paper's title BILINGUALLY
 * (`中文标题 | English title`) while its metadata index stores one language, so
 * a literal comparison scores the same work as `mismatch` — verified live
 * against `10.19678/j.issn.1000-3428.0063687` (`.notes/78` §11). A title is
 * therefore compared as its whole string AND as each `|`-separated segment.
 *
 * Deliberately conservative: only the bilingual bar splits a title (splitting
 * on `/` would turn "A/B testing" into a one-token variant that matches
 * unrelated short titles), and only segments with enough tokens to be
 * meaningful are offered.
 */
const BILINGUAL_SEP = /\s*[|｜]\s*/

/** The strings a title may legitimately be compared as. */
export function titleVariants(title: string): string[] {
  const t = (title ?? '').trim()
  if (!t || !BILINGUAL_SEP.test(t)) return t ? [t] : []
  const parts = t.split(BILINGUAL_SEP).map((s) => s.trim()).filter(Boolean)
  const substantial = parts.filter((p) => titleTokens(p).size >= 3)
  return [t, ...substantial.filter((p) => p !== t)]
}

/**
 * Compare an expected title against the title a resolver actually returned.
 * A missing/empty title on either side is `unknown`, never a silent pass:
 * "we could not check" must not read as "it is the right paper".
 *
 * The score is the best pairing across {@link titleVariants}, so a bilingual
 * rendering and a monolingual record still recognise each other.
 */
export function titleVerdict(expected?: string, actual?: string): TitleCheck {
  const e = (expected ?? '').trim()
  const a = (actual ?? '').trim()
  if (!e || !a) return { verdict: 'unknown', similarity: 0, ...(e ? { expected: e } : {}), ...(a ? { actual: a } : {}) }
  let similarity = 0
  for (const ev of titleVariants(e)) {
    for (const av of titleVariants(a)) {
      const s = titleSimilarity(ev, av)
      if (s > similarity) similarity = s
    }
  }
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

/** The minimal shape a fetch candidate must expose to be title-checked. */
export interface TitleCheckable {
  readonly source: string
  readonly title?: string
}

/** A candidate dropped because its own title is a different work. */
export interface RejectedCandidate {
  source: string
  title?: string
  similarity: number
  /** The title it was compared against (the expected title, or the DOI record's). */
  against: string
}

/**
 * Drop fetch candidates whose OWN record title is a different work than
 * `referenceTitle` (the title the caller expects, or the title the DOI record
 * reports). Candidates without a title are kept — absence of evidence is not
 * evidence of a mismatch, and the caller still has the extra-source record.
 *
 * This is the "resolved a different paper" guard: a DOI whose S2 record points
 * at a work by overlapping authors yields an arXiv candidate carrying that
 * other work's title.
 */
export function rejectMismatchedCandidates<T extends TitleCheckable>(
  candidates: readonly T[],
  referenceTitle: string | undefined,
): { keep: T[]; rejected: RejectedCandidate[] } {
  const reference = (referenceTitle ?? '').trim()
  if (!reference) return { keep: [...candidates], rejected: [] }
  const keep: T[] = []
  const rejected: RejectedCandidate[] = []
  for (const c of candidates) {
    const title = (c.title ?? '').trim()
    if (!title) {
      keep.push(c)
      continue
    }
    const check = titleVerdict(reference, title)
    if (titleAccepted(check)) keep.push(c)
    else rejected.push({ source: c.source, title, similarity: check.similarity, against: reference })
  }
  return { keep, rejected }
}
