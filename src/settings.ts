/**
 * Shared settings and validation for the dsh-scholar-find plugin.
 *
 * The settings are the plugin's Cordis **`Config`** (exported as `Config` from
 * `index.ts`): the loader parses the profile entry's raw config with this
 * schema and hands the result to `apply()`. Every field is `.volatile()`, which
 * is what makes it editable in the Web UI — a saved value is a revision-fenced
 * write into the active profile's patch document, committed into the running
 * reference (`config.<field>.get()`) without remounting the plugin. The
 * settings namespace is this plugin's profile entry id
 * (`SCHOLAR_ENTRY_ID` in `refs.ts`, shared with the browser half, which renders
 * the form on the Plugins page — see `src/client/index.ts`).
 * @module dsh-scholar-find/settings
 */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_ASTA_KEY_REF, DEFAULT_SCIVERSE_KEY_REF, DEFAULT_S2_KEY_REF } from './refs.js'

/** Hard ceiling for one search call (S2 returns at most 100 per page; the tool
 * clamp and the settings validator share this so the two boundaries cannot
 * drift). */
export const SEARCH_RESULT_CAP = 100

/** Settings unit helpers — seconds -> ms and MB -> bytes. Used across the fetch
 * service and the tool layer so the conversion arithmetic lives in one place. */
export const timeoutMsOf = (sec: number): number => sec * 1000
export const maxBytesOf = (mb: number): number => mb * 1024 * 1024

/** The resolved settings value (schema-applied defaults). */
export interface ScholarSettings {
  unpaywallEmail: string
  s2ApiKeyRef: string
  astaApiKeyRef: string
  sciverseApiKeyRef: string
  cloakEnabled: boolean
  proxyUrl: string
  defaultOutputDir: string
  maxResultsPerSearch: number
  fetchTimeoutSec: number
  maxPdfSizeMb: number
  s2RequestGapMs: number
}

/**
 * Canonical plugin defaults — the single source used by the schema's field
 * defaults and, via index.ts, as the boot-time composition base of the settings
 * section. Changing a default here is the only place to change it.
 */
export const DEFAULT_SCHOLAR_SETTINGS: ScholarSettings = {
  unpaywallEmail: '',
  s2ApiKeyRef: DEFAULT_S2_KEY_REF,
  astaApiKeyRef: DEFAULT_ASTA_KEY_REF,
  sciverseApiKeyRef: DEFAULT_SCIVERSE_KEY_REF,
  cloakEnabled: false,
  proxyUrl: '',
  defaultOutputDir: '.scholar',
  maxResultsPerSearch: 20,
  fetchTimeoutSec: 30,
  maxPdfSizeMb: 50,
  s2RequestGapMs: 0,
}

/**
 * Plugin `Config`: the schema the loader parses and the Web UI projects into
 * the plugin's settings form. All fields carry defaults so the plugin is
 * usable before the user touches the page; `unpaywallEmail` is the only field
 * the user really must provide (Unpaywall is skipped without it).
 *
 * Every field is `.volatile()` (live-editable, no remount), and the numeric
 * bounds live *here* rather than in a validator hook: a schemastery bound is
 * what refuses a bad write at the settings boundary, so a stored value can
 * never reach a tool call. `min(Number.MIN_VALUE)` is the harness idiom for
 * "a positive finite number" (0 and negatives are refused; there is no upper
 * bound to express for a duration or a size).
 */
export const ScholarConfigSchema = z.object({
  /** Unpaywall contact email; also sent as Crossref `mailto`. Empty -> Unpaywall skipped. */
  unpaywallEmail: z.string().default(DEFAULT_SCHOLAR_SETTINGS.unpaywallEmail).volatile(),
  /** DSH credential reference (record name in ~/.dsh/.credentials.yaml; default
   * `DEFAULT_S2_KEY_REF` from refs.ts). Empty -> anonymous. */
  s2ApiKeyRef: z.string().role('credential-ref').default(DEFAULT_SCHOLAR_SETTINGS.s2ApiKeyRef).volatile(),
  /** DSH credential reference for the Ai2 Asta corpus MCP key (default
   * `DEFAULT_ASTA_KEY_REF` from refs.ts). */
  astaApiKeyRef: z.string().role('credential-ref').default(DEFAULT_SCHOLAR_SETTINGS.astaApiKeyRef).volatile(),
  /** DSH credential reference for the Sciverse Open Platform token (default
   * `DEFAULT_SCIVERSE_KEY_REF` from refs.ts). Empty -> sciverse_* tools report
   * unconfigured. */
  sciverseApiKeyRef: z.string().role('credential-ref').default(DEFAULT_SCHOLAR_SETTINGS.sciverseApiKeyRef).volatile(),
  /** Operator opt-in for the CloakBrowser fallback (Cloudflare/WAF-gated PDFs). */
  cloakEnabled: z.boolean().default(DEFAULT_SCHOLAR_SETTINGS.cloakEnabled).volatile(),
  /** HTTP/HTTPS proxy for outbound OA/PDF fetches, e.g. `http://127.0.0.1:10808`. Empty = off / fall back to env. */
  proxyUrl: z.string().default(DEFAULT_SCHOLAR_SETTINGS.proxyUrl).volatile(),
  /** Root output directory; relative values resolve against the session
   * workspace. Each tool owns a subdirectory below it (pdfs/md/html/figs/idem/cards). */
  defaultOutputDir: z.string().default(DEFAULT_SCHOLAR_SETTINGS.defaultOutputDir).volatile(),
  /** Default result cap for scholar search tools (per-call ceiling is 100). */
  maxResultsPerSearch: z.number().step(1).min(1).max(SEARCH_RESULT_CAP).default(DEFAULT_SCHOLAR_SETTINGS.maxResultsPerSearch).volatile(),
  /** Per-request HTTP timeout in seconds. */
  fetchTimeoutSec: z.number().min(Number.MIN_VALUE).default(DEFAULT_SCHOLAR_SETTINGS.fetchTimeoutSec).volatile(),
  /** Download size cap in megabytes. */
  maxPdfSizeMb: z.number().min(Number.MIN_VALUE).default(DEFAULT_SCHOLAR_SETTINGS.maxPdfSizeMb).volatile(),
  /** S2 pacing override in ms; 0 = auto (1100 ms with key, 5000 ms anonymous). */
  s2RequestGapMs: z.number().min(0).default(DEFAULT_SCHOLAR_SETTINGS.s2RequestGapMs).volatile(),
})

