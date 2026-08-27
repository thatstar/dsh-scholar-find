/**
 * Shared settings and validation for the dsh-scholar-find plugin.
 * The namespace shows up in the Web UI as a plugin configuration card
 * (Settings -> Plugins -> Plugin configuration) and persists to
 * `$DSH_HOME/settings.yaml`.
 * @module dsh-scholar-find/settings
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'

/** Settings namespace of this plugin. */
export const SCHOLAR_SETTINGS_NAMESPACE = settingsNamespace('dsh-scholar-find')

/** The resolved settings value (schema-applied defaults). */
export interface ScholarSettings {
  unpaywallEmail: string
  s2ApiKeyRef: string
  scihubEnabled: boolean
  institutionalEnabled: boolean
  cloakEnabled: boolean
  scihubMirrors: string
  proxyUrl: string
  pdfOutputDir: string
  maxResultsPerSearch: number
  fetchTimeoutSec: number
  maxPdfSizeMb: number
  s2RequestGapMs: number
}

/**
 * Schema of the resolved section, typed against {@link ScholarSettings}. All
 * fields carry defaults so the plugin is usable before the user touches the
 * settings page; `unpaywallEmail` is the only field the user really must
 * provide (Unpaywall is skipped without it).
 */
export const ScholarSettingsSchema: z<ScholarSettings> = z.object({
  /** Unpaywall contact email; also sent as Crossref `mailto`. Empty -> Unpaywall skipped. */
  unpaywallEmail: z.string().default(''),
  /** DSH credential reference (record name in ~/.dsh/.credentials.yaml, e.g. `S2_API_KEY`). Empty -> anonymous. */
  s2ApiKeyRef: z.string().default(''),
  /** Sci-Hub last-resort fallback. Decided: off. */
  scihubEnabled: z.boolean().default(false),
  /** Publisher-direct fallback (requires the user's own subscription access). */
  institutionalEnabled: z.boolean().default(false),
  /** Operator opt-in for the CloakBrowser fallback (Cloudflare/WAF-gated PDFs). */
  cloakEnabled: z.boolean().default(false),
  /** Optional comma-separated Sci-Hub mirror override. */
  scihubMirrors: z.string().default(''),
  /** HTTP/HTTPS proxy for outbound OA/PDF fetches, e.g. `http://127.0.0.1:10808`. Empty = off / fall back to env. */
  proxyUrl: z.string().default(''),
  /** Download directory; relative values resolve against the session workspace. */
  pdfOutputDir: z.string().default('scholar-pdfs'),
  /** Default result cap for scholar search tools. */
  maxResultsPerSearch: z.number().default(20),
  /** Per-request HTTP timeout in seconds. */
  fetchTimeoutSec: z.number().default(30),
  /** Download size cap in megabytes. */
  maxPdfSizeMb: z.number().default(50),
  /** S2 pacing override in ms; 0 = auto (1100 ms with key, 5000 ms anonymous). */
  s2RequestGapMs: z.number().default(0),
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
  if (config.maxResultsPerSearch > 1000) {
    throw new Error('dsh-scholar-find: maxResultsPerSearch must be no greater than 1000')
  }
}