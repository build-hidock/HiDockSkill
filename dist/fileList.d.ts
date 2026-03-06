export interface HiDockAudioProfile {
    codec: "mp3" | "wav";
    sampleRateHz: number;
    channels: number;
    bitrateBps?: number;
    bitsPerSample?: number;
    headerBytes?: number;
}
export interface HiDockFileEntry {
    fileVersion: number;
    fileName: string;
    rawFileNameBytes: Uint8Array;
    fileSize: number;
    modifiedAtRaw: Uint8Array;
    modifiedAtBcd: string | null;
    md5Hex: string;
    audioProfile: HiDockAudioProfile | null;
    estimatedDurationSeconds: number | null;
}
export interface HiDockFileList {
    fileCount: number;
    files: HiDockFileEntry[];
    trailingBytes: number;
}
export declare function getAudioProfileByVersion(fileVersion: number): HiDockAudioProfile | null;
export declare function parseHiDockFileListBody(body: Uint8Array): HiDockFileList;
export declare function detectAudioContainer(data: Uint8Array): "mp3" | "wav" | "unknown";
//# sourceMappingURL=fileList.d.ts.map