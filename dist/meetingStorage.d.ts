export interface MeetingStorageOptions {
    rootDir: string;
    meetingsDirName?: string;
    whispersDirName?: string;
}
export interface MeetingDocumentInput {
    timestamp: Date;
    sourceFileName: string;
    title: string;
    attendee: string;
    brief: string;
    summary: string;
    transcript: string;
}
export interface SavedMeetingDocument {
    notePath: string;
    indexPath: string;
    relativeNotePath: string;
    skipped: boolean;
}
export type DocumentKind = "meeting" | "whisper";
export declare class MeetingStorage {
    private readonly rootDir;
    private readonly meetingsDirName;
    private readonly whispersDirName;
    constructor(options: MeetingStorageOptions);
    saveMeeting(input: MeetingDocumentInput): Promise<SavedMeetingDocument>;
    saveWhisper(input: MeetingDocumentInput): Promise<SavedMeetingDocument>;
    private ensureStructure;
    getIndexPath(kind: DocumentKind): string;
    isIndexed(sourceFileName: string, kind: DocumentKind): Promise<boolean>;
    private ensureIndexHeader;
    private indexContainsSource;
    private uniquePath;
}
export declare function truncateWords(value: string, maxWords: number): string;
export declare function formatMonthFolder(date: Date): string;
export declare function formatTimestampToken(date: Date): string;
export declare function formatDateTime(date: Date): string;
//# sourceMappingURL=meetingStorage.d.ts.map