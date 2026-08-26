/**
 * Independent TypeScript client for the Semantic Scholar Graph API.
 * Clean-room implementation from the public API docs; no code from the
 * reference skill repos. Built on the Node global `fetch`.
 *
 * Enforces: per-request pacing (auto 1100 ms with a key / 5000 ms anonymous),
 * exponential backoff on 429/504, and a 403-with-key fallback to anonymous.
 * @module dsh-scholar/s2-client
 */
/** Default anonymous pacing, ms. */
export declare const ANONYMOUS_GAP_MS = 5000;
/** Default authenticated pacing, ms. */
export declare const KEYED_GAP_MS = 1100;
/** A semantic-scholar HTTP error with the API message when available. */
export declare class ScholarHttpError extends Error {
    readonly status: number;
    readonly body?: unknown | undefined;
    constructor(status: number, message: string, body?: unknown | undefined);
}
/** S2 paper id forms accepted by the API. */
export type PaperId = string;
/** Shared search filters (snake_case, translated to S2 camelCase params). */
export interface ScholarFilters {
    year?: string;
    publicationDate?: string;
    venue?: string;
    fieldsOfStudy?: string;
    minCitationCount?: number;
    publicationTypes?: string;
    openAccess?: boolean;
}
export interface ScholarClientOptions {
    /** Resolve the API key per request (settings-driven). May be async. */
    readonly apiKey?: () => Promise<string | undefined>;
    /** Pacing override in ms; `0` means auto (keyed/anonymous). */
    readonly minGapMs?: number;
    /** Per-request timeout in ms. */
    readonly timeoutMs?: number;
    /** Cancellation signal forwarded to every request. */
    readonly signal?: AbortSignal;
    /** Backoff override for tests (default: exponential 2s -> 60s). */
    readonly backoffMs?: (attempt: number) => number;
}
export interface ScholarClient {
    readonly request: (method: 'GET' | 'POST', url: string, params?: Record<string, string | undefined>, json?: unknown) => Promise<any>;
    readonly apiKey: () => Promise<string | undefined>;
    readonly minGapMs: () => number;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
}
/** Create one client instance; pacing/auth state is per instance. */
export declare function createScholarClient(options: ScholarClientOptions): ScholarClient;
/** Translate shared snake_case filters to the S2 camelCase query params. */
export declare function toQueryParams(filters?: ScholarFilters): Record<string, string | undefined>;
/** Compose a boolean query string for bulk search. See SKILL reference for syntax. */
export declare function buildBoolQuery(options: {
    phrases?: readonly string[];
    required?: readonly string[];
    excluded?: readonly string[];
    orTerms?: readonly string[];
    fuzzy?: readonly (readonly [term: string, editDistance: number])[];
    proximity?: readonly (readonly [phrase: string, wordDistance: number])[];
}): string;
/** Drop duplicates by paperId, preserving first-seen order. */
export declare function deduplicate<T extends {
    paperId?: string;
}>(papers: readonly T[]): T[];
export declare const DEFAULT_PAPER_FIELDS = "title,year,citationCount,authors,venue,externalIds,tldr";
export declare const BULK_PAPER_FIELDS = "title,year,citationCount,authors,venue,externalIds";
/** Bulk (boolean) search. Up to ~10M results; no tldr on this endpoint. */
export declare function searchBulk(client: ScholarClient, query: string, options?: {
    maxResults?: number;
    sort?: 'citationCount:desc' | 'publicationDate:desc' | 'paperId:asc';
    filters?: ScholarFilters;
    fields?: string;
}): Promise<any[]>;
/** Relevance-ranked search (supports tldr). */
export declare function searchRelevance(client: ScholarClient, query: string, options?: {
    maxResults?: number;
    filters?: ScholarFilters;
    fields?: string;
}): Promise<any[]>;
/** Full-text snippet search. */
export declare function searchSnippets(client: ScholarClient, query: string, options?: {
    maxResults?: number;
    paperIds?: string;
    authors?: string;
    insertedBefore?: string;
}): Promise<any[]>;
/** Exact-title match (single best result envelope). */
export declare function matchTitle(client: ScholarClient, title: string): Promise<any>;
/** Single paper by id (DOI:, ARXIV:, PMID:, PMCID:, CorpusId:, ...). */
export declare function getPaper(client: ScholarClient, paperId: PaperId, fields?: string): Promise<any>;
/** Who cites a paper (with contextsWithIntent when requested). */
export declare function getCitations(client: ScholarClient, paperId: PaperId, options?: {
    maxResults?: number;
    publicationDate?: string;
    withIntents?: boolean;
}): Promise<any[]>;
/** What a paper cites. */
export declare function getReferences(client: ScholarClient, paperId: PaperId, options?: {
    maxResults?: number;
}): Promise<any[]>;
/** Single-seed recommendations. */
export declare function findSimilar(client: ScholarClient, paperId: PaperId, options?: {
    limit?: number;
    pool?: 'recent' | 'all-cs';
}): Promise<any[]>;
/** Multi-seed recommendations with optional negative seeds. */
export declare function recommend(client: ScholarClient, options: {
    positiveIds: readonly string[];
    negativeIds?: readonly string[];
    limit?: number;
}): Promise<any[]>;
/** Search authors by name. */
export declare function searchAuthors(client: ScholarClient, query: string, maxResults?: number): Promise<any[]>;
/** Author profile. */
export declare function getAuthor(client: ScholarClient, authorId: string): Promise<any>;
/** Author publication list. */
export declare function getAuthorPapers(client: ScholarClient, authorId: string, maxResults?: number): Promise<any[]>;
/** Batch paper lookup (<=500 ids). */
export declare function batchPapers(client: ScholarClient, ids: readonly string[], fields?: string): Promise<any[]>;
export declare const S2_ENDPOINTS: {
    readonly GRAPH: "https://api.semanticscholar.org/graph/v1";
    readonly RECS: "https://api.semanticscholar.org/recommendations/v1";
};
