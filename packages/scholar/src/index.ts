/**
 * dsh-scholar — DSH plugin registering:
 *   1. the `dsh-scholar` settings section (Web UI: Settings -> Plugins ->
 *      Plugin configuration; persisted to $DSH_HOME/settings.yaml),
 *   2. the `scholar_search_*` / `paper_fetch_*` tools,
 *   3. the companion-instructions prompt section.
 *
 * Pure TypeScript, Node host, no Python, no vendored upstream code.
 * @module dsh-scholar
 */

import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import { assertServiceableScholarSettings, ScholarSettingsSchema, SCHOLAR_SETTINGS_NAMESPACE, type ScholarSettings } from './settings.js'
import { applyScholarTools } from './tools/register.js'
import { SCHOLAR_INSTRUCTIONS } from './instructions.js'

/** Schema defaults (the composition base layer of the settings section). */
export const DEFAULT_SCHOLAR_SETTINGS: ScholarSettings = {
  unpaywallEmail: '',
  s2ApiKeyRef: '',
  scihubEnabled: false,
  institutionalEnabled: false,
  scihubMirrors: '',
  pdfOutputDir: 'scholar-pdfs',
  maxResultsPerSearch: 20,
  fetchTimeoutSec: 30,
  maxPdfSizeMb: 50,
  s2RequestGapMs: 0,
}

export const name = 'dsh-scholar'

export function apply(ctx: Context): void {
  let source: () => ScholarSettings = () => DEFAULT_SCHOLAR_SETTINGS

  // 1. Settings section -----------------------------------------------------
  installSettingsSection(ctx, SCHOLAR_SETTINGS_NAMESPACE, ScholarSettingsSchema, DEFAULT_SCHOLAR_SETTINGS, {
    validate: assertServiceableScholarSettings,
    setSource: (current) => {
      source = current
    },
    onChange: () => {
      // Every tool reads the settings source getter live, so nothing derived
      // needs rebuilding when the document changes.
    },
  })

  // 2. Tools ----------------------------------------------------------------
  const tools = ctx.get('tools')
  if (tools) {
    applyScholarTools(ctx, {
      settings: () => source(),
      resolveApiKey: async () => {
        const refName = source().s2ApiKeyRef.trim()
        if (!refName) return undefined
        try {
          const credentials = ctx.get('credentials')
          if (!credentials) return undefined
          const resolved = await credentials.resolve(credentialRef(refName))
          return resolved?.value
        } catch {
          return undefined
        }
      },
    })
  }

  // 3. Companion instructions ----------------------------------------------
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt) {
    ctx.effect(() => systemPrompt.section({ name: 'scholar-tools', order: 150, text: SCHOLAR_INSTRUCTIONS }))
  }
}