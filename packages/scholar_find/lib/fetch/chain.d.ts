/**
 * The paper_fetch source chain, reimplemented in TypeScript against the
 * public OA APIs: Unpaywall -> Semantic Scholar -> arXiv -> Europe PMC/PMC ->
 * bioRxiv/medRxiv -> publisher direct (institutional opt-in) -> Sci-Hub
 * (opt-in, off by decision). Each resolver returns PDF URL candidates plus
 * metadata; the download loop validates and writes.
 * @module dsh-scholar-find/fetch-chain
 */
import type { ScholarClient } from '../s2/client.js';
export interface PaperMeta {
    title?: string;
    year?: number | string;
    author?: string;
    journal?: string;
}
export interface SourceResolution {
    /** Human-readable source label of the hit. */
    source: string;
    /** Candidate PDF URL. */
    pdfUrl: string;
    /** Metadata merged so far (title/year/author/journal). */
    meta: PaperMeta;
    /** External ids learned along the way (ArXiv, PubMedCentral, DOI). */
    ext: Record<string, string>;
    /** Extra diagnostics for the envelope (e.g. Sci-Hub mirror). */
    detail?: Record<string, string>;
}
export interface ChainContext {
    readonly doi: string;
    readonly email: string;
    readonly s2: ScholarClient;
    readonly institutional: boolean;
    readonly scihubEnabled: boolean;
    readonly scihubMirrors: string;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
}
/**
 * Resolve one DOI to the ordered candidate list (URL + source + merged meta),
 * following the documented chain. Never downloads; the caller does that.
 */
export declare function resolveChain(ctx: ChainContext): Promise<{
    candidates: SourceResolution[];
    sourcesTried: readonly string[];
    meta: PaperMeta;
    ext: Record<string, string>;
}>;
/** Publisher-direct URL templates by DOI prefix (institutional mode). */
export declare function publisherCandidates(doi: string, timeoutMs: number): Array<[publisher: string, url: string]>;
/** Pull the PDF src out of a Sci-Hub page (iframe/embed). */
export declare function extractScihubPdf(html: string, base: string): string | undefined;
export interface TitleResolution {
    query: string;
    resolver: 'crossref' | 'semantic_scholar';
    resolversTried: readonly string[];
    resolvedDoi: string;
    resolvedTitle?: string;
    matchScore?: number;
    candidates: unknown[];
    lowConfidence: boolean;
    lowConfidenceReason?: string;
}
/** Resolve a paper title to a DOI. Crossref primary, S2 match fallback. */
export declare function resolveTitle(title: string, ctx: {
    email: string;
    s2: ScholarClient;
    timeoutMs: number;
    signal?: AbortSignal;
}): Promise<{
    doi: string | undefined;
    resolution: TitleResolution;
}>;
