import { transcribeAudio, } from "./transcribe.js";
export class HiDockWhisperSkill {
    client;
    options;
    constructor(client, options) {
        this.client = client;
        this.options = options;
    }
    async transcribeFile(file, onProgress) {
        const downloadOptions = {
            expectedSize: file.fileSize,
            ...(onProgress ? { onProgress } : {}),
        };
        const audioBytes = await this.client.withConnection(() => this.client.downloadFile(file, downloadOptions));
        const transcribeInput = {
            audioBytes,
            sourceFileName: file.fileName,
            fileVersion: file.fileVersion,
            ...(this.options.language ? { language: this.options.language } : {}),
            ...(this.options.pythonBin ? { pythonBin: this.options.pythonBin } : {}),
        };
        const transcript = await transcribeAudio(transcribeInput);
        return {
            ...transcript,
            fileName: file.fileName,
            fileSize: file.fileSize,
            fileVersion: file.fileVersion,
            audioBytes,
            audioCodec: file.audioProfile?.codec ?? "mp3",
        };
    }
    async transcribeLatestFile(onProgress) {
        const { files } = await this.client.withConnection(() => this.client.listFiles());
        if (files.length === 0) {
            throw new Error("No files found on HiDock device.");
        }
        // File names are timestamp based; lexical sort gives newest.
        const latest = [...files]
            .sort((a, b) => a.fileName.localeCompare(b.fileName))
            .at(-1);
        if (!latest) {
            throw new Error("No files found on HiDock device.");
        }
        return this.transcribeFile(latest, onProgress);
    }
}
//# sourceMappingURL=skill.js.map