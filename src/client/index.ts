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
import { ScholarCardController, type ScholarCredentialsApi, type ScholarFieldSpec, type ScholarScopeLike } from './controller.js'
import { NS, en, zh } from './locales.js'

export const name = 'dsh-scholar-find-client'

/**
 * Required client services (cordis fiber inject). `remote` + `remote.credentials`
 * follow the current harness contract for the credentials domain (the same
 * namespaced-remote seam the shipped plugin cards use); the old
 * `connection.api.credentials` seam no longer exists.
 */
export const inject = ['slots', 'settingsScope', 'locale', 'remote', 'remote.credentials'] as const

/**
 * Fields the card edits — kept in sync with the host-side settings schema. The
 * three `secret`-kind entries are write-only key controls: they write the literal
 * to the **DSH credentials domain** (`api.credentials.set`) and clear the box.
 * The record name they write to is the schema-default `credential-ref`
 * (`DEFAULT_S2_KEY_REF` / `DEFAULT_ASTA_KEY_REF` / `DEFAULT_SCIVERSE_KEY_REF`
 * from refs.ts), which is not exposed as a separate field.
 */
const FIELD_SPECS: readonly ScholarFieldSpec[] = [
  { key: 'unpaywallEmail', kind: 'text' },
  { key: 's2ApiKey', kind: 'secret' },
  { key: 'astaApiKey', kind: 'secret' },
  { key: 'sciverseApiKey', kind: 'secret' },
  { key: 'cloakEnabled', kind: 'boolean' },
  { key: 'proxyUrl', kind: 'text' },
  { key: 'defaultOutputDir', kind: 'text' },
  { key: 'maxResultsPerSearch', kind: 'number' },
  { key: 'fetchTimeoutSec', kind: 'number' },
  { key: 'maxPdfSizeMb', kind: 'number' },
  { key: 's2RequestGapMs', kind: 'number' },
]

/**
 * Mount the card. `settingsScope` is provided by the settings domain bundle
 * (the same service the shipped plugin cards bind). The credentials domain
 * (`remote.credentials`) drives the three write-only key controls, so a key
 * change goes to DSH key management rather than the settings section.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-scholar-find: card dictionaries')

  const t = ctx.locale.bind(NS)
  const scope = ctx.settingsScope.bind({ namespace: NS }) as unknown as ScholarScopeLike
  const remote = ctx.get('remote') as { credentials?: ScholarCredentialsApi; $on?: (event: string, fn: (ref: string) => void) => void } | undefined
  const credentials = remote?.credentials
  const controller = new ScholarCardController(
    scope,
    FIELD_SPECS,
    (key: string) => t(key as never),
    credentials ? { credentials } : undefined,
  )

  // A key can be written from elsewhere (e.g. the Models page addresses the
  // same references) — refresh the badge when the Host reports a change.
  remote?.$on?.('credentials/reference-updated', (ref) => controller.refreshCredential(ref))

  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
    locale: NS,
    inject: () => controller.inject(),
  }, ScholarCard))
}