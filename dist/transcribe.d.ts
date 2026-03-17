export interface TranscriptionInput {
    audioBytes: Uint8Array;
    sourceFileName: string;
    fileVersion?: number;
    language?: string;
    pythonBin?: string;
}
export interface SpeakerSegment {
    text: string;
    speakerIndex: number;
    hasSpeakerId: boolean;
    startTime: number;
    duration: number;
}
export interface TranscriptionOutput {
    text: string;
    model: string;
    uploadFileName: string;
    mimeType: string;
    detectedFormat: "mp3" | "wav" | "unknown";
    speakerSegments?: SpeakerSegment[];
    speakerCount?: number;
}
/** Speaker enrollment interface (deferred — not yet implemented) */
export interface SpeakerProfile {
    name: string;
    enrolledAt: string;
}
/** Speaker enrollment config (deferred — not yet implemented) */
export interface SpeakerEnrollmentConfig {
    profilesPath?: string;
    enabled?: boolean;
}
/** @deprecated Use TranscriptionInput */
export type WhisperTranscriptionInput = TranscriptionInput & {
    apiKey?: string;
    model?: string;
    prompt?: string;
    temperature?: number;
};
/** @deprecated Use TranscriptionOutput */
export type WhisperTranscriptionOutput = TranscriptionOutput;
export declare function transcribeAudio(input: TranscriptionInput): Promise<TranscriptionOutput>;
/** @deprecated Use transcribeAudio */
export declare function transcribeWithWhisper(input: WhisperTranscriptionInput): Promise<WhisperTranscriptionOutput>;
export declare function parseMoonshineOutput(raw: string): {
    text: string;
    speakerSegments?: SpeakerSegment[];
    speakerCount?: number;
};
/**
 * Format speaker segments into a labeled transcript.
 * Merges adjacent segments from the same speaker.
 * Includes timestamps as `@seconds` for audio sync.
 * Returns plain text (no labels) if no segments have hasSpeakerId.
 */
export declare function formatSpeakerTranscript(segments: SpeakerSegment[]): string;
export declare function pickAudioFormat(audioBytes: Uint8Array, fileVersion?: number): {
    extension: "mp3" | "wav";
    mimeType: string;
    detectedFormat: "mp3" | "wav" | "unknown";
};
export declare function normalizeUploadFileName(sourceFileName: string, extension: "mp3" | "wav"): string;
//# sourceMappingURL=transcribe.d.ts.map