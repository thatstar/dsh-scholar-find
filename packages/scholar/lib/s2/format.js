/**
 * Present S2 papers/authors as compact Markdown for the model, plus BibTeX
 * export from the `citationStyles` field.
 * @module dsh-scholar/s2-format
 */
function doiOf(paper) {
    return paper.externalIds?.DOI ?? '';
}
function firstAuthor(paper) {
    const authors = paper.authors ?? [];
    if (!authors.length)
        return '';
    const name = authors[0]?.name ?? '';
    return authors.length > 1 ? `${name} et al.` : name;
}
/** Markdown summary table (# | Title | Year | Cites | First author | Venue). */
export function formatTable(papers, maxRows = 30) {
    const rows = ['| # | Title | Year | Cites | First Author | Venue |', '|---|-------|------|-------|-------------|-------|'];
    for (const [i, p] of papers.slice(0, maxRows).entries()) {
        rows.push(`| ${i + 1} | ${(p.title ?? '').slice(0, 80)} | ${p.year ?? ''} | ${p.citationCount ?? 0} | ${firstAuthor(p).slice(0, 25)} | ${(p.venue ?? '').slice(0, 30)} |`);
    }
    return rows.join('\n');
}
/** Per-paper detailed entries with TLDR/abstract fallback. */
export function formatDetails(papers, maxPapers = 10) {
    const lines = [];
    for (const [i, p] of papers.slice(0, maxPapers).entries()) {
        const authors = (p.authors ?? []).slice(0, 5).map((a) => a.name ?? '').join(', ');
        const authorsFull = (p.authors ?? []).length > 5 ? `${authors} et al.` : authors;
        const doi = doiOf(p);
        const tldr = p.tldr?.text ?? '';
        const abstract = (p.abstract ?? '').slice(0, 300);
        const summary = tldr || (abstract.length ? `${abstract}${(p.abstract ?? '').length > 300 ? '...' : ''}` : '');
        lines.push(`### ${i + 1}. ${p.title ?? 'Untitled'} (${p.year ?? '?'})`);
        lines.push(`**Authors:** ${authorsFull || 'unknown'}`);
        lines.push(doi ? `**Citations:** ${p.citationCount ?? 0} | **DOI:** ${doi}` : `**Citations:** ${p.citationCount ?? 0}`);
        if (summary)
            lines.push(`**Summary:** ${summary}`);
        lines.push('');
    }
    return lines.join('\n');
}
/** Combined header + summary table + top-N details. */
export function formatResults(papers, queryDesc = '') {
    const header = queryDesc ? `## Search Results: ${queryDesc}\n\n**${papers.length} papers found.**\n` : `**${papers.length} papers found.**\n`;
    return `${header}\n${formatTable(papers)}\n\n---\n\n${formatDetails(papers)}`;
}
/** Author table (name, affiliations, papers, citations, h-index). */
export function formatAuthors(authors, maxRows = 20) {
    const rows = ['| # | Name | Affiliations | Papers | Citations | h-index |', '|---|------|-------------|--------|-----------|---------|'];
    for (const [i, a] of authors.slice(0, maxRows).entries()) {
        rows.push(`| ${i + 1} | ${(a.name ?? '').slice(0, 40)} | ${(a.affiliations ?? []).join(', ').slice(0, 40)} | ${a.paperCount ?? 0} | ${a.citationCount ?? 0} | ${a.hIndex ?? 0} |`);
    }
    return rows.join('\n');
}
/** BibTeX concatenation; requires the `citationStyles` field on every paper. */
export function exportBibtex(papers) {
    return papers
        .map((p) => p.citationStyles?.bibtex)
        .filter((b) => Boolean(b))
        .join('\n\n');
}
/** Project papers to the compact model-facing shape used in tool results. */
export function compactPapers(papers) {
    return papers.map((p) => ({
        paperId: p.paperId,
        title: p.title,
        year: p.year,
        citationCount: p.citationCount,
        authors: (p.authors ?? []).map((a) => a.name),
        venue: p.venue,
        doi: doiOf(p) || undefined,
        tldr: p.tldr?.text,
    }));
}
//# sourceMappingURL=format.js.map