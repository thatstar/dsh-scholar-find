import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    // The sciverse package ships an ESM entry with extensionless relative
    // imports; vite's resolver handles them, Node's does not. Inline it so
    // tests resolve the SDK through vite.
    server: { deps: { inline: ['sciverse'] } },
  },
})
