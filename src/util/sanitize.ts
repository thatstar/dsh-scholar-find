/**
 * Recursive "lossless-JSON" sanitizer for tool outputs.
 *
 * DSH rejects any tool value that is not *lossless* JSON (the session log
 * persistence/replay contract), so a single `undefined` anywhere in a result
 * fails the whole call ("value is not lossless JSON"). Real upstream data
 * (Semantic Scholar, Crossref, …) frequently has missing fields, so raw S2
 * objects must be cleaned before they are returned.
 *
 * This walk removes:
 *   - `undefined` (object values and array elements),
 *   - `NaN` / `Infinity` / `-Infinity`,
 *   - `-0` (normalised to `0`),
 *   - sparse-array holes (densifies the array),
 *   - `bigint` / `symbol` / `function` / non-plain values.
 * A plain, deeply-clean object/array structure is returned; otherwise the
 * offending value is omitted (object key / array element) or, at the root,
 * replaced by `null`.
 * @module dsh-scholar/util/sanitize
 */

const OMIT = Symbol('omitted')

function walk(value: unknown): unknown | typeof OMIT {
  if (value === null) return null

  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value
    case 'number':
      if (!Number.isFinite(value)) return OMIT
      // -0 is not losslessly representable; normalise to 0.
      return Object.is(value, -0) ? 0 : value
    case 'bigint':
    case 'symbol':
    case 'function':
      return OMIT
    case 'undefined':
      return OMIT
  }

  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) continue // sparse hole -> drop
      const item = walk(value[i])
      if (item !== OMIT) out.push(item)
    }
    return out
  }

  // Plain object / any class instance: keep own enumerable string keys only.
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const cleaned = walk(v)
      if (cleaned !== OMIT) out[key] = cleaned
    }
    return out
  }

  return OMIT
}

/**
 * Clean an arbitrary tool output into a lossless-JSON-safe structure.
 * @param value - the value a tool intends to return.
 * @returns a deeply lossless-JSON value, or `null` when nothing remains.
 */
export function sanitizeForOutput(value: unknown): unknown {
  const out = walk(value)
  return out === OMIT ? null : out
}

/**
 * `true` when a value already satisfies the lossless-JSON contract
 * (no `undefined` / non-finite numbers / `-0` / sparse arrays anywhere).
 * Recursive predicate over the original value; does not reconstruct it.
 */
export function isLosslessJson(value: unknown): boolean {
  if (value === null) return true
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true
    case 'number':
      return Number.isFinite(value) && !Object.is(value, -0)
    case 'undefined':
    case 'bigint':
    case 'symbol':
    case 'function':
      return false
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!(i in value)) return false // sparse hole
      if (!isLosslessJson(value[i])) return false
    }
    return true
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      if (!isLosslessJson(v)) return false
    }
    return true
  }
  return false
}