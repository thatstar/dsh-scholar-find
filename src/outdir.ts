/**
 * Centralized output-directory layout for dsh-scholar-find. Every tool writes
 * under a single configurable root (the `defaultOutputDir` setting, default
 * `.scholar`, resolved against the session workspace) and each tool owns its
 * own subdirectory below it — so there is exactly one base folder to manage and
 * no risk of two tools silently diverging onto separate roots.
 * @module dsh-scholar-find/outdir
 */

import { join, resolve } from 'node:path'

/**
 * One subdir per tool/family under the root. Names are kept short and stable:
 * `pdfs` (open-access PDFs), `md` (Markdown conversions), `figs`
 * (sciverse figures), `idem` (batch-idempotency sidecar).
 */
export const OUTPUT_SUBDIRS = {
  pdfs: 'pdfs',
  md: 'md',
  figs: 'figs',
  idem: 'idem',
} as const

export type OutputSubdir = keyof typeof OUTPUT_SUBDIRS

/**
 * Resolve the root output dir (`defaultOutputDir`, default `.scholar`).
 * Absolute values are used as-is; relative values resolve against the session
 * workspace base (`rt.baseDir` / `baseDirOf(exec)`).
 */
export function resolveRootDir(setting: string, base: string): string {
  return resolve(base, setting)
}

/** Resolve one tool's subdirectory beneath the root. */
export function resolveSubDir(root: string, sub: OutputSubdir): string {
  return join(root, OUTPUT_SUBDIRS[sub])
}
