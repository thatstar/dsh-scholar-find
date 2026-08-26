/**
 * Independent TypeScript client for the Semantic Scholar Graph API.
 * Clean-room implementation from the public API docs; no code from the
 * reference skill repos. Built on the Node global `fetch`.
 *
 * Enforces: per-request pacing (auto 1100 ms with a key / 5000 ms anonymous),
 * exponential backoff on 429/504, and a 403-with-key fallback to anonymous.
 * @module dsh-scholar-find/s2-client
 */
const GRAPH = 'https://api.semanticscholar.org/graph/v1';
const RECS = 'https://api.semanticscholar.org/recommendations/v1';
/** Max backoff wait between retries, ms. */
const MAX_BACKOFF_MS = 60_000;
/** Retry count for 429/504 and connection failures. */
const MAX_RETRIES = 5;
/** Default anonymous pacing, ms. */
export const ANONYMOUS_GAP_MS = 5_000;
/** Default authenticated pacing, ms. */
export const KEYED_GAP_MS = 1_100;
/** A semantic-scholar HTTP error with the API message when available. */
export class ScholarHttpError extends Error {
    status;
    body;
    constructor(status, message, body) {
        super(message);
        this.status = status;
        this.body = body;
        this.name = 'ScholarHttpError';
    }
}
/** Create one client instance; pacing/auth state is per instance. */
export function createScholarClient(options) {
    let lastRequestAt = 0;
    let keyInvalid = false;
    async function currentKey() {
        if (keyInvalid)
            return undefined;
        const key = options.apiKey ? await options.apiKey() : undefined;
        return key?.trim() ? key : undefined;
    }
    function gapMs() {
        const override = options.minGapMs;
        if (override !== undefined && override > 0)
            return override;
        return keyInvalid ? ANONYMOUS_GAP_MS : ANONYMOUS_GAP_MS;
    }
    /** The effective pacing given whether a key is (still) considered valid. */
    function effectiveGap(keyed) {
        const override = options.minGapMs;
        if (override !== undefined && override > 0)
            return override;
        return keyed ? KEYED_GAP_MS : ANONYMOUS_GAP_MS;
    }
    async function pace(keyed) {
        const gap = effectiveGap(keyed);
        const elapsed = Date.now() - lastRequestAt;
        const wait = gap - elapsed;
        if (wait > 0) {
            await sleep(wait, options.signal);
        }
        lastRequestAt = Date.now();
    }
    async function request(method, url, params, json) {
        let key = await currentKey();
        const attempt = async (withKey) => {
            await pace(withKey);
            const query = params ? '?' + new URLSearchParams(cleanParams(params)).toString() : '';
            const headers = { Accept: 'application/json' };
            if (withKey && key)
                headers['x-api-key'] = key;
            const init = { method, headers, signal: options.signal };
            if (json !== undefined) {
                headers['Content-Type'] = 'application/json';
                init.body = JSON.stringify(json);
            }
            const controller = new AbortController();
            const onAbort = () => controller.abort(options.signal?.reason);
            options.signal?.addEventListener('abort', onAbort, { once: true });
            const timer = setTimeout(() => controller.abort(new Error(`timeout after ${options.timeoutMs ?? 30_000}ms`)), options.timeoutMs ?? 30_000);
            try {
                return await fetch(url + query, { ...init, signal: controller.signal });
            }
            finally {
                clearTimeout(timer);
                options.signal?.removeEventListener('abort', onAbort);
            }
        };
        let lastError;
        for (let attemptNo = 0; attemptNo <= MAX_RETRIES; attemptNo++) {
            let r;
            try {
                r = await attempt(Boolean(key));
            }
            catch (e) {
                // Transport failure before an HTTP status: retry with backoff.
                if (attemptNo < MAX_RETRIES) {
                    lastError = e;
                    await sleep(options.backoffMs ? options.backoffMs(attemptNo) : backoff(attemptNo), options.signal);
                    continue;
                }
                throw e;
            }
            if (r.status === 403 && key) {
                // Invalid or expired key: drop it and retry unauthenticated.
                keyInvalid = true;
                key = undefined;
                continue;
            }
            if (r.status === 429 || r.status === 504) {
                if (attemptNo < MAX_RETRIES) {
                    await sleep(options.backoffMs ? options.backoffMs(attemptNo) : backoff(attemptNo), options.signal);
                    continue;
                }
                r = await attempt(Boolean(key));
            }
            const text = await r.text();
            let body;
            try {
                body = text ? JSON.parse(text) : null;
            }
            catch {
                body = text;
            }
            if (!r.ok) {
                const message = typeof body === 'object' && body !== null
                    ? (body.message ?? body.error ?? `HTTP ${r.status}`)
                    : `HTTP ${r.status}`;
                throw new ScholarHttpError(r.status, String(message), body);
            }
            return body;
        }
        throw lastError ?? new Error('request failed');
    }
    return {
        request,
        apiKey: currentKey,
        minGapMs: gapMs,
        timeoutMs: options.timeoutMs ?? 30_000,
        signal: options.signal,
    };
}
function cleanParams(params) {
    const out = {};
    for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '')
            out[k] = v;
    }
    return out;
}
function backoff(attempt) {
    return Math.min(2 ** (attempt + 1) * 1_000, MAX_BACKOFF_MS);
}
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new Error('aborted'));
            return;
        }
        const t = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(t);
            reject(signal?.reason ?? new Error('aborted'));
        };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}
