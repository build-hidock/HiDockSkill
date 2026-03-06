export interface WhisperTranscriptionInput {
    apiKey: string;
    audioBytes: Uint8Array;
    sourceFileName: string;
    fileVersion?: number;
    model?: string;
    language?: string;
    prompt?: string;
    temperature?: number;
}
export interface WhisperTranscriptionOutput {
    text: string;
    model: string;
    uploadFileName: string;
    mimeType: string;
    detectedFormat: "mp3" | "wav" | "unknown";
}
export declare function transcribeWithWhisper(input: WhisperTranscriptionInput): Promise<WhisperTranscriptionOutput>;
//# sourceMappingURL=whisper.d.ts.map