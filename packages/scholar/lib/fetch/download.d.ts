/**
 * Downloading and library bookkeeping: deterministic filenames,
 * skip-existing, `%PDF` + size validation through the safety gate, and the
 * idempotency sidecar (`<out>/.paper-fetch-idem/<sha256>.json`).
 * @module dsh-scholar/fetch-download
 */
import type { PaperMeta } from './chain.js';
/** Deterministic filename: {first_author}_{year}_{journal_abbrev}_{title_slug}.pdf */
export declare function buildFilename(meta: PaperMeta, fallbackTitle: string): string;
export declare function journalAbbrev(name: string | undefined, maxLen?: number): string;
export interface DownloadOutcome {
    ok: boolean;
    reason?: 'download_network_error' | 'download_not_a_pdf' | 'download_host_not_allowed' | 'download_size_exceeded' | 'download_io_error';
    detail?: string;
    skipped?: boolean;
}
export interface DownloadOptions {
    readonly timeoutMs: number;
    readonly maxBytes: number;
    readonly signal?: AbortSignal;
    readonly checkDns?: boolean;
}
/**
 * Download `url` to `dest` with the full safety gate. Returns an outcome:
 * `ok: false` means the caller may try the next candidate source.
 */
export declare function downloadPdf(url: string, dest: string, opts: DownloadOptions): Promise<DownloadOutcome>;
export declare function idemLoad(outDir: string, key: string): Promise<unknown | undefined>;
export declare function idemStore(outDir: string, key: string, envelope: unknown): Promise<void>;
/** Resolve the output directory: absolute as-is, relative against `base`. */
export declare function resolveOutDir(pdfOutputDir: string, base: string): string;
export declare function fileExists(path: string): Promise<boolean>;
