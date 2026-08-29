/**
 * Shared settings and validation for the dsh-scholar-find plugin.
 * The namespace shows up in the Web UI as a plugin configuration card
 * (Settings -> Plugins -> Plugin configuration) and persists to
 * `$DSH_HOME/settings.yaml`.
 * @module dsh-scholar-find/settings
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { DEFAULT_ASTA_KEY_REF, DEFAULT_SCIVERSE_KEY_REF, DEFAULT_S2_KEY_REF } from './refs.js'

/** Settings namespace of this plugin. */
export const SCHOLAR_SETTINGS_NAMESPACE = settingsNamespace('dsh-scholar-find')

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
 * Schema of the resolved section, typed against {@link ScholarSettings}. All
 * fields carry defaults so the plugin is usable before the user touches the
 * settings page; `unpaywallEmail` is the only field the user really must
 * provide (Unpaywall is skipped without it).
 */
export const ScholarSettingsSchema: z<ScholarSettings> = z.object({
  /** Unpaywall contact email; also sent as Crossref `mailto`. Empty -> Unpaywall skipped. */
  unpaywallEmail: z.string().default(DEFAULT_SCHOLAR_SETTINGS.unpaywallEmail),
  /** DSH credential reference (record name in ~/.dsh/.credentials.yaml; default
   * `DEFAULT_S2_KEY_REF` from refs.ts). Empty -> anonymous. */
  s2ApiKeyRef: z.string().role('credential-ref').default(DEFAULT_SCHOLAR_SETTINGS.s2ApiKeyRef),
  /** DSH credential reference for the Ai2 Asta corpus MCP key (default
   * `DEFAULT_ASTA_KEY_REF` from refs.ts). */
  astaApiKeyRef: z.string().role('credential-ref').default(DEFAULT_SCHOLAR_SETTINGS.astaApiKeyRef),
  /** DSH credential reference for the Sciverse Open Platform token (default
   * `DEFAULT_SCIVERSE_KEY_REF` from refs.ts). Empty -> sciverse_* tools report
   * unconfigured. */
  sciverseApiKeyRef: z.string().role('credential-ref').default(DEFAULT_SCHOLAR_SETTINGS.sciverseApiKeyRef),
  /** Operator opt-in for the CloakBrowser fallback (Cloudflare/WAF-gated PDFs). */
  cloakEnabled: z.boolean().default(DEFAULT_SCHOLAR_SETTINGS.cloakEnabled),
  /** HTTP/HTTPS proxy for outbound OA/PDF fetches, e.g. `http://127.0.0.1:10808`. Empty = off / fall back to env. */
  proxyUrl: z.string().default(DEFAULT_SCHOLAR_SETTINGS.proxyUrl),
  /** Root output directory; relative values resolve against the session
   * workspace. Each tool owns a subdirectory below it (pdfs/md/figs/idem). */
  defaultOutputDir: z.string().default(DEFAULT_SCHOLAR_SETTINGS.defaultOutputDir),
  /** Default result cap for scholar search tools (per-call ceiling is 100). */
  maxResultsPerSearch: z.number().default(DEFAULT_SCHOLAR_SETTINGS.maxResultsPerSearch),
  /** Per-request HTTP timeout in seconds. */
  fetchTimeoutSec: z.number().default(DEFAULT_SCHOLAR_SETTINGS.fetchTimeoutSec),
  /** Download size cap in megabytes. */
  maxPdfSizeMb: z.number().default(DEFAULT_SCHOLAR_SETTINGS.maxPdfSizeMb),
  /** S2 pacing override in ms; 0 = auto (1100 ms with key, 5000 ms anonymous). */
  s2RequestGapMs: z.number().default(DEFAULT_SCHOLAR_SETTINGS.s2RequestGapMs),
})

/**
 * Reject a resolved section the plugin cannot run with. The schema cannot
 * express positivity, so stored values are refused here, at the settings
 * boundary, instead of failing at the first tool call.
 * @param config - the resolved section, schema-valid by construction.
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