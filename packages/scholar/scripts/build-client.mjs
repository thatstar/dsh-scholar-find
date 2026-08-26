// Build the self-contained client bundle (web shell contract C6):
// window.__ModuleLoader__.load({ id, factory(require) }) — CJS-style factory
// with externals resolved by the page's module table.
import { build } from 'esbuild'
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const result = await build({
  entryPoints: [join(root, 'src', 'client', 'index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  // Externals come from the page's module table (import map), never bundled.
  external: ['react', 'react/jsx-runtime', 'react-dom', '@deepseek-ai/*'],
  write: false,
  logLevel: 'info',
})

const code = result.outputFiles[0].text.replace(/\s*\/\/# sourceMappingURL=.*$/, '')
const wrapped = `window.__ModuleLoader__.load({
  id: 'dsh-scholar-find',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${code}
    return module.exports;
  }
});
`
await writeFile(join(root, 'lib', 'client.js'), wrapped)
console.log('built lib/client.js')