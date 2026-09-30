/**
 * dsh-scholar-find — DSH plugin registering:
 *   1. the `dsh-scholar-find` settings section (the plugin's own Cordis
 *      `Config`; edited on the Web UI's Plugins page, persisted to the active
 *      profile's patch document),
 *   2. the `scholar_search_*` / `paper_fetch_*` / `sciverse_*` tools,
 *   3. the resident companion-instructions prompt section (one sentence:
 *      family map + a pointer to the scholar-* skills; falls back to the full
 *      rulebook only on a profile with no skills service),
 *   4. the scholar skills (on-demand: one skill per workflow + the
 *      scholar-tools cross-tool policy + routing map) as runtime skill contributions.
 *
 * Pure TypeScript, Node host, no Python, no vendored upstream code.
 * @module dsh-scholar-find
 */

import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { assertServiceableScholarSettings, readScholarSettings, ScholarConfigSchema, type ScholarSettings, type ScholarConfigInput } from './settings.js'
import { cleanCredentialValue, DEFAULT_ASTA_KEY_REF, DEFAULT_SCIVERSE_KEY_REF, DEFAULT_S2_KEY_REF } from './refs.js'
import { bestEffort } from './util/async.js'
import { applyScholarTools } from './tools/register.js'
import { SCHOLAR_INSTRUCTIONS, SCHOLAR_INSTRUCTIONS_FALLBACK } from './instructions.js'
import { SCHOLAR_SKILLS } from './skills/index.js'
import { configureProxy, resolveProxyUrl } from './fetch/transport.js'

export const name = 'dsh-scholar-find'

/**
 * The plugin's settings/config schema. The loader parses the profile row with
 * this and hands the parsed value to `apply()`; the settings service projects
 * the same schema into the Web UI's form, and every `.volatile()` field is one
 * the user may change without remounting the plugin.
 */
export const Config = ScholarConfigSchema

/**
 * Services this plugin requires before its `apply(ctx, config)` runs.
 *
 * The plugin registers the `scholar_*` / `paper_fetch_*` / `sciverse_*` tools
 * (via `tools`), the resident companion-instructions prompt section (via
 * `systemPrompt`), and the companion skills (via `skills`, accessed guarded
 * below — deliberately NOT declared here, see section 4); API keys are
 * resolved lazily from the `credentials` service. Declaring these lets the
 * loader start the plugin only once every dependency is available.
 *
 * `settings` is deliberately absent: the plugin's configuration no longer
 * needs that service (the schema IS the contract), and only the optional
 * "this entry has its own page" policy below touches it — through the guarded
 * `ctx.inject` child, so a profile without the settings service still loads
 * everything else.
 */
export const inject = ['tools', 'systemPrompt', 'credentials']

/**
 * Minimal mirror of the settings service the installed profile provides
 * (ctx.settings, @deepseek-ai/dsh-settings' SettingsForms) — the ONE method
 * this plugin uses, and only to say "this entry ships its own page". Kept
 * deliberately local: the plugin ships NO import of @deepseek-ai/dsh-settings
 * (runtime or types), so Config and the namespace stay validated by the
 * profile's copy. If the deployed profile changes this shape, the policy just
 * is not registered — the plugin runs without it.
 */
export interface ScholarSettingsService {
  /**
   * Register the calling plugin instance's page policy.
   * @param presentation - automatic-page policy for this instance.
   * @param owner - the plugin fiber the policy belongs to.
   * @returns disposer removing the policy.
   */
  configure(presentation: { auto?: boolean }, owner?: unknown): () => void
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
    source: string
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

export function apply(ctx: Context, config?: ScholarConfigInput): void {
  // 1. Settings -------------------------------------------------------------
  // `config` is the profile row parsed through `Config`: every field is a
  // stable reference the loader updates in place when the user saves, so
  // `source()` always reads the values in force for THIS call.
  const source = (): ScholarSettings => readScholarSettings(config)
  assertServiceableScholarSettings(source())
  // Apply the proxy on boot (falls back to HTTPS_PROXY etc. when unset), and
  // again whenever the loader commits a volatile change — the same signal the
  // settings service writes through, so a saved proxyUrl applies live.
  configureProxy(resolveProxyUrl(source().proxyUrl))
  ctx.effect(() => ctx.on('loader/volatile-update', () => {
    configureProxy(resolveProxyUrl(source().proxyUrl))
  }), 'dsh-scholar-find: proxy follows the live config')

  // The browser half draws this entry's form on the Plugins page itself, so
  // the settings service must not also generate one. Guarded child: a profile
  // without the settings service keeps loading every other registration.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber), 'dsh-scholar-find: own settings page')
  })

  // 2. Tools ----------------------------------------------------------------
  const tools = ctx.get('tools')
  if (tools) {
    // The keys never live in the settings row: the config carries a
    // credential reference (record name) and the value is resolved from the DSH
    // credentials domain. Fail-closed to anonymous, but logged so a mis-typed
    // ref is audible (the card surfaces the same state).
    const resolveCredential = (field: 's2ApiKeyRef' | 'astaApiKeyRef' | 'sciverseApiKeyRef', defaultRef: string, label: string) => async (): Promise<string | undefined> => {
      const refName = source()[field].trim() || defaultRef
      return bestEffort(`${label} api key resolve`, async () => {
        const credentials = ctx.get('credentials')
        if (!credentials) return undefined
        return cleanCredentialValue((await credentials.resolve(credentialRef(refName)))?.value)
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
  // One resident sentence. The section text is a provider (evaluated at every
  // assembly) that degrades to the complete rulebook ONLY when this profile has
  // no skills service — there is then nothing to load on demand, so the rules
  // must stay resident or the plugin would ship guidance-free.
  const systemPrompt = ctx.get('systemPrompt')
  if (systemPrompt) {
    ctx.effect(() => systemPrompt.section({
      name: 'scholar-tools',
      order: 150,
      text: () => ctx.get('skills') ? SCHOLAR_INSTRUCTIONS : SCHOLAR_INSTRUCTIONS_FALLBACK,
    }))
  }

  // 4. Companion skills -----------------------------------------------------
  // Variant C, split: one skill per workflow (recipe + output contract — the
  // `## Output` section is the later extension point for output control) plus
  // the scholar-tools cross-tool policy + routing map. Runtime contributions
  // (ctx.skills.register) — no provider plumbing. 'skills' is deliberately
  // NOT declared in `inject`: cordis holds apply() until every declared
  // service exists, so declaring it would keep the whole plugin (tools,
  // instructions) from loading on profiles without the skill
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
        source: skill.source,
        content: skill.content,
      }))
    }
  }
}
