/**
 * The dsh-scholar-find settings card (client half). Rendered inside the Plugins
 * configuration tab for the `dsh-scholar-find` namespace via the
 * `settings.plugin.item` keyed slot. The markup and design tokens mirror the
 * shipped `PluginCard`/`ValueField` cards so it reads as part of the same
 * surface (the shipped components are not publicly exportable, so the card
 * draws its own DOM using the same `--dsw-alias-*` theme variables).
 * @module dsh-scholar-find/client-card
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ScholarCardFace } from './controller.js';
export type ScholarCardProps = PropsRuntime<'settings.plugin.item'> & PropsLocale<'dsh-scholar-find'> & InjectFace<ScholarCardFace>;
/**
 * Render the dsh-scholar-find card, mirroring the shipped plugin-card chrome.
 * @param props - locale copy, the card snapshot hook, and the form actions.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export declare function ScholarCard(props: ScholarCardProps): import("react").JSX.Element | null;
