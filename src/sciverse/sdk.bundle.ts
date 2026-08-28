/**
 * The `sciverse` SDK surface used by the plugin.
 *
 * Three roles in one file:
 *  - esbuild ENTRY: scripts/build-sciverse.mjs bundles this file (bundler
 *    resolution handles the package's extensionless ESM entry) into
 *    lib/sciverse/sdk.bundle.js — the artifact the DEPLOYED host imports.
 *  - tsc twin: compiled to lib/sciverse/sdk.bundle.js first, then overwritten
 *    by the esbuild bundle during `npm run build` (never loaded directly).
 *  - vitest target: tests import './sdk.bundle.js' from client.ts; vitest
 *    resolves this file and inlines 'sciverse' (see vitest.config.ts).
 */
export { AgentToolsClient } from 'sciverse'
export type { AgentToolsClientOptions } from 'sciverse'
