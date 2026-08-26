/**
 * The paper_fetch source chain, reimplemented in TypeScript against the
 * public OA APIs: Unpaywall -> Semantic Scholar -> arXiv -> Europe PMC/PMC ->
 * bioRxiv/medRxiv -> publisher direct (institutional opt-in) -> Sci-Hub
 * (opt-in, off by decision). Each resolver returns PDF URL candidates plus
 * metadata; the download loop validates and writes.
 * @module dsh-scholar-find/fetch-chain
 */
import { getPaper } from '../s2/client.js';
const DEFAULT_SCIHUB_MIRRORS = ['sci-hub.ru', 'sci-hub.st', 'sci-hub.su', 'sci-hub.box', 'sci-hub.red', 'sci-hub.al', 'sci-hub.mk', 'sci-hub.ee'];
/**
 * Resolve one DOI to the ordered candidate list (URL + source + merged meta),
 * following the documented chain. Never downloads; the caller does that.
 */
export async function resolveChain(ctx) {
    const sourcesTried = [];
    const candidates = [];
    const meta = {};
    let ext = {};
    const mergeMeta = (m) => {
        if (!m)
            return;
        if (m.title && !meta.title)
            meta.title = m.title;
        if (m.year !== undefined && m.year !== null && meta.year === undefined)
            meta.year = m.year;
        if (m.author && !meta.author)
            meta.author = m.author;
        if (m.journal && !meta.journal)
            meta.journal = m.journal;
    };
    const add = (source, pdfUrl, extra) => {
        if (!pdfUrl)
            return;
        if (candidates.some((c) => c.pdfUrl === pdfUrl))
            return;
        candidates.push({ source, pdfUrl, meta: { ...meta }, ext: { ...ext }, ...extra });
    };
    // 1. Unpaywall (requires email)
    if (ctx.email) {
        sourcesTried.push('unpaywall');
        try {
            const up = await unpaywallResolve(ctx.doi, ctx.email, ctx.timeoutMs, ctx.signal);
            if (up) {
                mergeMeta(up.meta);
                add('unpaywall', up.pdfUrl);
            }
        }
        catch {
            // transport failure — recorded implicitly by the caller via sourcesTried
        }
    }
    else {
        sourcesTried.push('unpaywall skipped (no email)');
    }
    // 2. Semantic Scholar: pdf + externalIds + meta (also lazy cache)
    let s2Pdf;
    let s2Ext = {};
    try {
        const d = await getPaper(ctx.s2, `DOI:${ctx.doi}`, 'title,year,authors,openAccessPdf,externalIds,venue');
        s2Pdf = d.openAccessPdf?.url;
        s2Ext = d.externalIds ?? {};
        mergeMeta({ title: d.title, year: d.year, author: d.authors?.[0]?.name, journal: d.venue });
    }
    catch {
        // 404 / transport: continue with other sources
    }
    if (Object.keys(s2Ext).length)
        ext = { ...ext, ...s2Ext };
    if (s2Pdf) {
        sourcesTried.push('semantic_scholar');
        add('semantic_scholar', s2Pdf);
    }
    // Synthesized arXiv DOI form; S2 does not index it — recover from the DOI.
    if (!ext.ArXiv && ctx.doi.toLowerCase().startsWith('10.48550/arxiv.')) {
        ext.ArXiv = ctx.doi.slice('10.48550/arxiv.'.length);
    }
    // 3. arXiv
    if (ext.ArXiv) {
        sourcesTried.push('arxiv');
        add('arxiv', `https://arxiv.org/pdf/${ext.ArXiv}.pdf`);
    }
    // PMCID may be in externalIds or recoverable from an S2 PDF url.
    let pmcid = ext.PubMedCentral;
    if (!pmcid) {
        const m = /\/pmc\/articles\/(PMC\d+)/i.exec(s2Pdf ?? '');
        if (m?.[1])
            pmcid = m[1];
    }
    // 4. Europe PMC first (bypasses NCBI's JS challenge), then PMC
    if (pmcid) {
        sourcesTried.push('europe_pmc', 'pmc');
        add('europe_pmc', `https://europepmc.org/articles/${pmcid}?pdf=render`);
        add('pmc', `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`);
    }
    // 5. bioRxiv / medRxiv (10.1101 only)
    if (ctx.doi.startsWith('10.1101/')) {
        sourcesTried.push('biorxiv');
        try {
            const bx = await biorxivResolve(ctx.doi, ctx.timeoutMs, ctx.signal);
            if (bx)
                add('biorxiv', bx);
        }
        catch {
            // ignore
        }
    }
    // 6. Publisher direct (institutional opt-in)
    if (ctx.institutional) {
        sourcesTried.push('publisher_direct');
        for (const [publisher, url] of publisherCandidates(ctx.doi, ctx.timeoutMs)) {
            add('publisher_direct', url, { detail: { publisher } });
        }
    }
    // 7. Sci-Hub (opt-in, off by default per decision)
    if (ctx.scihubEnabled) {
        sourcesTried.push('scihub');
        const hit = await scihubResolve(ctx.doi, ctx.scihubMirrors, ctx.timeoutMs, ctx.signal);
        if (hit)
            add('scihub', hit.url, { detail: { mirror: hit.mirror } });
    }
    return { candidates, sourcesTried, meta, ext };
}
// ---------------------------------------------------------------------------
// Individual resolvers
// ---------------------------------------------------------------------------
async function jsonGet(url, timeoutMs, signal, headers) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs);
    try {
        const r = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: controller.signal });
        const text = await r.text();
        let body;
        try {
            body = text ? JSON.parse(text) : null;
        }
        catch {
            body = null;
        }
        if (!r.ok)
            throw new Error(`HTTP ${r.status}`);
        return body;
    }
    finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
    }
}
/** Unpaywall v2: read best_oa_location.url_for_pdf. */
async function unpaywallResolve(doi, email, timeoutMs, signal) {
    const d = await jsonGet(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}?email=${encodeURIComponent(email)}`, timeoutMs, signal);
    const loc = d.best_oa_location ?? {};
    if (!loc.url_for_pdf)
        return undefined;
    return {
        pdfUrl: loc.url_for_pdf,
        meta: {
            title: d.title,
            year: d.year,
            author: d.z_authors?.[0]?.family,
            journal: d.journal_name,
        },
    };
}
async function biorxivResolve(doi, timeoutMs, signal) {
    for (const server of ['biorxiv', 'medrxiv']) {
        try {
            const d = await jsonGet(`https://api.biorxiv.org/details/${server}/${doi}`, timeoutMs, signal);
            const coll = d.collection ?? [];
            if (coll.length) {
                const latest = coll[coll.length - 1];
                return `https://www.${server}.org/content/10.1101/${latest.doi.split('/').pop()}v${latest.version ?? 1}.full.pdf`;
            }
        }
        catch {
            // try the other server
        }
    }
    return undefined;
}
/** Publisher-direct URL templates by DOI prefix (institutional mode). */
export function publisherCandidates(doi, timeoutMs) {
    const suffix = doi.slice(doi.indexOf('/') + 1);
    const out = [];
    const templates = {
        '10.1038/': ['nature', `https://www.nature.com/articles/${suffix}.pdf`],
        '10.1126/': ['science', `https://www.science.org/doi/pdf/${doi}`],
        '10.1002/': ['wiley', `https://onlinelibrary.wiley.com/doi/pdf/${doi}`],
        '10.1007/': ['springer', `https://link.springer.com/content/pdf/${doi}.pdf`],
        '10.1021/': ['acs', `https://pubs.acs.org/doi/pdf/${doi}`],
        '10.1073/': ['pnas', `https://www.pnas.org/doi/pdf/${doi}`],
        '10.1056/': ['nejm', `https://www.nejm.org/doi/pdf/${doi}`],
        '10.1177/': ['sage', `https://journals.sagepub.com/doi/pdf/${doi}`],
        '10.1080/': ['tandf', `https://www.tandfonline.com/doi/pdf/${doi}`],
    };
    for (const [prefix, entry] of Object.entries(templates)) {
        if (doi.startsWith(prefix)) {
            out.push(entry);
            return out;
        }
    }
    return out;
}
const SCIHUB_NOT_FOUND = /(?:please try to search again using doi|article not found in .*database)/i;
/** Sci-Hub resolve: iframe/embed extraction from the mirror's HTML page. */
async function scihubResolve(doi, mirrorsEnv, timeoutMs, signal) {
    const mirrors = mirrorsEnv
        ? mirrorsEnv.split(',').map((s) => s.trim()).filter(Boolean)
        : DEFAULT_SCIHUB_MIRRORS;
    for (const mirror of mirrors) {
        try {
            const controller = new AbortController();
            const onAbort = () => controller.abort(signal?.reason);
            signal?.addEventListener('abort', onAbort, { once: true });
            const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
            let html = '';
            try {
                const r = await fetch(`https://${mirror}/${doi}`, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1' } });
                html = await r.text();
            }
            finally {
                clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
            }
            if (SCIHUB_NOT_FOUND.test(html))
                return undefined; // shared corpus: give up
            const pdf = extractScihubPdf(html, `https://${mirror}`);
            if (pdf)
                return { url: pdf, mirror };
        }
        catch {
            // try next mirror
        }
    }
    return undefined;
}
/** Pull the PDF src out of a Sci-Hub page (iframe/embed). */
export function extractScihubPdf(html, base) {
    const re = /<(?:iframe|embed)\b[^>]*\bsrc=["']([^"']+)["']/gi;
    let m;
    let fallback;
    while ((m = re.exec(html)) !== null) {
        const src = m[1];
        if (!src || src.startsWith('data:'))
            continue;
        const url = src.startsWith('//') ? `https:${src}` : src.startsWith('/') ? `${base}${src}` : src;
        if (/\.pdf/i.test(url))
            return url;
        if (fallback === undefined)
            fallback = url;
    }
    return fallback;
}
const MIN_TITLE_LEN = 6;
const TITLE_SCORE_MIN = 40;
const TITLE_GAP_MIN = 3;
/** Resolve a paper title to a DOI. Crossref primary, S2 match fallback. */
export async function resolveTitle(title, ctx) {
    const q = title.trim();
    const resolversTried = [];
    const empty = { query: q, resolver: 'crossref', resolversTried, resolvedDoi: '', candidates: [], lowConfidence: true, lowConfidenceReason: 'no_match' };
    if (q.length < MIN_TITLE_LEN)
        return { doi: undefined, resolution: empty };
    // Pass 1 — Crossref with mailto politeness.
    resolversTried.push('crossref');
    let crCandidates = [];
    let crTop;
    try {
        const params = new URLSearchParams({ 'query.title': q, rows: '3', select: 'DOI,title,score,author,issued,container-title' });
        if (ctx.email)
            params.set('mailto', ctx.email);
        const d = await jsonGet(`https://api.crossref.org/works?${params.toString()}`, ctx.timeoutMs, ctx.signal);
        crCandidates = ((d.message ?? {}).items ?? []).map((it) => {
            const issued = (((it.issued ?? {})['date-parts'] ?? [[null]])[0] ?? [null])[0];
            return {
                doi: it.DOI,
                title: (it.title ?? [])[0],
                year: typeof issued === 'number' ? issued : undefined,
                author: (it.author ?? [])[0]?.family ?? (it.author ?? [])[0]?.name,
                journal: (it['container-title'] ?? [])[0],
                score: it.score,
            };
        });
        crTop = crCandidates[0];
    }
    catch {
        // resolver unavailable — try S2
    }
    const crScore = crTop?.score;
    const crGap = crCandidates.length >= 2 && typeof crScore === 'number' && typeof crCandidates[1].score === 'number'
        ? crScore - crCandidates[1].score
        : undefined;
    const crLowReason = crTop?.doi
        ? crScore !== undefined && crScore < TITLE_SCORE_MIN
            ? 'score_below_threshold'
            : crGap !== undefined && crGap < TITLE_GAP_MIN
                ? 'ambiguous_runner_up'
                : undefined
        : 'no_match';
    if (crTop?.doi && !crLowReason) {
        return {
            doi: crTop.doi,
            resolution: {
                query: q,
                resolver: 'crossref',
                resolversTried,
                resolvedDoi: crTop.doi,
                resolvedTitle: crTop.title,
                matchScore: crScore,
                candidates: crCandidates,
                lowConfidence: false,
            },
        };
    }
    // Pass 2 — Semantic Scholar match (covers arXiv-only papers).
    resolversTried.push('semantic_scholar');
    try {
        const d = await ctx.s2.request('GET', 'https://api.semanticscholar.org/graph/v1/paper/search/match', { query: q, fields: 'title,authors,year,venue,externalIds' });
        const top = (d.data ?? [])[0];
        if (top) {
            const ext = top.externalIds ?? {};
            let doi = ext.DOI;
            if (!doi && ext.ArXiv)
                doi = `10.48550/arXiv.${ext.ArXiv}`;
            if (doi) {
                return {
                    doi,
                    resolution: {
                        query: q,
                        resolver: 'semantic_scholar',
                        resolversTried,
                        resolvedDoi: doi,
                        resolvedTitle: top.title,
                        candidates: crCandidates.length ? crCandidates : [{ title: top.title, doi }],
                        lowConfidence: false,
                        ...(crTop?.doi ? { lowConfidenceReason: crLowReason } : {}),
                    },
                };
            }
        }
    }
    catch {
        // S2 unavailable
    }
    // Pass 3 — low-confidence Crossref pick.
    if (crTop?.doi) {
        return {
            doi: crTop.doi,
            resolution: {
                query: q,
                resolver: 'crossref',
                resolversTried,
                resolvedDoi: crTop.doi,
                resolvedTitle: crTop.title,
                matchScore: crScore,
                candidates: crCandidates,
                lowConfidence: true,
                lowConfidenceReason: crLowReason,
            },
        };
    }
    return { doi: undefined, resolution: empty };
}
//# sourceMappingURL=chain.js.map