/**
 * Light on-topic checking for discovery results (pure).
 *
 * Real-world failure this addresses: topic queries for metal-liquid nucleation
 * returned ice nucleation, pharmaceutical crystallization, methane hydrate and
 * polymer papers, and the model had to triage them by title before carding.
 * The fix is honesty, not a hard filter: every hit is annotated, and only a
 * NARROW query (2+ significant terms, no OR-group) with ZERO shared terms is
 * flagged — an explicitly requested `strictTopic` may then drop those hits.
 * A hard filter by default would silently discard genuinely cross-disciplinary
 * work, which is the same class of error as reporting a wrong DOI.
 * @module dsh-scholar-find/topic
 */

/**
 * Terms carrying no topical signal — English function words plus the words
 * every paper carries (study/review/analysis…). Deliberately short: an
 * over-eager stoplist would erase real topical terms.
 */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'for', 'and', 'or', 'not', 'with', 'without', 'by', 'to', 'from', 'at', 'as', 'is', 'are', 'was',
  'were', 'be', 'been', 'being', 'using', 'use', 'used', 'based', 'via', 'into', 'over', 'under', 'between', 'among', 'during', 'than',
  'that', 'this', 'these', 'those', 'it', 'its', 'their', 'our', 'we', 'they', 'can', 'could', 'may', 'might', 'should', 'would', 'will',
  'study', 'studies', 'paper', 'papers', 'article', 'articles', 'review', 'reviews', 'analysis', 'investigation', 'research', 'new',
  'recent', 'effect', 'effects', 'role', 'case', 'toward', 'towards', 'insight', 'insights',
])

/** Shortest term worth matching (keeps `ice`, drops `de`). */
const MIN_TERM_LEN = 2
/** Shorter prefixes than this are not treated as the same term (`nano` vs `nan`). */
const MIN_PREFIX_LEN = 4

/**
 * Topical terms of a query, in first-seen order. Excluded terms (`-polymer`)
 * are dropped: a hit that matches only an exclusion is not on-topic evidence
 * for the query.
 */
export function significantTokens(query: string): string[] {
  const cleaned = (query ?? '')
    // Structured boolean syntax carries no topical content.
    .replace(/[()"~]/g, ' ')
    .split(/[^A-Za-z0-9-]+/)
    .join(' ')
    .split(/\s+/)
    .filter((word) => word && !word.startsWith('-'))
    .join(' ')
    .toLowerCase()
    .split(/[\s-]+/)
    .filter(Boolean)
    .filter((t) => t.length >= MIN_TERM_LEN && !STOPWORDS.has(t) && /[a-z]/.test(t))
  return [...new Set(cleaned)]
}

/**
 * A query is "narrow" when it carries at least two significant terms and does
 * not OR alternatives together. Only then is a zero-overlap hit meaningful.
 */
export function isNarrowQuery(query: string): boolean {
  if (/\|/.test(query ?? '')) return false
  return significantTokens(query).length >= 2
}

/** Two terms match when equal, or when one is a prefix of the other (plural/derivation). */
function termsMatch(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= MIN_PREFIX_LEN && long.startsWith(short)
}

/** The fields of a hit that count as topical evidence. */
export interface TopicHaystack {
  title?: string
  venue?: string
  fieldsOfStudy?: readonly string[]
  subjects?: readonly string[]
  abstract?: string
}

export interface TopicOverlap {
  /** Significant query terms found in the hit (empty when none). */
  matched: string[]
  /** matched.length / significant terms in the query (0 when the query is broad). */
  ratio: number
  /** True only for a NARROW query with zero shared terms. */
  offTopic: boolean
}

/**
 * Score one hit against a query. Returns `offTopic: false` for a broad query
 * (nothing to compare) — absence of evidence is not evidence of off-topic.
 */
export function topicOverlap(query: string, hit: TopicHaystack): TopicOverlap {
  const terms = significantTokens(query)
  if (terms.length < 2 || /\|/.test(query ?? '')) return { matched: [], ratio: 0, offTopic: false }
  const haystack = [
    hit.title ?? '',
    hit.venue ?? '',
    ...(hit.fieldsOfStudy ?? []),
    ...(hit.subjects ?? []),
    hit.abstract ?? '',
  ].join(' ')
  const words = haystack.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  const matched = terms.filter((t) => words.some((w) => termsMatch(t, w)))
  return { matched, ratio: matched.length / terms.length, offTopic: matched.length === 0 }
}
