import { DocumentKind, MeetingDocumentInput, MeetingStorageOptions, SavedMeetingDocument } from "./meetingStorage.js";
export interface NotesStorageAdapter {
    saveMeeting(input: MeetingDocumentInput): Promise<SavedMeetingDocument>;
    saveWhisper(input: MeetingDocumentInput): Promise<SavedMeetingDocument>;
    isIndexed(sourceFileName: string, kind: DocumentKind): Promise<boolean>;
    getIndexPath(kind: DocumentKind): string;
}
export type NotesStorageBackend = "local" | "memdock";
export declare function parseNotesStorageBackend(value: string | undefined): NotesStorageBackend;
export declare class LocalMeetingStorageAdapter implements NotesStorageAdapter {
    private readonly storage;
    constructor(options: MeetingStorageOptions);
    saveMeeting(input: MeetingDocumentInput): Promise<SavedMeetingDocument>;
    saveWhisper(input: MeetingDocumentInput): Promise<SavedMeetingDocument>;
    isIndexed(sourceFileName: string, kind: DocumentKind): Promise<boolean>;
    getIndexPath(kind: DocumentKind): string;
}
export interface MemdockNotesStorageOptions extends MeetingStorageOptions {
    baseUrl?: string;
    apiKey?: string;
    apiPath?: string;
    workspace?: string;
    collection?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    log?: (message: string) => void;
}
export declare class MemdockNotesStorageAdapter implements NotesStorageAdapter {
    private readonly fallback;
    private readonly baseUrl;
    private readonly apiKey;
    private readonly apiPath;
    private readonly workspace;
    private readonly collection;
    private readonly timeoutMs;
    private readonly fetchImpl;
    private readonly log;
    private warnedMissingBaseUrl;
    constructor(options: MemdockNotesStorageOptions);
    saveMeeting(input: MeetingDocumentInput): Promise<SavedMeetingDocument>;
    saveWhisper(input: MeetingDocumentInput): Promise<SavedMeetingDocument>;
    isIndexed(sourceFileName: string, kind: DocumentKind): Promise<boolean>;
    getIndexPath(kind: DocumentKind): string;
    private trySave;
    private tryIsIndexed;
    private requestJson;
    private warnBaseUrlMissing;
}
export interface NotesStorageAdapterFactoryOptions extends MeetingStorageOptions {
    backend?: NotesStorageBackend;
    memdockBaseUrl?: string;
    memdockApiKey?: string;
    memdockApiPath?: string;
    memdockWorkspace?: string;
    memdockCollection?: string;
    memdockTimeoutMs?: number;
    fetchImpl?: typeof fetch;
    log?: (message: string) => void;
}
export declare function createNotesStorageAdapter(options: NotesStorageAdapterFactoryOptions): NotesStorageAdapter;
//# sourceMappingURL=notesStorage.d.ts.map