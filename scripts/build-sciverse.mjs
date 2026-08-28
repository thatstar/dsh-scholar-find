// Bundle the `sciverse` SDK into a single self-contained ESM file for the host.
//
// Why: the published package entry (dist/index.js) uses extensionless relative
// imports (`from "./client"`), which plain Node ESM cannot resolve at runtime
// (ERR_MODULE_NOT_FOUND). esbuild's bundler resolution handles extensionless
// imports, so we bundle just the surface we use — `AgentToolsClient` +
// `AgentToolsClientOptions` from src/sciverse/sdk.ts — into
// lib/sciverse/sdk.bundle.js. Node builtins stay external. Reinstall-safe: no
// node_modules patching.
import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
await build({
  entryPoints: [join(root, 'src', 'sciverse', 'sdk.bundle.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  outfile: join(root, 'lib', 'sciverse', 'sdk.bundle.js'),
  logLevel: 'info',
})
console.log('built lib/sciverse/sdk.bundle.js')