/** Translate shared snake_case filters to the S2 camelCase query params. */
export function toQueryParams(filters = {}) {
    const p = {};
    if (filters.year)
        p.year = filters.year;
    if (filters.publicationDate)
        p.publicationDateOrYear = filters.publicationDate;
    if (filters.venue)
        p.venue = filters.venue;
    if (filters.fieldsOfStudy)
        p.fieldsOfStudy = filters.fieldsOfStudy;
    if (filters.minCitationCount !== undefined)
        p.minCitationCount = String(filters.minCitationCount);
    if (filters.publicationTypes)
        p.publicationTypes = filters.publicationTypes;
    if (filters.openAccess)
        p.openAccessPdf = '';
    return p;
}
/** Compose a boolean query string for bulk search. See SKILL reference for syntax. */
export function buildBoolQuery(options) {
    const parts = [];
    for (const p of options.phrases ?? [])
        parts.push(`"${p}"`);
    for (const r of options.required ?? [])
        parts.push(`+${r}`);
    for (const e of options.excluded ?? [])
        parts.push(`-${e}`);
    if (options.orTerms?.length)
        parts.push(`(${options.orTerms.join(' | ')})`);
    for (const [term, dist] of options.fuzzy ?? [])
        parts.push(`${term}~${dist}`);
    for (const [phrase, dist] of options.proximity ?? [])
        parts.push(`"${phrase}"~${dist}`);
    return parts.join(' ');
}
/** Drop duplicates by paperId, preserving first-seen order. */
export function deduplicate(papers) {
    const seen = new Set();
    const out = [];
    for (const p of papers) {
        if (p.paperId && !seen.has(p.paperId)) {
            seen.add(p.paperId);
            out.push(p);
        }
    }
    return out;
}
// ---------------------------------------------------------------------------
// Field defaults (minimal by design — S2 responses slow down with more fields)
// ---------------------------------------------------------------------------
export const DEFAULT_PAPER_FIELDS = 'title,year,citationCount,authors,venue,externalIds,tldr';
export const BULK_PAPER_FIELDS = 'title,year,citationCount,authors,venue,externalIds';
const AUTHOR_FIELDS = 'name,affiliations,paperCount,citationCount,hIndex';
// ---------------------------------------------------------------------------
// High-level helpers
// ---------------------------------------------------------------------------
async function paginate(client, url, params, maxResults) {
    const next = { ...params, limit: String(Math.min(maxResults, 100)), offset: '0' };
    const out = [];
    while (out.length < maxResults) {
        const r = await client.request('GET', url, next);
        out.push(...(r.data ?? []));
        const cursor = r.next;
        if (!cursor || out.length >= maxResults)
            break;
        next.offset = cursor;
    }
    return out.slice(0, maxResults);
}
async function paginateBulk(client, url, params, maxResults) {
    const next = { ...params };
    const out = [];
    while (out.length < maxResults) {
        const r = await client.request('GET', url, next);
        out.push(...(r.data ?? []));
        const token = r.token;
        if (!token || out.length >= maxResults)
            break;
        next.token = token;
    }
    return out.slice(0, maxResults);
}
/** Bulk (boolean) search. Up to ~10M results; no tldr on this endpoint. */
export async function searchBulk(client, query, options = {}) {
    const params = {
        query,
        fields: options.fields ?? BULK_PAPER_FIELDS,
        sort: options.sort ?? 'citationCount:desc',
        ...toQueryParams(options.filters),
    };
    return paginateBulk(client, `${GRAPH}/paper/search/bulk`, params, options.maxResults ?? 20);
}
/** Relevance-ranked search (supports tldr). */
export async function searchRelevance(client, query, options = {}) {
    const maxResults = options.maxResults ?? 20;
    const params = {
        query,
        fields: options.fields ?? DEFAULT_PAPER_FIELDS,
        ...toQueryParams(options.filters),
    };
    if (maxResults <= 100) {
        const r = await client.request('GET', `${GRAPH}/paper/search`, { ...params, limit: String(maxResults) });
        return (r.data ?? []).slice(0, maxResults);
    }
    return paginate(client, `${GRAPH}/paper/search`, params, maxResults);
}
/** Full-text snippet search. */
export async function searchSnippets(client, query, options = {}) {
    const params = {
        query,
        fields: 'snippet.text,snippet.snippetKind,snippet.section',
        limit: String(Math.min(options.maxResults ?? 10, 100)),
        paperIds: options.paperIds,
        authors: options.authors,
        insertedBefore: options.insertedBefore,
    };
    const r = await client.request('GET', `${GRAPH}/snippet/search`, params);
    return (r.data ?? []).slice(0, options.maxResults ?? 10);
}
/** Exact-title match (single best result envelope). */
export async function matchTitle(client, title) {
    return client.request('GET', `${GRAPH}/paper/search/match`, { query: title, fields: DEFAULT_PAPER_FIELDS });
}
/** Single paper by id (DOI:, ARXIV:, PMID:, PMCID:, CorpusId:, ...). */
export async function getPaper(client, paperId, fields) {
    return client.request('GET', `${GRAPH}/paper/${encodeURIComponent(paperId)}`, {
        fields: fields ?? `${DEFAULT_PAPER_FIELDS},abstract,openAccessPdf`,
    });
}
/** Who cites a paper (with contextsWithIntent when requested). */
export async function getCitations(client, paperId, options = {}) {
    const maxResults = options.maxResults ?? 100;
    const fields = options.withIntents
        ? 'title,year,citationCount,authors,venue,contextsWithIntent'
        : 'title,year,citationCount,authors,venue';
    const params = { fields, ...(options.publicationDate ? { publicationDateOrYear: options.publicationDate } : {}) };
    return paginate(client, `${GRAPH}/paper/${encodeURIComponent(paperId)}/citations`, params, maxResults);
}
/** What a paper cites. */
export async function getReferences(client, paperId, options = {}) {
    return paginate(client, `${GRAPH}/paper/${encodeURIComponent(paperId)}/references`, { fields: 'title,year,citationCount,authors,venue' }, options.maxResults ?? 100);
}
/** Single-seed recommendations. */
export async function findSimilar(client, paperId, options = {}) {
    const r = await client.request('GET', `${RECS}/papers/forpaper/${encodeURIComponent(paperId)}`, {
        fields: 'title,year,citationCount,authors,venue',
        limit: String(options.limit ?? 10),
        from: options.pool ?? 'recent',
    });
    return r.recommendedPapers ?? [];
}
/** Multi-seed recommendations with optional negative seeds. */
export async function recommend(client, options) {
    const body = { positivePaperIds: options.positiveIds };
    if (options.negativeIds?.length)
        body.negativePaperIds = options.negativeIds;
    const r = await client.request('POST', `${RECS}/papers/`, { fields: 'title,year,citationCount,authors,venue', limit: String(options.limit ?? 10) }, body);
    return r.recommendedPapers ?? [];
}
/** Search authors by name. */
export async function searchAuthors(client, query, maxResults = 20) {
    const r = await client.request('GET', `${GRAPH}/author/search`, { query, fields: AUTHOR_FIELDS, limit: String(Math.min(maxResults, 1000)) });
    return (r.data ?? []).slice(0, maxResults);
}
/** Author profile. */
export async function getAuthor(client, authorId) {
    return client.request('GET', `${GRAPH}/author/${encodeURIComponent(authorId)}`, { fields: AUTHOR_FIELDS });
}
/** Author publication list. */
export async function getAuthorPapers(client, authorId, maxResults = 100) {
    return paginate(client, `${GRAPH}/author/${encodeURIComponent(authorId)}/papers`, { fields: DEFAULT_PAPER_FIELDS }, maxResults);
}
/** Batch paper lookup (<=500 ids). */
export async function batchPapers(client, ids, fields) {
    const r = await client.request('POST', `${GRAPH}/paper/batch`, { fields: fields ?? DEFAULT_PAPER_FIELDS }, { ids: ids.slice(0, 500) });
    return Array.isArray(r) ? r : [];
}
export const S2_ENDPOINTS = { GRAPH, RECS };
//# sourceMappingURL=client.js.map