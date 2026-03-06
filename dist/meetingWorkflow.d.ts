import { HiDockClient } from "./client.js";
import { HiDockFileEntry } from "./fileList.js";
import { NotesStorageAdapter } from "./notesStorage.js";
import { HiDockSkillOptions } from "./skill.js";
export interface MeetingWorkflowOptions extends HiDockSkillOptions {
    storageRootDir: string;
    summaryModel?: string;
    storageAdapter?: NotesStorageAdapter;
}
export interface MeetingSummaryResult {
    title: string;
    attendee: string;
    brief: string;
    summary: string;
}
export interface ProcessedRecordingResult {
    sourceFileName: string;
    documentType: "meeting" | "whisper";
    notePath: string;
    indexPath: string;
    skipped: boolean;
}
export declare class HiDockMeetingWorkflow {
    private readonly client;
    private readonly transcribeSkill;
    private readonly storage;
    private readonly options;
    private readonly openai;
    constructor(client: HiDockClient, options: MeetingWorkflowOptions);
    processRecording(file: HiDockFileEntry, onProgress?: (receivedBytes: number, expectedBytes: number) => void): Promise<ProcessedRecordingResult>;
    processAllRecordings(onItem?: (sourceFileName: string, index: number, total: number) => void): Promise<ProcessedRecordingResult[]>;
}
export declare function isWhisperRecording(fileName: string): boolean;
export declare function parseHiDockRecordingDate(fileName: string): Date | null;
//# sourceMappingURL=meetingWorkflow.d.ts.map