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
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
export declare const name = "dsh-scholar-find-client";
/** Required client services (cordis fiber inject). */
export declare const inject: readonly ["slots", "settingsScope", "locale"];
/**
 * Mount the card. `settingsScope` is provided by the settings domain bundle
 * (the same service the shipped plugin cards bind).
 * @param ctx - the browser plugin context.
 */
export declare function apply(ctx: ClientContext): void;
