/**
 * dsh-scholar-find client half: renders the plugin's configuration page on the
 * Web UI's Plugins page. The page registers into `plugins.bundle.config` —
 * keyed by the package name, the slot the plugin manager renders on a bundle's
 * own page — and only while the Host serves this plugin's settings entry, so a
 * deployment that did not load the plugin shows no trace of it.
 *
 * This entry is bundled into a single self-contained file
 * (`window.__ModuleLoader__.load({ id, factory })`) by
 * `scripts/build-client.mjs` and served by the web shell as
 * `/plugins/dsh-scholar-find/client.js`.
 *
 * Type-only imports pull the service and slot declarations (`ctx.slots`,
 * `ctx.locale`, `ctx.configForms`, `plugins.bundle.config`) into the client
 * compile; the only modules the bundle requires at runtime are React and the
 * platform-seeded UI primitives.
 * @module dsh-scholar-find/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { ScholarCard } from './ScholarCard.js'
import { ScholarCardController, type ScholarCredentialsApi } from './controller.js'
import { NS, en, zh } from './locales.js'
import { SCHOLAR_ENTRY_ID, SCHOLAR_PACKAGE_NAME } from '../refs.js'

export const name = 'dsh-scholar-find-client'

/**
 * Required client services (cordis fiber inject). `configForms` is the shared
 * per-entry form the settings domain owns; `remote.credentials` is the
 * generated Remote namespace the three write-only key controls write through.
 */
export const inject = ['slots', 'locale', 'configForms', 'remote', 'remote.credentials'] as const

/** The Remote face this half reads keys through (structural: no value import of a client package). */
interface ScholarRemoteLike {
  credentials?: ScholarCredentialsApi
  /** Host-reported credential change; the ref is the record that moved. */
  $on?(event: string, listener: (ref: string) => void): () => void
}

/**
 * Mount the settings page while the Host serves this plugin's entry.
 * @param ctx - the browser plugin context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-scholar-find: card dictionaries')

  const t = ctx.locale.bind(NS)
  const remote = ctx.get('remote') as ScholarRemoteLike | undefined
  const card = new ScholarCardController(ctx.configForms.get(SCHOLAR_ENTRY_ID), remote?.credentials)
  ctx.effect(() => () => { card.dispose() }, 'dsh-scholar-find: form subscription')

  // A key can be written from elsewhere (e.g. the Models page addresses the
  // same records) — refresh the badge when the Host reports a change.
  ctx.effect(
    () => remote?.$on?.('credentials/reference-updated', (ref) => { card.refreshCredential(ref) }) ?? (() => {}),
    'dsh-scholar-find: credential invalidations',
  )

  ctx.effect(() => ctx.configForms.whileServed([SCHOLAR_ENTRY_ID], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config',
    key: SCHOLAR_PACKAGE_NAME,
    locale: NS,
    inject: () => card.inject(),
  }, ScholarCard))), 'dsh-scholar-find: settings page')
}