/**
 * A `.volatile()` field as the loader hands it to `apply()`: a detached
 * reference whose value the profile writes update in place.
 */
export interface VolatileRef<T> {
  get(): T
}

/**
 * What `apply()` may be handed as the plugin config: the parsed `Config` (every
 * field a volatile reference), a plain section (tests, or a host that composed
 * the row with a plain object), or a partial of either. Missing fields fall
 * back to {@link DEFAULT_SCHOLAR_SETTINGS}, so a deployment with an empty row
 * behaves exactly like the schema's defaults.
 */
export type ScholarConfigInput = Partial<{
  [K in keyof ScholarSettings]: ScholarSettings[K] | VolatileRef<ScholarSettings[K]>
}>

/** Whether a config field arrived as a live reference rather than plain data. */
function isVolatileRef(value: unknown): value is VolatileRef<unknown> {
  return typeof value === 'object' && value !== null && typeof (value as { get?: unknown }).get === 'function'
}

/**
 * Read the current plain settings out of the plugin config.
 *
 * Called through a thunk at each use site (not once at activation), so a value
 * saved on the settings page is what the NEXT tool call sees — `apply()` never
 * caches a snapshot.
 * @param config - the plugin config handed to `apply()` (may be undefined when
 * a host composes the row with no config at all).
 * @returns the resolved section with defaults applied.
 */
export function readScholarSettings(config?: ScholarConfigInput): ScholarSettings {
  const read = <K extends keyof ScholarSettings>(key: K): ScholarSettings[K] => {
    const field: unknown = config?.[key]
    const value: unknown = isVolatileRef(field) ? field.get() : field
    return (value ?? DEFAULT_SCHOLAR_SETTINGS[key]) as ScholarSettings[K]
  }
  return {
    unpaywallEmail: read('unpaywallEmail'),
    s2ApiKeyRef: read('s2ApiKeyRef'),
    astaApiKeyRef: read('astaApiKeyRef'),
    sciverseApiKeyRef: read('sciverseApiKeyRef'),
    cloakEnabled: read('cloakEnabled'),
    proxyUrl: read('proxyUrl'),
    defaultOutputDir: read('defaultOutputDir'),
    maxResultsPerSearch: read('maxResultsPerSearch'),
    fetchTimeoutSec: read('fetchTimeoutSec'),
    maxPdfSizeMb: read('maxPdfSizeMb'),
    s2RequestGapMs: read('s2RequestGapMs'),
  }
}

/**
 * Reject a resolved section the plugin cannot run with.
 *
 * The schema already carries the same bounds, so a settings write cannot store
 * a value this refuses; the check covers the config the running fiber actually
 * carries at activation (a hand-edited patch document or a host that composed
 * the row itself), turning a value that would fail mid-tool-call into one loud
 * startup message.
 * @param config - the resolved section.
 * @throws Error naming the field that cannot be used.
 */
export function assertServiceableScholarSettings(config: ScholarSettings): void {
  for (const [name, value] of [
    ['maxResultsPerSearch', config.maxResultsPerSearch],
    ['fetchTimeoutSec', config.fetchTimeoutSec],
    ['maxPdfSizeMb', config.maxPdfSizeMb],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`dsh-scholar-find: ${name} must be a positive finite number`)
    }
  }
  if (!Number.isFinite(config.s2RequestGapMs) || config.s2RequestGapMs < 0) {
    throw new Error('dsh-scholar-find: s2RequestGapMs must be a non-negative finite number')
  }
  if (config.maxResultsPerSearch > SEARCH_RESULT_CAP) {
    throw new Error(`dsh-scholar-find: maxResultsPerSearch must be no greater than ${SEARCH_RESULT_CAP} (the per-call cap)`)
  }
}
