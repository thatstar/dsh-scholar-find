/**
 * Pure helpers for `sciverse_get_resource`: image typing by magic bytes,
 * safe filename derivation from a (possibly path-laden) file_name, and
 * structured error mapping. Kept free of any DSH/runtime dependency so the
 * logic is unit-testable in isolation.
 * @module dsh-scholar-find/sciverse-resource
 */

/** A recognized still-image type, sniffed from the leading bytes. */
export interface SniffedImage {
  mimeType: string
  ext: string
  kind: 'png' | 'jpeg' | 'gif' | 'webp'
}

const sniffers: Array<{ kind: SniffedImage['kind']; mimeType: string; ext: string; match: (b: Uint8Array) => boolean }> = [
  {
    kind: 'png', mimeType: 'image/png', ext: 'png',
    match: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  },
  {
    kind: 'jpeg', mimeType: 'image/jpeg', ext: 'jpg',
    match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    kind: 'gif', mimeType: 'image/gif', ext: 'gif',
    match: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38,
  },
  {
    kind: 'webp', mimeType: 'image/webp', ext: 'webp',
    match: (b) => b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46
      && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50, // "RIFF" + "WEBP"
  },
]

/**
 * Detect a still image from its magic bytes. The upstream `mimeType` from the
 * Sciverse API is only advisory — it can be `undefined` or wrong (e.g. an
 * error page served with a generic content-type), so we trust the bytes.
 * @returns the image facts, or `null` when the bytes are not a recognized image.
 */
export function sniffImageType(bytes: Uint8Array): SniffedImage | null {
  if (!bytes) return null
  for (const s of sniffers) if (s.match(bytes)) return { kind: s.kind, mimeType: s.mimeType, ext: s.ext }
  return null
}

/**
 * Derive a single safe filename from a Sciverse asset path (e.g.
 * `dt=2026-05-28/ht=18/xxx.jpg`). Flattens to the last path segment, strips
 * `..` and any characters that could escape the output dir, and locks the
 * extension to the sniffed `ext` so the written file always matches its real
 * byte type.
 */
export function safeImageBasename(file_name: string, ext: string): string {
  const leaf = (file_name ?? '').split(/[\\/]/).pop() ?? ''
  const cleaned = leaf
    .replace(/\.\.+/g, '.') // collapse any `..` segments
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^_+|_+$/g, '')
  const stem = cleaned.replace(/\.[A-Za-z0-9]+$/i, '').replace(/_+$/g, '')
  // Fall back when nothing alphanumeric remains (empty, all dots, all underscores).
  const usable = /[A-Za-z0-9]/.test(stem) ? stem : 'figure'
  return `${usable}.${ext}`
}

/** One image reference parsed out of a `read_content` Markdown slice. */
export type FigureRef = {
  /** The asset path `file_name` to pass to `get_resource`. */
  file_name: string
  /** The `alt` text from `![alt](file_name)` — a description/caption when present. */
  caption: string
}

/**
 * Extract figure/table references from a `read_content` slice's Markdown,
 * capturing both the `file_name` (what `get_resource` needs) and the `alt`
 * text (the caption — the only semantic hint the model gets about the figure).
 * De-duplicated by `file_name`.
 */
export function extractFigureRefs(text: string): FigureRef[] {
  const out: FigureRef[] = []
  const seen = new Set<string>()
  for (const m of text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)) {
    const file_name = m[2]
    if (!file_name || seen.has(file_name)) continue
    seen.add(file_name)
    out.push({ file_name, caption: (m[1] ?? '').trim() })
  }
  return out
}

/**
 * Slug a string into a safe `[a-z0-9-]` token: lowercase everything, collapse
 * non-alphanumeric runs to a single dash, trim, cap and re-trim. Digits are
 * kept so a caption like "Figure 2. Architecture" survives as `figure-2-architecture`.
 */
function figureSlug(value: string, max: number): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
}

/**
 * Build a human-meaningful figure filename from the paper identity and caption
 * the model already has at call time. Purely model-driven (no persisted state):
 * `paper` (a DOI/unique_id/title, e.g. `paper:10.1038/xxx`) scopes the name so
 * figures from different papers never collide, and `caption` (the alt text)
 * embeds the semantic hint (and any figure number present) so the name is
 * self-describing. Falls back to `figure` when nothing usable is provided;
 * callers choose the raw `safeImageBasename` when the model passes neither.
 */
export function buildFigureName(opts: { paper?: string; caption?: string; ext: string }): string {
  const paperSlug = opts.paper ? figureSlug(opts.paper.replace(/^paper[:/]+/i, ''), 40) : ''
  const captionSlug = opts.caption ? figureSlug(opts.caption, 50) : 'figure'
  const core = [paperSlug, captionSlug].filter(Boolean).join('-') || 'figure'
  return `${core}.${opts.ext}`
}

/** Structured error for `sciverse_get_resource`, mirroring the paper_fetch_* envelopes. */
export interface GetResourceError {
  code: string
  retryable: boolean
  markdown: string
}

/**
 * Map a thrown error from {@link createSciverseClient}.getResource into a
 * `{ ok:false, code, retryable, markdown }` envelope so the tool call fails
 * gracefully instead of throwing raw and so the model gets a retry hint (esp.
 * on the per-endpoint 429 rate limit).
 */
export function mapGetResourceError(e: unknown): GetResourceError {
  const msg = e instanceof Error ? e.message : String(e)
  const lower = msg.toLowerCase()
  if (/timeout/i.test(msg)) {
    return { code: 'timeout', retryable: true, markdown: 'sciverse get_resource timed out. Retry once; if it persists the asset may be large or the service slow.' }
  }
  if (/429|rate.?limit|too many/i.test(lower)) {
    return { code: 'rate_limited', retryable: true, markdown: 'Sciverse rate limit (429) reached. Back off ~60s before retrying this fetch.' }
  }
  if (/404|not.?found/i.test(lower)) {
    return { code: 'not_found', retryable: false, markdown: `Resource not found (${msg}). This file may not exist in the paper's asset set.` }
  }
  if (/403|forbidden/i.test(lower)) {
    return { code: 'forbidden', retryable: false, markdown: `Access forbidden (${msg}).` }
  }
  if (/5\d\d|server|internal/i.test(lower)) {
    return { code: 'server_error', retryable: true, markdown: `Sciverse server error (${msg}). Transient — retry later.` }
  }
  return { code: 'network_error', retryable: true, markdown: `sciverse get_resource failed: ${msg}` }
}
