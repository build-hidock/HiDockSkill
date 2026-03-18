import { HiDockClient } from "./client.js";
import { HiDockFileEntry } from "./fileList.js";
import { NotesStorageAdapter } from "./notesStorage.js";
import { HiDockSkillOptions } from "./skill.js";
export interface MeetingWorkflowOptions extends HiDockSkillOptions {
    storageRootDir: string;
    summaryModel?: string;
    ollamaHost?: string;
    storageAdapter?: NotesStorageAdapter;
}
export interface MeetingSummaryResult {
    title: string;
    attendee: string;
    brief: string;
    summary: string;
    speakerMap?: Map<number, string>;
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
    constructor(client: HiDockClient, options: MeetingWorkflowOptions);
    processRecording(file: HiDockFileEntry, onProgress?: (receivedBytes: number, expectedBytes: number) => void): Promise<ProcessedRecordingResult>;
    processAllRecordings(onItem?: (sourceFileName: string, index: number, total: number) => void): Promise<ProcessedRecordingResult[]>;
}
export declare function isWhisperRecording(fileName: string): boolean;
export declare function parseHiDockRecordingDate(fileName: string): Date | null;
export declare function stripThinkTags(text: string): string;
/**
 * Parse a SPEAKER_MAP line from LLM output.
 * Expected format: "SPEAKER_MAP: Speaker 0=Alice, Speaker 1=Bob"
 */
export declare function parseSpeakerMap(content: string): Map<number, string>;
/**
 * Replace [Speaker N] and [Speaker N @time] labels with resolved real names.
 */
export declare function applySpeakerNames(transcript: string, speakerMap: Map<number, string>): string;
/**
 * Parse a JSON speaker map from LLM output.
 * Accepts: {"0": "Alice", "1": "Bob"} or {"Speaker 0": "Alice", ...}
 */
export declare function parseSpeakerMapJson(content: string): Map<number, string>;
/**
 * Dedicated LLM call to resolve speaker identities from transcript context.
 * Uses a short, focused prompt and parses multiple output formats.
 */
export declare function resolveSpeakerNames(input: {
    transcript: string;
    speakerCount: number;
    model?: string;
    ollamaHost?: string;
}): Promise<Map<number, string>>;
//# sourceMappingURL=meetingWorkflow.d.ts.map