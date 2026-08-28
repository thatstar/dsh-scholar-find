/**
 * dsh-scholar-find — DSH plugin registering:
 *   1. the `dsh-scholar-find` settings section (Web UI: Settings -> Plugins ->
 *      Plugin configuration; persisted to $DSH_HOME/settings.yaml),
 *   2. the `scholar_search_*` / `paper_fetch_*` tools,
 *   3. the companion-instructions prompt section.
 *
 * Pure TypeScript, Node host, no Python, no vendored upstream code.
 * @module dsh-scholar-find
 */

import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import { assertServiceableScholarSettings, DEFAULT_SCHOLAR_SETTINGS, ScholarSettingsSchema, SCHOLAR_SETTINGS_NAMESPACE, type ScholarSettings } from './settings.js'
import { DEFAULT_ASTA_KEY_REF, DEFAULT_S2_KEY_REF } from './refs.js'
import { applyScholarTools } from './tools/register.js'
import { SCHOLAR_INSTRUCTIONS } from './instructions.js'
import { configureProxy, resolveProxyUrl } from './fetch/transport.js'

export const name = 'dsh-scholar-find'

export function apply(ctx: Context): void {
  let source: () => ScholarSettings = () => DEFAULT_SCHOLAR_SETTINGS

  // 1. Settings section -----------------------------------------------------
  installSettingsSection(ctx, SCHOLAR_SETTINGS_NAMESPACE, ScholarSettingsSchema, DEFAULT_SCHOLAR_SETTINGS, {
    validate: assertServiceableScholarSettings,
    setSource: (current) => {
      source = current
    },
    onChange: () => {
      // Proxy is read live so a settings change applies without a restart.
      configureProxy(resolveProxyUrl(source().proxyUrl))
    },
  })
  // Apply the proxy on boot (falls back to HTTPS_PROXY etc. when unset).
  configureProxy(resolveProxyUrl(source().proxyUrl))

  // 2. Tools ----------------------------------------------------------------
  const tools = ctx.get('tools')
  if (tools) {
    applyScholarTools(ctx, {
      settings: () => source(),
      resolveApiKey: async () => {
        // The key never lives in the settings section: the section carries a
        // credential reference (record name), and the value is resolved from
        // the DSH credentials domain.
        const refName = source().s2ApiKeyRef.trim() || DEFAULT_S2_KEY_REF
        try {
          const credentials = ctx.get('credentials')
          if (!credentials) return undefined
          return (await credentials.resolve(credentialRef(refName)))?.value
        } catch {
          return undefined
        }
      },
      resolveAstaKey: async () => {
        const refName = source().astaApiKeyRef.trim() || DEFAULT_ASTA_KEY_REF
        try {
          const credentials = ctx.get('credentials')
          if (!credentials) return undefined
          return (await credentials.resolve(credentialRef(refName)))?.value
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