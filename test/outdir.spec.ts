import { describe, expect, it } from 'vitest'
import { OUTPUT_SUBDIRS, resolveRootDir, resolveSubDir } from '../src/outdir.js'

describe('resolveRootDir', () => {
  it('uses the setting unchanged when it is absolute', () => {
    expect(resolveRootDir('/data/scholar', '/tmp/ws')).toBe('/data/scholar')
  })

  it('resolves a relative setting against the workspace base', () => {
    expect(resolveRootDir('.scholar', '/tmp/ws')).toBe('/tmp/ws/.scholar')
  })

  it('handles a nested relative setting', () => {
    expect(resolveRootDir('papers/library', '/tmp/ws')).toBe('/tmp/ws/papers/library')
  })
})

describe('resolveSubDir', () => {
  it('joins each tool subdir under the root', () => {
    const root = resolveRootDir('.scholar', '/tmp/ws')
    expect(resolveSubDir(root, 'pdfs')).toBe('/tmp/ws/.scholar/pdfs')
    expect(resolveSubDir(root, 'md')).toBe('/tmp/ws/.scholar/md')
    expect(resolveSubDir(root, 'figs')).toBe('/tmp/ws/.scholar/figs')
    expect(resolveSubDir(root, 'idem')).toBe('/tmp/ws/.scholar/idem')
  })

  it('exposes exactly the four expected subdirs', () => {
    expect(Object.keys(OUTPUT_SUBDIRS).sort()).toEqual(['figs', 'idem', 'md', 'pdfs'])
  })
})
