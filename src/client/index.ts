/**
 * dsh-scholar-find client half: renders the plugin's settings card inside the
 * Plugins configuration tab. The card registers under the `settings.plugin.item`
 * keyed slot for the `dsh-scholar-find` namespace the host half serves.
 *
 * This entry is bundled into a single self-contained file
 * (`window.__ModuleLoader__.load({ id, factory })`) by
 * `scripts/build-client.mjs` and served by the web shell as
 * `/plugins/dsh-scholar-find/client.js`.
 * @module dsh-scholar-find/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the slot map merge ('settings.plugin.item') and the
// settingsScope / locale Context merges into the client compile.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ScholarCard } from './ScholarCard.js'
import { ScholarCardController, type ScholarFieldSpec, type ScholarScopeLike } from './controller.js'
import { NS, en, zh } from './locales.js'

export const name = 'dsh-scholar-find-client'

/** Required client services (cordis fiber inject). */
export const inject = ['slots', 'settingsScope', 'locale'] as const

/** Fields the card edits — kept in sync with the host-side settings schema. */
const FIELD_SPECS: readonly ScholarFieldSpec[] = [
  { key: 'unpaywallEmail', kind: 'text' },
  { key: 's2ApiKeyRef', kind: 'secret' },
  { key: 'scihubEnabled', kind: 'boolean' },
  { key: 'institutionalEnabled', kind: 'boolean' },
  { key: 'scihubMirrors', kind: 'text' },
  { key: 'pdfOutputDir', kind: 'text' },
  { key: 'maxResultsPerSearch', kind: 'number' },
  { key: 'fetchTimeoutSec', kind: 'number' },
  { key: 'maxPdfSizeMb', kind: 'number' },
  { key: 's2RequestGapMs', kind: 'number' },
]

/**
 * Mount the card. `settingsScope` is provided by the settings domain bundle
 * (the same service the shipped plugin cards bind).
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-scholar-find: card dictionaries')

  const t = ctx.locale.bind(NS)
  const scope = ctx.settingsScope.bind({ namespace: NS }) as unknown as ScholarScopeLike
  const controller = new ScholarCardController(scope, FIELD_SPECS, (key: string) => t(key as never))

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
    locale: NS,
    inject: () => controller.inject(),
  }, ScholarCard))
}