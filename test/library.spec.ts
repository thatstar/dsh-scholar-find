import { describe, expect, it } from 'vitest'
import { formatLibrary, groupLibraryFiles, LIBRARY_SUBS, pickSubdirs, type LibraryFile } from '../src/library.js'

const files: LibraryFile[] = [
  { sub: 'pdfs', file: 'bond-2021-a.pdf', path: '/ws/.scholar/pdfs/bond-2021-a.pdf' },
  { sub: 'figs', file: 'fig1.png', path: '/ws/.scholar/figs/fig1.png' },
  { sub: 'md', file: 'bond-2021-a.md', path: '/ws/.scholar/md/bond-2021-a.md' },
  { sub: 'html', file: '2402.08954.html', path: '/ws/.scholar/html/2402.08954.html' },
  { sub: 'pdfs', file: 'alpha-2020-b.pdf', path: '/ws/.scholar/pdfs/alpha-2020-b.pdf' },
]

describe('pickSubdirs', () => {
  it('returns all four for absent / unknown / "all"', () => {
    expect(pickSubdirs(undefined)).toEqual(LIBRARY_SUBS)
    expect(pickSubdirs('all')).toEqual(LIBRARY_SUBS)
    expect(pickSubdirs('nope')).toEqual(LIBRARY_SUBS)
  })

  it('restricts to a single named subdir', () => {
    expect(pickSubdirs('pdfs')).toEqual(['pdfs'])
    expect(pickSubdirs('md')).toEqual(['md'])
    expect(pickSubdirs('html')).toEqual(['html'])
    expect(pickSubdirs('figs')).toEqual(['figs'])
  })
})

describe('groupLibraryFiles', () => {
  it('groups by subdir in display order and sorts each', () => {
    const groups = groupLibraryFiles(files)
    expect(groups.map((g) => g.sub)).toEqual(['pdfs', 'md', 'html', 'figs'])
    expect(groups[0]?.files).toEqual(['alpha-2020-b.pdf', 'bond-2021-a.pdf'])
    expect(groups[1]?.files).toEqual(['bond-2021-a.md'])
    expect(groups[2]?.files).toEqual(['2402.08954.html'])
    expect(groups[3]?.files).toEqual(['fig1.png'])
  })

  it('yields empty lists for subs with no files', () => {
    const groups = groupLibraryFiles([{ sub: 'pdfs', file: 'a.pdf', path: '/p/a.pdf' }])
    expect(groups).toEqual([
      { sub: 'pdfs', files: ['a.pdf'] },
      { sub: 'md', files: [] },
      { sub: 'html', files: [] },
      { sub: 'figs', files: [] },
    ])
  })
})

describe('formatLibrary', () => {
  it('renders the root and a per-subdir overview', () => {
    const md = formatLibrary(files, '/ws/.scholar')
    expect(md).toContain('root: `/ws/.scholar`')
    expect(md).toContain('**pdfs (2):**')
    expect(md).toContain('- `alpha-2020-b.pdf`')
    expect(md).toContain('**md (1):**')
    expect(md).toContain('**figs (1):**')
  })

  it('marks an empty subdir as none', () => {
    const md = formatLibrary([{ sub: 'pdfs', file: 'a.pdf', path: '/p/a.pdf' }], '/ws/.scholar')
    expect(md).toContain('**md (0):**')
    expect(md).toContain('_none_')
  })
})
