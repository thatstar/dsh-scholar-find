/**
 * Tool registration for dsh-scholar: `scholar_search_*` and `paper_fetch_*`
 * families, defined with `defineTool` and registered into `ctx.tools`.
 * @module dsh-scholar/tools
 */
import { Context } from '@deepseek-ai/cordis';
import type { ScholarSettings } from '../settings.js';
export interface ScholarToolEnv {
    /** Live settings source (updates without restart). */
    readonly settings: () => ScholarSettings;
    /** Resolve the S2 api key through the DSH credentials seam. */
    readonly resolveApiKey: () => Promise<string | undefined>;
}
/** Register every scholar tool; returns a disposer that unregisters all. */
export declare function applyScholarTools(ctx: Context, env: ScholarToolEnv): () => void;
