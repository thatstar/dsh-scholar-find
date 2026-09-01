/**
 * dsh-scholar-find — DSH plugin registering:
 *   1. the `dsh-scholar-find` settings section (Web UI: Settings -> Plugins ->
 *      Plugin configuration; persisted to $DSH_HOME/settings.yaml),
 *   2. the `scholar_search_*` / `paper_fetch_*` / `sciverse_*` tools,
 *   3. the resident companion-instructions prompt section (slim core: family
 *      map + Shared behavior + skill routing map),
 *   4. the scholar skills (on-demand: one skill per workflow + the
 *      scholar-tools per-tool catalog) as runtime skill contributions.
 *
 * Pure TypeScript, Node host, no Python, no vendored upstream code.
 * @module dsh-scholar-find
 */

import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-tools'
import { assertServiceableScholarSettings, DEFAULT_SCHOLAR_SETTINGS, ScholarSettingsSchema, SCHOLAR_SETTINGS_NAMESPACE, type ScholarSettings } from './settings.js'
import { DEFAULT_ASTA_KEY_REF, DEFAULT_SCIVERSE_KEY_REF, DEFAULT_S2_KEY_REF } from './refs.js'
import { bestEffort } from './util/async.js'
import { applyScholarTools } from './tools/register.js'
import { SCHOLAR_INSTRUCTIONS } from './instructions.js'
import { SCHOLAR_SKILLS } from './skills/index.js'
import { configureProxy, resolveProxyUrl } from './fetch/transport.js'

export const name = 'dsh-scholar-find'

/**
 * Services this plugin requires before its `apply(ctx)` runs.
 *
 * The plugin registers a settings section (via the `settings` service), the
 * `scholar_*` / `paper_fetch_*` / `sciverse_*` tools (via `tools`), the
 * resident companion-instructions prompt section (via `systemPrompt`), and
 * the companion skills (via `skills`, accessed guarded below — deliberately
 * NOT declared here, see section 4); API keys are resolved lazily from the
 * `credentials` service. Declaring these lets the loader start the plugin
 * only once every dependency is available.
 */
export const inject = ['settings', 'tools', 'systemPrompt', 'credentials']

/**
 * Minimal mirror of the settings service the installed profile provides
 * (ctx.settings, @deepseek-ai/dsh-settings' SettingsProvider) — the ONE method
 * this plugin uses. Deliberately local: the plugin ships NO import of
 * @deepseek-ai/dsh-settings (runtime or types), so the namespace, the schema,
 * and the registration are all validated by the profile's copy at runtime.
 * An upstream API change therefore fails loudly at plugin activation instead
 * of being silently masked by a private nested copy of the package. If the
 * deployed profile upgrades and this mirror's shape no longer matches, that IS
 * the intended signal.
 */
export interface ScholarSettingsService {
  installSection<const Namespace extends string, T>(
    owner: unknown,
    ns: Namespace,
    schema: unknown,
    entry: T,
    hooks: {
      setSource(current: () => T): void
      onChange(): void
      validate?(value: T): void
    },
  ): void
}

/**
 * Minimal mirror of the skills registry (ctx.skills, the profile's
 * SkillRegistry from @deepseek-ai/dsh-skill) — the ONE method this plugin
 * uses. Deliberately local, same pattern as ScholarSettingsService: no import
 * of dsh-skill, so an upstream shape change fails loudly at plugin activation
 * instead of being silently masked.
 */
export interface ScholarSkillsService {
  /**
   * Runtime skill contribution. Omitted `invocation` defaults to model- and
   * user-invocable. Returns the unregister disposer.
   */
  register(skill: {
    name: string
    description: string
    whenToUse?: string
    content: string
    invocation?: { readonly modelInvocable: boolean; readonly userInvocable: boolean }
    provider?: string
  }): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    settings: ScholarSettingsService
    skills: ScholarSkillsService
  }
}

export function apply(ctx: Context): void {
  let source: () => ScholarSettings = () => DEFAULT_SCHOLAR_SETTINGS

  // 1. Settings section -----------------------------------------------------
  // Service call (not a package import): the profile's dsh-settings registers
  // the namespace, applies the schema defaults, and validates the stored
  // section; our hooks mirror the old installSettingsSection contract exactly.
  ctx.settings.installSection(ctx, SCHOLAR_SETTINGS_NAMESPACE, ScholarSettingsSchema, DEFAULT_SCHOLAR_SETTINGS, {
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
    // The keys never live in the settings section: the section carries a
    // credential reference (record name) and the value is resolved from the DSH
    // credentials domain. Fail-closed to anonymous, but logged so a mis-typed
    // ref is audible (the card surfaces the same state).
    const resolveCredential = (field: 's2ApiKeyRef' | 'astaApiKeyRef' | 'sciverseApiKeyRef', defaultRef: string, label: string) => async (): Promise<string | undefined> => {
      const refName = source()[field].trim() || defaultRef
      return bestEffort(`${label} api key resolve`, async () => {
        const credentials = ctx.get('credentials')
        if (!credentials) return undefined
        return (await credentials.resolve(credentialRef(refName)))?.value
      })
    }
    applyScholarTools(ctx, {
      settings: () => source(),
      resolveApiKey: resolveCredential('s2ApiKeyRef', DEFAULT_S2_KEY_REF, 's2'),
      resolveAstaKey: resolveCredential('astaApiKeyRef', DEFAULT_ASTA_KEY_REF, 'asta'),
      resolveSciverseKey: resolveCredential('sciverseApiKeyRef', DEFAULT_SCIVERSE_KEY_REF, 'sciverse'),
    })
  }

  // 3. Companion instructions ----------------------------------------------
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt) {
    ctx.effect(() => systemPrompt.section({ name: 'scholar-tools', order: 150, text: SCHOLAR_INSTRUCTIONS }))
  }

  // 4. Companion skills -----------------------------------------------------
  // Variant C, split: one skill per workflow (recipe + output contract — the
  // `## Output` section is the later extension point for output control) plus
  // the scholar-tools per-tool catalog. Runtime contributions
  // (ctx.skills.register) — no provider plumbing. 'skills' is deliberately
  // NOT declared in `inject`: cordis holds apply() until every declared
  // service exists, so declaring it would keep the whole plugin (settings,
  // 27 tools, instructions) from loading on profiles without the skill
  // service. ctx.get() returns undefined instead (service absent or not yet
  // started — never throws); we skip then, and the resident section above
  // remains the complete behavioral floor (fail-open). Registry duplicate
  // names warn-and-ignore, so a name collision degrades safely.
  const skills = ctx.get('skills')
  if (skills) {
    for (const skill of SCHOLAR_SKILLS) {
      ctx.effect(() => skills.register({
        name: skill.name,
        description: skill.description,
        whenToUse: skill.whenToUse,
        content: skill.content,
      }))
    }
  }
}
