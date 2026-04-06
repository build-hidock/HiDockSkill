export interface WikiCompilerOptions {
    storageDir: string;
    llmHost?: string;
    llmModel?: string;
    log?: (message: string) => void;
}
export interface WikiPersonEntry {
    name: string;
    role?: string | undefined;
    mentions: string[];
    sourceRef: string;
}
export interface WikiProjectEntry {
    name: string;
    status?: string | undefined;
    updates: string[];
    sourceRef: string;
}
export interface WikiTopicEntry {
    name: string;
    content: string[];
    sourceRef: string;
}
export interface WikiDecisionEntry {
    decision: string;
    context?: string | undefined;
    participants: string[];
    sourceRef: string;
    date: string;
}
export interface WikiActionEntry {
    action: string;
    owner?: string | undefined;
    deadline?: string | undefined;
    status: "open" | "done";
    sourceRef: string;
}
export interface WikiExtractionResult {
    people: WikiPersonEntry[];
    projects: WikiProjectEntry[];
    topics: WikiTopicEntry[];
    decisions: WikiDecisionEntry[];
    actions: WikiActionEntry[];
}
export interface WikiCompilationResult {
    pagesWritten: number;
    pagesUpdated: number;
    errors: string[];
}
export declare function compileWiki(options: WikiCompilerOptions, newSources?: string[]): Promise<WikiCompilationResult>;
export declare function parseExtractionJson(text: string, sourceRef: string): WikiExtractionResult;
export declare function regenerateIndex(wikiDir: string): Promise<void>;
export declare function slugify(name: string): string;
//# sourceMappingURL=wikiCompiler.d.ts.map