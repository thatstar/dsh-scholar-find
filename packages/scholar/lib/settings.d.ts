/**
 * Shared settings and validation for the dsh-scholar-find plugin.
 * The namespace shows up in the Web UI as a plugin configuration card
 * (Settings -> Plugins -> Plugin configuration) and persists to
 * `$DSH_HOME/settings.yaml`.
 * @module dsh-scholar-find/settings
 */
import z from '@deepseek-ai/schemastery';
/** Settings namespace of this plugin. */
export declare const SCHOLAR_SETTINGS_NAMESPACE: import("@deepseek-ai/dsh-settings").SettingsNamespace;
/** The resolved settings value (schema-applied defaults). */
export interface ScholarSettings {
    unpaywallEmail: string;
    s2ApiKeyRef: string;
    scihubEnabled: boolean;
    institutionalEnabled: boolean;
    scihubMirrors: string;
    pdfOutputDir: string;
    maxResultsPerSearch: number;
    fetchTimeoutSec: number;
    maxPdfSizeMb: number;
    s2RequestGapMs: number;
}
/**
 * Schema of the resolved section, typed against {@link ScholarSettings}. All
 * fields carry defaults so the plugin is usable before the user touches the
 * settings page; `unpaywallEmail` is the only field the user really must
 * provide (Unpaywall is skipped without it).
 */
export declare const ScholarSettingsSchema: z<ScholarSettings>;
/**
 * Reject a resolved section the plugin cannot run with. The schema cannot
 * express positivity, so stored values are refused here, at the settings
 * boundary, instead of failing at the first tool call.
 * @param config - the resolved section, schema-valid by construction.
 * @throws Error naming the field that cannot be used.
 */
export declare function assertServiceableScholarSettings(config: ScholarSettings): void;
