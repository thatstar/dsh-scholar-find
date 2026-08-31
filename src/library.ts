/**
 * Pure formatting helpers for the `scholar_list_library` tool: group downloaded
 * artifacts by their output subdirectory and render a compact markdown overview.
 * Kept free of filesystem/runtime access so the grouping and rendering logic is
 * unit-testable in isolation.
 * @module dsh-scholar-find/library
 */

import type { OutputSubdir } from './outdir.js'

/** One output artifact discovered under the library root. */
export type LibraryFile = {
  /** Which subdirectory the file lives in (`pdfs`/`md`/`html`/`figs`). */
  sub: OutputSubdir
  /** Base filename. */
  file: string
  /** Absolute path to the file. */
  path: string
}

/** The subdirectories a user can ask to list, and the display order. */
export const LIBRARY_SUBS: OutputSubdir[] = ['pdfs', 'md', 'html', 'figs']

/**
 * Parse the tool's `subdir` argument into the subdirectories to list.
 * An unrecognised/absent value means "all".
 */
export function pickSubdirs(want: string | undefined): OutputSubdir[] {
  if (want === 'pdfs' || want === 'md' || want === 'html' || want === 'figs') return [want]
  return LIBRARY_SUBS
}

/** Group a flat file list by subdirectory (LIBRARY_SUBS order), each sorted. */
export function groupLibraryFiles(files: LibraryFile[]): Array<{ sub: OutputSubdir; files: string[] }> {
  return LIBRARY_SUBS.map((sub) => ({
    sub,
    files: files.filter((f) => f.sub === sub).map((f) => f.file).sort(),
  }))
}

/** Render a compact markdown overview of the library root. */
export function formatLibrary(files: LibraryFile[], root: string): string {
  const groups = groupLibraryFiles(files)
  const lines: string[] = [`**Output library** (root: \`${root}\`)`]
  for (const g of groups) {
    lines.push('', `**${g.sub} (${g.files.length}):**`)
    if (g.files.length === 0) lines.push('_none_')
    else lines.push(...g.files.map((f) => `- \`${f}\``))
  }
  return lines.join('\n')
}
