import { transcribeWithWhisper, } from "./whisper.js";
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
        const audioBytes = await this.client.downloadFile(file, downloadOptions);
        const whisperInput = {
            apiKey: this.options.apiKey,
            audioBytes,
            sourceFileName: file.fileName,
            fileVersion: file.fileVersion,
            ...(this.options.whisperModel ? { model: this.options.whisperModel } : {}),
            ...(this.options.language ? { language: this.options.language } : {}),
            ...(this.options.prompt ? { prompt: this.options.prompt } : {}),
            ...(typeof this.options.temperature === "number"
                ? { temperature: this.options.temperature }
                : {}),
        };
        const transcript = await transcribeWithWhisper(whisperInput);
        return {
            ...transcript,
            fileName: file.fileName,
            fileSize: file.fileSize,
            fileVersion: file.fileVersion,
        };
    }
    async transcribeLatestFile(onProgress) {
        const { files } = await this.client.listFiles();
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