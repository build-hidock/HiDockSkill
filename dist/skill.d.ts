import { HiDockClient } from "./client.js";
import { HiDockFileEntry } from "./fileList.js";
import { TranscriptionOutput } from "./transcribe.js";
export interface HiDockSkillOptions {
    apiKey?: string;
    whisperModel?: string;
    language?: string;
    prompt?: string;
    temperature?: number;
    pythonBin?: string;
}
export interface FileTranscriptionResult extends TranscriptionOutput {
    fileName: string;
    fileSize: number;
    fileVersion: number;
    audioBytes: Uint8Array;
    audioCodec: "mp3" | "wav";
}
export declare class HiDockWhisperSkill {
    private readonly client;
    private readonly options;
    constructor(client: HiDockClient, options: HiDockSkillOptions);
    transcribeFile(file: HiDockFileEntry, onProgress?: (receivedBytes: number, expectedBytes: number) => void): Promise<FileTranscriptionResult>;
    transcribeLatestFile(onProgress?: (receivedBytes: number, expectedBytes: number) => void): Promise<FileTranscriptionResult>;
}
//# sourceMappingURL=skill.d.ts.map