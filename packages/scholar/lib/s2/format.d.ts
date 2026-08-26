/**
 * Present S2 papers/authors as compact Markdown for the model, plus BibTeX
 * export from the `citationStyles` field.
 * @module dsh-scholar-find/s2-format
 */
/** Lossless JSON value (matches the DSH tool-output contract). */
type JsonValue = string | number | boolean | null | JsonValue[] | {
    [key: string]: JsonValue;
};
interface PaperLike {
    title?: string;
    year?: number | string;
    citationCount?: number;
    authors?: readonly {
        name?: string;
    }[];
    venue?: string;
    externalIds?: Record<string, string | undefined>;
    tldr?: {
        text?: string;
    };
    abstract?: string;
    paperId?: string;
    citationStyles?: {
        bibtex?: string;
    };
}
/** Markdown summary table (# | Title | Year | Cites | First author | Venue). */
export declare function formatTable(papers: readonly PaperLike[], maxRows?: number): string;
/** Per-paper detailed entries with TLDR/abstract fallback. */
export declare function formatDetails(papers: readonly PaperLike[], maxPapers?: number): string;
/** Combined header + summary table + top-N details. */
export declare function formatResults(papers: readonly PaperLike[], queryDesc?: string): string;
/** Author table (name, affiliations, papers, citations, h-index). */
export declare function formatAuthors(authors: readonly {
    name?: string;
    affiliations?: readonly string[];
    paperCount?: number;
    citationCount?: number;
    hIndex?: number;
}[], maxRows?: number): string;
/** BibTeX concatenation; requires the `citationStyles` field on every paper. */
export declare function exportBibtex(papers: readonly PaperLike[]): string;
/** Project papers to the compact model-facing shape used in tool results. */
export declare function compactPapers(papers: readonly PaperLike[]): JsonValue[];
export {};
