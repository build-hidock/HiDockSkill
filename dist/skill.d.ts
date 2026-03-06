import { HiDockClient } from "./client.js";
import { HiDockFileEntry } from "./fileList.js";
import { WhisperTranscriptionOutput } from "./whisper.js";
export interface HiDockSkillOptions {
    apiKey: string;
    whisperModel?: string;
    language?: string;
    prompt?: string;
    temperature?: number;
}
export interface FileTranscriptionResult extends WhisperTranscriptionOutput {
    fileName: string;
    fileSize: number;
    fileVersion: number;
}
export declare class HiDockWhisperSkill {
    private readonly client;
    private readonly options;
    constructor(client: HiDockClient, options: HiDockSkillOptions);
    transcribeFile(file: HiDockFileEntry, onProgress?: (receivedBytes: number, expectedBytes: number) => void): Promise<FileTranscriptionResult>;
    transcribeLatestFile(onProgress?: (receivedBytes: number, expectedBytes: number) => void): Promise<FileTranscriptionResult>;
}
//# sourceMappingURL=skill.d.ts.map