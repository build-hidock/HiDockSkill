import OpenAI, { toFile } from "openai";

import { detectAudioContainer, getAudioProfileByVersion } from "./fileList.js";

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

export async function transcribeWithWhisper(
  input: WhisperTranscriptionInput,
): Promise<WhisperTranscriptionOutput> {
  const model = input.model ?? "whisper-1";
  const format = pickAudioFormat(input.audioBytes, input.fileVersion);
  const uploadFileName = normalizeUploadFileName(input.sourceFileName, format.extension);
  const uploadable = await toFile(
    input.audioBytes,
    uploadFileName,
    format.mimeType ? { type: format.mimeType } : undefined,
  );

  const client = new OpenAI({ apiKey: input.apiKey });
  const request = {
    file: uploadable,
    model,
    ...(input.language ? { language: input.language } : {}),
    ...(input.prompt ? { prompt: input.prompt } : {}),
    ...(typeof input.temperature === "number"
      ? { temperature: input.temperature }
      : {}),
  };
  const response = await client.audio.transcriptions.create(request);

  return {
    text: response.text,
    model,
    uploadFileName,
    mimeType: format.mimeType,
    detectedFormat: format.detectedFormat,
  };
}

function pickAudioFormat(audioBytes: Uint8Array, fileVersion?: number): {
  extension: "mp3" | "wav";
  mimeType: string;
  detectedFormat: "mp3" | "wav" | "unknown";
} {
  if (typeof fileVersion === "number") {
    const profile = getAudioProfileByVersion(fileVersion);
    if (profile?.codec === "wav") {
      return {
        extension: "wav",
        mimeType: "audio/wav",
        detectedFormat: profile.codec,
      };
    }
    if (profile?.codec === "mp3") {
      return {
        extension: "mp3",
        mimeType: "audio/mpeg",
        detectedFormat: profile.codec,
      };
    }
  }

  const detected = detectAudioContainer(audioBytes);
  if (detected === "wav") {
    return { extension: "wav", mimeType: "audio/wav", detectedFormat: detected };
  }
  return { extension: "mp3", mimeType: "audio/mpeg", detectedFormat: detected };
}

function normalizeUploadFileName(
  sourceFileName: string,
  extension: "mp3" | "wav",
): string {
  const base = sourceFileName.replace(/\.[^./\\]+$/g, "");
  return `${base}.${extension}`;
}
