/**
 * The dsh-scholar settings card (client half). Rendered inside the Plugins
 * configuration tab for the `dsh-scholar` namespace via the
 * `settings.plugin.item` keyed slot. Plain React; no CSS modules (the card
 * is self-contained so the served client bundle owns all of its styles).
 * @module dsh-scholar/client-card
 */
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { ScholarCardFace } from './controller.js';
export type ScholarCardProps = PropsRuntime<'settings.plugin.item'> & PropsLocale<'dsh-scholar'> & InjectFace<ScholarCardFace>;
/**
 * Render the dsh-scholar card.
 * @param props - locale copy, the card snapshot hook, and the form actions.
 * @returns the card, or nothing while the namespace is unavailable.
 */
export declare function ScholarCard(props: ScholarCardProps): import("react").JSX.Element | null;
