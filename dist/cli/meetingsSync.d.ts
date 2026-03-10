import { NotesStorageBackend } from "../notesStorage.js";
export interface CliOptions {
    storageDir: string;
    storageBackend: NotesStorageBackend;
    memdockBaseUrl?: string | undefined;
    memdockApiKey?: string | undefined;
    memdockApiPath?: string | undefined;
    memdockWorkspace?: string | undefined;
    memdockCollection?: string | undefined;
    memdockTimeoutMs?: number | undefined;
    whisperModel: string;
    summaryModel: string;
    language?: string | undefined;
    prompt?: string | undefined;
    temperature?: number | undefined;
    limit?: number | undefined;
    whisperOnly: boolean;
    meetingsOnly: boolean;
    dryRun: boolean;
    showHelp: boolean;
    stateFile: string;
}
export interface SyncRunResult {
    totalFiles: number;
    selectedFiles: number;
    saved: number;
    skipped: number;
    failed: number;
    savedSources: string[];
}
interface RunMeetingsSyncOptions {
    options: CliOptions;
    logger?: Pick<typeof console, "log" | "error">;
}
export declare function runMeetingsSync(input: RunMeetingsSyncOptions): Promise<SyncRunResult>;
export declare function parseArgs(argv: string[], env?: NodeJS.ProcessEnv): CliOptions;
export {};
//# sourceMappingURL=meetingsSync.d.ts.map