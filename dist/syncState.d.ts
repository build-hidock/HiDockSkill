import { HiDockFileEntry } from "./fileList.js";
export interface ProcessedFileState {
    fileName: string;
    fileSize: number;
    processedAt: string;
}
export interface SyncState {
    version: 1;
    lastSuccessfulSyncAt: string | null;
    lastRunStartedAt: string | null;
    processedFiles: Record<string, ProcessedFileState>;
}
export declare class SyncStateStore {
    private readonly filePath;
    constructor(filePath: string);
    get path(): string;
    read(): Promise<SyncState>;
    markRunStarted(startedAt: Date): Promise<SyncState>;
    markRunCompleted(options: {
        completedAt: Date;
        processed: HiDockFileEntry[];
    }): Promise<SyncState>;
    shouldProcessFile(file: HiDockFileEntry, state: SyncState): boolean;
    private write;
}
export declare function defaultSyncStatePath(storageDir: string): string;
//# sourceMappingURL=syncState.d.ts.map