import { HiDockClient } from "./client.js";
import { HiDockFileEntry } from "./fileList.js";
import {
  TranscriptionOutput,
  transcribeAudio,
} from "./transcribe.js";

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

export class HiDockWhisperSkill {
  private readonly client: HiDockClient;
  private readonly options: HiDockSkillOptions;

  constructor(client: HiDockClient, options: HiDockSkillOptions) {
    this.client = client;
    this.options = options;
  }

  async transcribeFile(
    file: HiDockFileEntry,
    onProgress?: (receivedBytes: number, expectedBytes: number) => void,
  ): Promise<FileTranscriptionResult> {
    const downloadOptions = {
      expectedSize: file.fileSize,
      ...(onProgress ? { onProgress } : {}),
    };
    const audioBytes = await this.client.withConnection(() =>
      this.client.downloadFile(file, downloadOptions)
    );

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

  async transcribeLatestFile(
    onProgress?: (receivedBytes: number, expectedBytes: number) => void,
  ): Promise<FileTranscriptionResult> {
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
