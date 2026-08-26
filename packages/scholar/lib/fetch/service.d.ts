/**
 * Orchestration for the paper_fetch tools: resolve-only, single download, and
 * batch with idempotency. Produces the stable JSON envelopes the tools return.
 * @module dsh-scholar/fetch-service
 */
import type { ScholarClient } from '../s2/client.js';
import type { ScholarSettings } from '../settings.js';
import { type SourceResolution } from './chain.js';
import { type FetchItemResult } from './envelope.js';
export interface FetchRuntime {
    readonly settings: ScholarSettings;
    readonly s2: ScholarClient;
    readonly baseDir: string;
    readonly signal?: AbortSignal;
}
/** Strip common DOI URL prefixes so users can paste bare links. */
export declare function normalizeDoi(doi: string): string;
export declare function isValidDoi(doi: string): boolean;
/** Resolve one DOI to candidates (no download). */
export declare function resolveOne(rt: FetchRuntime, doi: string): Promise<FetchItemResult>;
export interface DownloadOptions {
    overwrite?: boolean;
    checkDns?: boolean;
}
/** Resolve then download; tries every candidate until one validates. */
export declare function fetchOne(rt: FetchRuntime, doi: string, opts?: DownloadOptions): Promise<FetchItemResult>;
/** Batch fetch with per-item results, summary, and retry hints. */
export declare function fetchBatch(rt: FetchRuntime, dois: readonly string[], opts?: DownloadOptions & {
    idempotencyKey?: string;
}): Promise<unknown>;
/** List PDFs already in the library directory. */
export declare function listLibrary(rt: FetchRuntime): Promise<Array<{
    file: string;
    path: string;
}>>;
/** Resolve a title to a DOI (Crossref first, S2 fallback). */
export declare function resolveTitleToDoi(rt: FetchRuntime, title: string): Promise<{
    doi: string | undefined;
    resolution: any;
}>;
/** Check whether a candidate URL is usable for previewing (safety gate only). */
export declare function previewCandidate(c: SourceResolution): {
    source: string;
    pdfUrl: string;
    safe: boolean;
    reason?: string;
};
