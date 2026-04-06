export interface SearchDocument {
    path: string;
    category: string;
    title: string;
    content: string;
    terms: string[];
}
export interface SearchResult {
    path: string;
    category: string;
    title: string;
    score: number;
    snippet: string;
}
export interface WikiSearchIndex {
    documents: SearchDocument[];
    avgDocLength: number;
    termDocFreq: Map<string, number>;
}
export declare function tokenize(text: string): string[];
export declare function buildSearchIndex(wikiDir: string): Promise<WikiSearchIndex>;
export declare function searchWiki(index: WikiSearchIndex, query: string, maxResults?: number): SearchResult[];
//# sourceMappingURL=wikiSearch.d.ts.map