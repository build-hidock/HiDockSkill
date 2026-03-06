export interface MeetingStorageOptions {
    rootDir: string;
    meetingsDirName?: string;
    whispersDirName?: string;
    tierHotMaxAgeDays?: number;
    tierWarmMaxAgeDays?: number;
    now?: () => Date;
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
export type StorageTier = "hot" | "warm" | "cold";
export declare const DEFAULT_HOT_TIER_MAX_AGE_DAYS = 30;
export declare const DEFAULT_WARM_TIER_MAX_AGE_DAYS = 180;
export declare const TIER_HOT_MAX_AGE_DAYS_ENV = "HIDOCK_NOTES_TIER_HOT_MAX_DAYS";
export declare const TIER_WARM_MAX_AGE_DAYS_ENV = "HIDOCK_NOTES_TIER_WARM_MAX_DAYS";
export declare class MeetingStorage {
    private readonly rootDir;
    private readonly meetingsDirName;
    private readonly whispersDirName;
    private readonly hotTierMaxAgeDays;
    private readonly warmTierMaxAgeDays;
    private readonly now;
    constructor(options: MeetingStorageOptions);
    saveMeeting(input: MeetingDocumentInput): Promise<SavedMeetingDocument>;
    saveWhisper(input: MeetingDocumentInput): Promise<SavedMeetingDocument>;
    private ensureStructure;
    getIndexPath(kind: DocumentKind): string;
    isIndexed(sourceFileName: string, kind: DocumentKind): Promise<boolean>;
    private selectTier;
    private ensureIndexHeader;
    private indexContainsSource;
    private uniquePath;
}
export declare function truncateWords(value: string, maxWords: number): string;
export declare function formatMonthFolder(date: Date): string;
export declare function formatTimestampToken(date: Date): string;
export declare function formatDateTime(date: Date): string;
export declare function selectStorageTier(ageDays: number, hotTierMaxAgeDays?: number, warmTierMaxAgeDays?: number): StorageTier;
//# sourceMappingURL=meetingStorage.d.ts.map