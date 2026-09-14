/**
 * Citation/reference list honesty (pure).
 *
 * The Semantic Scholar graph serves an empty or short list for records whose
 * own counts say otherwise: `scholar_get_references` returned 0 papers for
 * works that demonstrably have reference lists, and `scholar_get_citations`
 * returned 2 for a paper with 244 citations. Reporting those as "N citing
 * papers" turns an index gap into a false total, and a card written from it
 * looks complete when it is not.
 *
 * So every list result is labelled with what it actually is: complete, capped
 * by the requested limit, short of the record's own count (partial), empty, or
 * "the index has nothing for this record although it claims N" (not_indexed).
 * @module dsh-scholar-find/coverage
 */

/** What a returned citation/reference list is relative to the record's counts. */
export type CoverageStatus = 'complete' | 'truncated' | 'partial' | 'not_indexed' | 'empty' | 'unknown'

/** Which list is being described (only used for the human-readable label). */
export type CoverageKind = 'citations' | 'references' | 'citing papers'

export interface CoverageInput {
  /** Rows the tool actually returned. */
  returned: number
  /** The limit the tool asked the API for. */
  requestedCap: number
  /** The API signalled another page beyond what was returned. */
  hasMore: boolean
  /** The record's own count (citationCount / referenceCount), when known. */
  seedCount?: number
  kind?: CoverageKind
}

export interface Coverage {
  status: CoverageStatus
  returned: number
  requestedCap: number
  hasMore: boolean
  /** The record's own count when the API exposed it. */
  seedCount?: number
  /** True when the list is complete and trustworthy as a total. */
  complete: boolean
  /** Model-facing one-liner; never presents a partial list as a total. */
  label: string
}

/**
 * Decide the coverage verdict. `seedCount` is optional: without it the verdict
 * can still detect a cap (from `hasMore` / `returned === requestedCap`) but a
 * short list cannot be distinguished from an index gap — the label says so
 * instead of implying a total.
 */
export function computeCoverage(input: CoverageInput): Coverage {
  const kind = input.kind ?? 'citations'
  const returned = Math.max(0, Math.trunc(input.returned))
  const requestedCap = Math.max(1, Math.trunc(input.requestedCap))
  const seedCount = typeof input.seedCount === 'number' && Number.isFinite(input.seedCount) ? Math.max(0, Math.trunc(input.seedCount)) : undefined
  // A list that exactly fills the cap is only "capped" when it is not also the
  // whole record: 100 references with a requested cap of 100 and referenceCount
  // 100 is a COMPLETE list.
  const capped = input.hasMore || (returned >= requestedCap && (seedCount === undefined || returned < seedCount))

  // `complete` means "this list can be trusted as the record's total". That is
  // only true when the record's OWN count confirmed it (or confirmed there are
  // none) — an unverifiable list must never come back complete, or a failed
  // count lookup would silently upgrade an index gap to a total.
  const mk = (status: CoverageStatus, label: string): Coverage => ({
    status,
    returned,
    requestedCap,
    hasMore: input.hasMore,
    ...(seedCount !== undefined ? { seedCount } : {}),
    complete: status === 'complete' || (status === 'empty' && seedCount === 0),
    label,
  })

  if (returned === 0) {
    if (seedCount === undefined) return mk('empty', `no ${kind} returned (S2 did not report a total for this record — this may be an index gap, not an empty list)`)
    if (seedCount === 0) return mk('empty', `no ${kind} (the record reports none)`)
    return mk('not_indexed', `the record reports ${seedCount} ${kind} but the API serves none — the list is NOT indexed, not empty`)
  }

  if (capped) {
    const of = seedCount !== undefined ? `${returned} of ${seedCount}` : `${returned}`
    return mk('truncated', `${of} ${kind} — truncated at the requested limit of ${requestedCap}; this is not the total`)
  }

  if (seedCount !== undefined && returned < seedCount) {
    return mk('partial', `${returned} of ${seedCount} ${kind} served by S2 — the graph is incomplete for this record; this is not the total`)
  }

  if (seedCount === undefined) {
    // The record's count could not be read (rate limit, transient error): the
    // list was not capped, but nothing confirms it is the whole record.
    return mk('unknown', `${returned} ${kind} returned; the record's own count could not be read, so treat this as a lower bound — not a total`)
  }

  return mk('complete', `${returned} ${kind}`)
}
