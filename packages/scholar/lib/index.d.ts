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
import { Context } from '@deepseek-ai/cordis';
import { type ScholarSettings } from './settings.js';
/** Schema defaults (the composition base layer of the settings section). */
export declare const DEFAULT_SCHOLAR_SETTINGS: ScholarSettings;
export declare const name = "dsh-scholar";
export declare function apply(ctx: Context): void;
