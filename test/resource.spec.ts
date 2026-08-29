import { describe, expect, it } from 'vitest'
import { buildFigureName, extractFigureRefs, mapGetResourceError, safeImageBasename, sniffImageType } from '../src/sciverse/resource.js'

describe('sniffImageType', () => {
  it('detects PNG, JPEG, GIF and WebP from magic bytes', () => {
    expect(sniffImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({ kind: 'png', mimeType: 'image/png', ext: 'png' })
    expect(sniffImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toEqual({ kind: 'jpeg', mimeType: 'image/jpeg', ext: 'jpg' })
    expect(sniffImageType(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toEqual({ kind: 'gif', mimeType: 'image/gif', ext: 'gif' })
    // WebP: "RIFF"...."WEBP"
    const webp = new Uint8Array(12)
    webp.set([0x52, 0x49, 0x46, 0x46]) // RIFF
    webp.set([0x57, 0x45, 0x42, 0x50], 8) // WEBP
    expect(sniffImageType(webp)).toEqual({ kind: 'webp', mimeType: 'image/webp', ext: 'webp' })
  })

  it('returns null for non-image / truncated bytes', () => {
    expect(sniffImageType(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))).toBeNull()
    expect(sniffImageType(new Uint8Array([0x23, 0x21]))).toBeNull()
    expect(sniffImageType(new Uint8Array(0))).toBeNull()
    // A HTML error page must not be mis-sniffed as an image.
    expect(sniffImageType(new TextEncoder().encode('<!DOCTYPE html>'))).toBeNull()
  })
})

describe('safeImageBasename', () => {
  it('flattens a nested Sciverse asset path to a single file', () => {
    expect(safeImageBasename('dt=2026-05-28/ht=18/fig1.jpg', 'png')).toBe('fig1.png')
  })

  it('locks the extension to the sniffed type', () => {
    expect(safeImageBasename('chart.png', 'jpg')).toBe('chart.jpg')
    expect(safeImageBasename('noext', 'gif')).toBe('noext.gif')
  })

  it('neutralises path traversal and hostile characters', () => {
    expect(safeImageBasename('../../etc/passwd.png', 'png')).toBe('passwd.png')
    // Backslash is a path separator -> only the last segment survives.
    expect(safeImageBasename('..\\a b\x01c.gif', 'gif')).toBe('a_b_c.gif')
  })

  it('falls back to a safe name when nothing usable remains', () => {
    expect(safeImageBasename('', 'png')).toBe('figure.png')
    expect(safeImageBasename('...', 'jpg')).toBe('figure.jpg')
  })
})

describe('mapGetResourceError', () => {
  it('maps 429 to a retryable rate_limited hint', () => {
    const r = mapGetResourceError(new Error('HTTP 429: rate limited'))
    expect(r.code).toBe('rate_limited')
    expect(r.retryable).toBe(true)
    expect(r.markdown.toLowerCase()).toContain('back off')
  })

  it('maps timeouts to retryable timeout', () => {
    const r = mapGetResourceError(new Error('timeout after 60000ms'))
    expect(r.code).toBe('timeout')
    expect(r.retryable).toBe(true)
  })

  it('maps 404 to a non-retryable not_found', () => {
    const r = mapGetResourceError(new Error('HTTP 404: not found'))
    expect(r.code).toBe('not_found')
    expect(r.retryable).toBe(false)
  })

  it('maps 403 to forbidden and 5xx to a retryable server_error', () => {
    expect(mapGetResourceError(new Error('403 Forbidden'))).toMatchObject({ code: 'forbidden', retryable: false })
    expect(mapGetResourceError(new Error('HTTP 500 server error'))).toMatchObject({ code: 'server_error', retryable: true })
  })

  it('falls back to a retryable network_error for anything else', () => {
    const r = mapGetResourceError(new TypeError('fetch failed'))
    expect(r.code).toBe('network_error')
    expect(r.retryable).toBe(true)
  })
})

describe('extractFigureRefs', () => {
  it('captures both file_name and caption (alt) from ![...](...)', () => {
    const md = 'Text before\n![Figure 2. Architecture of the model](5bc89b37.jpg)\nText after\n'
    expect(extractFigureRefs(md)).toEqual([{ file_name: '5bc89b37.jpg', caption: 'Figure 2. Architecture of the model' }])
  })

  it('returns empty caption for a bare ![](file) and de-dupes by file_name', () => {
    const md = '![a](x.png) ![b](x.png) ![](y.png)'
    expect(extractFigureRefs(md)).toEqual([
      { file_name: 'x.png', caption: 'a' },
      { file_name: 'y.png', caption: '' },
    ])
  })

  it('yields nothing for a text slice with no figure placeholders', () => {
    expect(extractFigureRefs('just some prose, no images')).toEqual([])
  })
})

describe('buildFigureName', () => {
  it('builds a paper-scoped, caption-suffixed name', () => {
    expect(buildFigureName({ paper: 'paper:10.1038/s41586-021-03819-2', caption: 'Figure 2. Architecture', ext: 'png' }))
      .toBe('10-1038-s41586-021-03819-2-figure-2-architecture.png')
  })

  it('keeps a caption-only name and falls back to figure', () => {
    expect(buildFigureName({ caption: 'Convergence curves', ext: 'jpg' })).toBe('convergence-curves.jpg')
    expect(buildFigureName({ paper: 'My Paper Title', ext: 'gif' })).toBe('my-paper-title-figure.gif')
    expect(buildFigureName({ ext: 'webp' })).toBe('figure.webp')
  })

  it('sanitises hostile characters and caps length', () => {
    const name = buildFigureName({ paper: 'a//b::c', caption: '../../etc/passwd & more!!', ext: 'png' })
    expect(name).not.toMatch(/\.\./)
    expect(name.endsWith('.png')).toBe(true)
    expect(name.length).toBeLessThan(120)
  })
})
