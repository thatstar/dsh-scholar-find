import { describe, expect, it } from 'vitest'
import { buildFigureFilename, extractFigureRefs, mapGetResourceError, parseFigureCaption, safeImageBasename, sniffImageType } from '../src/sciverse/resource.js'

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

describe('parseFigureCaption', () => {
  it('extracts a figure number and its descriptive remainder', () => {
    expect(parseFigureCaption('Figure 2. Architecture')).toEqual({ fignum: '2', text: 'Architecture' })
    expect(parseFigureCaption('Fig. 3 Convergence curves')).toEqual({ fignum: '3', text: 'Convergence curves' })
    expect(parseFigureCaption('Fig 4: Results')).toEqual({ fignum: '4', text: 'Results' })
    expect(parseFigureCaption('2. Results')).toEqual({ fignum: '2', text: 'Results' })
  })

  it('returns the full text with no number for a non-figure caption', () => {
    expect(parseFigureCaption('Convergence curves')).toEqual({ text: 'Convergence curves' })
  })

  it('handles blank captions', () => {
    expect(parseFigureCaption('')).toEqual({ text: '' })
    expect(parseFigureCaption('   ')).toEqual({ text: '' })
  })
})

describe('buildFigureFilename', () => {
  it('builds the {doi}_Fig_{n}_Caption_{text} shape', () => {
    expect(buildFigureFilename({ doi: 'paper:10.1038/s41586-021-03819-2', caption: 'Figure 2. Architecture', ext: 'png' }))
      .toBe('10.1038_s41586-021-03819-2_Fig_2_Caption_architecture.png')
  })

  it('omits the Caption segment when the caption is empty/blank', () => {
    expect(buildFigureFilename({ doi: '10.1000/abc', caption: '  ', ext: 'png' })).toBe('10.1000_abc.png')
    expect(buildFigureFilename({ caption: 'Figure 2', ext: 'png' })).toBe('Fig_2.png')
  })

  it('an explicit fignum overrides the number parsed from the caption', () => {
    expect(buildFigureFilename({ doi: '10.1000/x', fignum: '3', caption: 'Figure 2. Something', ext: 'gif' }))
      .toBe('10.1000_x_Fig_3_Caption_something.gif')
  })

  it('captures a valid caption even without a paper id', () => {
    expect(buildFigureFilename({ caption: 'Convergence curves', ext: 'jpg' })).toBe('Caption_convergence_curves.jpg')
  })

  it('falls back to figure when nothing meaningful is provided', () => {
    expect(buildFigureFilename({ ext: 'webp' })).toBe('figure.webp')
  })

  it('sanitises hostile characters and caps length', () => {
    const name = buildFigureFilename({ doi: 'a//b::c', caption: '../../etc/passwd & more!!', ext: 'png' })
    expect(name).not.toMatch(/\.\./)
    expect(name.endsWith('.png')).toBe(true)
    expect(name.length).toBeLessThan(120)
  })
})
