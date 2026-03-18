import { promises as fs } from "node:fs";

import { HiDockClient } from "./client.js";
import { HiDockFileEntry } from "./fileList.js";
import { DocumentKind, SavedMeetingDocument, truncateWords } from "./meetingStorage.js";
import { LocalMeetingStorageAdapter, NotesStorageAdapter } from "./notesStorage.js";
import { HiDockSkillOptions, HiDockWhisperSkill } from "./skill.js";
import { formatSpeakerTranscript } from "./transcribe.js";

const MONTH_NAME_TO_INDEX: Readonly<Record<string, number>> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

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

export class HiDockMeetingWorkflow {
  private readonly client: HiDockClient;
  private readonly transcribeSkill: HiDockWhisperSkill;
  private readonly storage: NotesStorageAdapter;
  private readonly options: MeetingWorkflowOptions;

  constructor(client: HiDockClient, options: MeetingWorkflowOptions) {
    this.client = client;
    this.options = options;
    this.transcribeSkill = new HiDockWhisperSkill(client, options);
    this.storage =
      options.storageAdapter ??
      new LocalMeetingStorageAdapter({ rootDir: options.storageRootDir });
  }

  async processRecording(
    file: HiDockFileEntry,
    onProgress?: (receivedBytes: number, expectedBytes: number) => void,
  ): Promise<ProcessedRecordingResult> {
    const documentType: DocumentKind = isWhisperRecording(file.fileName)
      ? "whisper"
      : "meeting";
    const indexPath = this.storage.getIndexPath(documentType);
    if (await this.storage.isIndexed(file.fileName, documentType)) {
      return {
        sourceFileName: file.fileName,
        documentType,
        notePath: "",
        indexPath,
        skipped: true,
      };
    }

    const transcription = await this.transcribeSkill.transcribeFile(file, onProgress);
    const timestamp = parseHiDockRecordingDate(file.fileName) ?? new Date();

    // Format transcript with speaker labels if available
    const hasSpeakers = transcription.speakerSegments && transcription.speakerSegments.length > 0;
    const transcriptForLlm = hasSpeakers
      ? formatSpeakerTranscript(transcription.speakerSegments!)
      : transcription.text;

    const summary = await summarizeTranscriptWithOllama({
      transcript: transcriptForLlm,
      sourceFileName: file.fileName,
      hasSpeakerLabels: hasSpeakers ?? false,
      ...(this.options.summaryModel ? { model: this.options.summaryModel } : {}),
      ...(this.options.ollamaHost ? { ollamaHost: this.options.ollamaHost } : {}),
    });

    // Resolve speaker names with a dedicated focused LLM call
    let speakerMap = summary.speakerMap ?? new Map<number, string>();
    if (hasSpeakers && speakerMap.size === 0 && (transcription.speakerCount ?? 0) > 0) {
      speakerMap = await resolveSpeakerNames({
        transcript: transcriptForLlm,
        speakerCount: transcription.speakerCount!,
        ...(this.options.summaryModel ? { model: this.options.summaryModel } : {}),
        ...(this.options.ollamaHost ? { ollamaHost: this.options.ollamaHost } : {}),
      });
    }

    // Apply resolved speaker names back to transcript
    const finalTranscript = speakerMap.size > 0
      ? applySpeakerNames(transcriptForLlm, speakerMap)
      : transcriptForLlm;

    // Update attendee list with resolved names
    const resolvedAttendee = speakerMap.size > 0
      ? [...speakerMap.values()].filter((n) => n !== "Unknown").join(", ") || summary.attendee
      : summary.attendee;

    const normalized = {
      timestamp,
      sourceFileName: file.fileName,
      title: summary.title,
      attendee: resolvedAttendee,
      brief: truncateWords(summary.brief, 14),
      summary: summary.summary,
      transcript: finalTranscript,
    };

    const saved: SavedMeetingDocument = documentType === "whisper"
      ? await this.storage.saveWhisper(normalized)
      : await this.storage.saveMeeting(normalized);

    // Save audio file alongside the note for playback
    if (!saved.skipped && transcription.audioBytes.length > 0) {
      const ext = transcription.audioCodec === "wav" ? ".wav" : ".mp3";
      const audioPath = saved.notePath.replace(/\.md$/, ext);
      await fs.writeFile(audioPath, transcription.audioBytes);
    }

    return {
      sourceFileName: file.fileName,
      documentType,
      notePath: saved.notePath,
      indexPath: saved.indexPath,
      skipped: saved.skipped,
    };
  }

  async processAllRecordings(
    onItem?: (
      sourceFileName: string,
      index: number,
      total: number,
    ) => void,
  ): Promise<ProcessedRecordingResult[]> {
    const { files } = await this.client.listFiles();
    const sorted = [...files].sort((a, b) => a.fileName.localeCompare(b.fileName));

    const results: ProcessedRecordingResult[] = [];
    for (let index = 0; index < sorted.length; index += 1) {
      const file = sorted[index];
      if (!file) {
        continue;
      }
      if (onItem) {
        onItem(file.fileName, index + 1, sorted.length);
      }
      const result = await this.processRecording(file);
      results.push(result);
    }
    return results;
  }
}

export function isWhisperRecording(fileName: string): boolean {
  return /whsp/i.test(fileName);
}

export function parseHiDockRecordingDate(fileName: string): Date | null {
  const monthNamePattern =
    /^(\d{4})([A-Za-z]{3})(\d{2})-(\d{2})(\d{2})(\d{2})-[^.]+\.[A-Za-z0-9]+$/;
  const monthNameMatch = monthNamePattern.exec(fileName);
  if (monthNameMatch) {
    const year = Number(monthNameMatch[1] ?? "");
    const monthName = (monthNameMatch[2] ?? "").toLowerCase();
    const day = Number(monthNameMatch[3] ?? "");
    const hour = Number(monthNameMatch[4] ?? "");
    const minute = Number(monthNameMatch[5] ?? "");
    const second = Number(monthNameMatch[6] ?? "");
    const month = MONTH_NAME_TO_INDEX[monthName];
    if (typeof month === "number") {
      return new Date(year, month, day, hour, minute, second);
    }
  }

  const numericPattern =
    /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[^.]+\.[A-Za-z0-9]+$/;
  const numericMatch = numericPattern.exec(fileName);
  if (numericMatch) {
    const year = Number(numericMatch[1] ?? "");
    const month = Number(numericMatch[2] ?? "") - 1;
    const day = Number(numericMatch[3] ?? "");
    const hour = Number(numericMatch[4] ?? "");
    const minute = Number(numericMatch[5] ?? "");
    const second = Number(numericMatch[6] ?? "");
    return new Date(year, month, day, hour, minute, second);
  }

  return null;
}

async function summarizeTranscriptWithOllama(
  input: {
    transcript: string;
    model?: string;
    sourceFileName: string;
    ollamaHost?: string;
    hasSpeakerLabels?: boolean;
  },
): Promise<MeetingSummaryResult> {
  const model = input.model ?? "qwen3.5:9b";
  const host = input.ollamaHost ?? "http://localhost:11434";
  const transcript = input.transcript.trim();
  const clippedTranscript = transcript.slice(0, 30000);

  const prompt = input.hasSpeakerLabels
    ? "You are a meeting assistant. The transcript has speaker labels like [Speaker 0], [Speaker 1].\n\n" +
      "1. Identify real names from context (introductions, addressing by name).\n" +
      "2. Map [Speaker N] to real names where possible.\n" +
      "3. Return exactly these keys on separate lines:\n\n" +
      "TITLE: <short title>\n" +
      "ATTENDEE: <comma separated real names, or Speaker N if unidentified>\n" +
      "SPEAKER_MAP: <Speaker 0=Name1, Speaker 1=Name2, ...>\n" +
      "BRIEF: <max 14 words>\n" +
      "SUMMARY: <2-4 concise sentences>\n\n" +
      "Keep BRIEF <= 14 words. /no_think"
    : "You are a meeting assistant. Return exactly these keys on separate lines:\n" +
      "TITLE: <short title>\n" +
      "ATTENDEE: <comma separated attendee names or Unknown>\n" +
      "BRIEF: <max 14 words>\n" +
      "SUMMARY: <2-4 concise sentences>\n\n" +
      "Keep BRIEF <= 14 words. /no_think";

  try {
    const rawContent = await streamOllamaChat(host, {
      model,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content:
            `Source filename: ${input.sourceFileName}\n` +
            `Transcript:\n${clippedTranscript || "(empty transcript)"}`,
        },
      ],
    });

    const content = stripThinkTags(rawContent);
    const parsed = parseSummaryBlock(content);
    const speakerMap = input.hasSpeakerLabels ? parseSpeakerMap(content) : undefined;
    return {
      title: parsed.title || fallbackTitleFromTranscript(transcript),
      attendee: parsed.attendee || "Unknown",
      brief: truncateWords(parsed.brief || transcript || "No content", 14),
      summary:
        parsed.summary ||
        fallbackSummaryFromTranscript(transcript) ||
        "No summary available.",
      ...(speakerMap && speakerMap.size > 0 ? { speakerMap } : {}),
    };
  } catch {
    return {
      title: fallbackTitleFromTranscript(transcript),
      attendee: "Unknown",
      brief: truncateWords(transcript || "No content", 14),
      summary: fallbackSummaryFromTranscript(transcript) || "No summary available.",
    };
  }
}

async function streamOllamaChat(
  host: string,
  body: { model: string; messages: { role: string; content: string }[] },
): Promise<string> {
  const response = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  }

  let content = "";
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
        if (obj.message?.content) content += obj.message.content;
      } catch {
        // partial JSON line, ignore
      }
    }
  }
  return content;
}

export function stripThinkTags(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

function parseSummaryBlock(content: string): Partial<MeetingSummaryResult> {
  const title = extractLine(content, "TITLE");
  const attendee = extractLine(content, "ATTENDEE");
  const brief = extractLine(content, "BRIEF");
  const summary = extractSummary(content);
  return { title, attendee, brief, summary };
}

function extractLine(content: string, key: string): string {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, "im");
  const match = regex.exec(content);
  return (match?.[1] ?? "").trim();
}

function extractSummary(content: string): string {
  const summaryRegex = /^SUMMARY:\s*([\s\S]+)$/im;
  const summaryMatch = summaryRegex.exec(content);
  return (summaryMatch?.[1] ?? "").trim();
}

function fallbackTitleFromTranscript(transcript: string): string {
  const words = transcript
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, 8);
  if (words.length === 0) {
    return "Untitled Meeting";
  }
  const title = words.join(" ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function fallbackSummaryFromTranscript(transcript: string): string {
  const words = transcript
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) {
    return "";
  }
  return words.slice(0, 80).join(" ");
}

/**
 * Parse a SPEAKER_MAP line from LLM output.
 * Expected format: "SPEAKER_MAP: Speaker 0=Alice, Speaker 1=Bob"
 */
export function parseSpeakerMap(content: string): Map<number, string> {
  const map = new Map<number, string>();
  const line = extractLine(content, "SPEAKER_MAP");
  if (!line) return map;

  const pairs = line.split(",");
  for (const pair of pairs) {
    const match = /Speaker\s*(\d+)\s*=\s*(.+)/i.exec(pair.trim());
    if (match) {
      const index = Number(match[1]);
      const name = (match[2] ?? "").trim();
      if (name && !isNaN(index)) {
        map.set(index, name);
      }
    }
  }
  return map;
}

/**
 * Replace [Speaker N] and [Speaker N @time] labels with resolved real names.
 */
export function applySpeakerNames(
  transcript: string,
  speakerMap: Map<number, string>,
): string {
  let result = transcript;
  for (const [index, name] of speakerMap) {
    // Handle [Speaker N @time] format (with timestamp)
    result = result.replace(
      new RegExp(`\\[Speaker ${index} @([\\d.]+)\\]`, "g"),
      `[${name} @$1]`,
    );
    // Handle [Speaker N] format (without timestamp)
    result = result.replaceAll(`[Speaker ${index}]`, `[${name}]`);
  }
  return result;
}

/**
 * Parse a JSON speaker map from LLM output.
 * Accepts: {"0": "Alice", "1": "Bob"} or {"Speaker 0": "Alice", ...}
 */
export function parseSpeakerMapJson(content: string): Map<number, string> {
  const map = new Map<number, string>();
  // Extract first JSON object from the content
  const jsonMatch = /\{[^{}]*\}/.exec(content);
  if (!jsonMatch) return map;

  try {
    const obj = JSON.parse(jsonMatch[0]) as Record<string, string>;
    for (const [key, name] of Object.entries(obj)) {
      if (typeof name !== "string" || !name.trim()) continue;
      const trimmed = name.trim();
      // Skip unresolved placeholders
      if (/^unknown$/i.test(trimmed) || /^speaker\s*\d+$/i.test(trimmed)) continue;
      // Accept "0", "Speaker 0", "speaker_0" etc.
      const numMatch = /(\d+)/.exec(key);
      if (numMatch) {
        map.set(Number(numMatch[1]), trimmed);
      }
    }
  } catch {
    // Not valid JSON
  }
  return map;
}

/**
 * Resolve speaker names using two strategies:
 * 1. Heuristic: detect names addressed in preceding speaker's lines
 *    (e.g., Speaker 0 says "Steve, when you..." → next Speaker 1 = Steve)
 * 2. LLM fallback: dedicated focused call if heuristic finds nothing
 */
export async function resolveSpeakerNames(input: {
  transcript: string;
  speakerCount: number;
  model?: string;
  ollamaHost?: string;
}): Promise<Map<number, string>> {
  // Strategy 1: Heuristic name detection from transcript
  const heuristicMap = extractNamesFromTranscript(input.transcript);
  if (heuristicMap.size > 0) return heuristicMap;

  // Strategy 2: LLM call
  const host = input.ollamaHost ?? "http://localhost:11434";
  const model = input.model ?? "qwen3.5:9b";
  const clipped = input.transcript.slice(0, 5000);

  const prompt =
    `Who is each speaker? List each as "Speaker N = Name".\n` +
    `Example:\nSpeaker 0 = Alice\nSpeaker 1 = Bob\n\n` +
    `If unknown, write "Speaker N = Unknown".`;

  try {
    const rawContent = await streamOllamaChat(host, {
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: clipped },
      ],
    });
    const content = stripThinkTags(rawContent)
      .replace(/<\|[^|]*\|>/g, "")
      .replace(/\|>.*$/s, "")
      .trim();

    const jsonMap = parseSpeakerMapJson(content);
    if (jsonMap.size > 0) return jsonMap;

    const lineMap = new Map<number, string>();
    for (const line of content.split("\n")) {
      const match = /Speaker\s*(\d+)\s*[=:]\s*(.+)/i.exec(line);
      if (match) {
        const idx = Number(match[1]);
        const name = (match[2] ?? "").replace(/[*_`"]/g, "").trim();
        if (
          name && !isNaN(idx) &&
          !/^unknown$/i.test(name) && !/^speaker\s*\d+$/i.test(name) &&
          name.length <= 40 && !/[.!?]/.test(name) && name.split(/\s+/).length <= 5
        ) {
          lineMap.set(idx, name);
        }
      }
    }
    if (lineMap.size > 0) return lineMap;

    return parseSpeakerMap(content);
  } catch {
    return new Map();
  }
}

/**
 * Extract speaker names from transcript using address patterns.
 * Looks for lines where Speaker A says "Name, ..." then Speaker B responds →
 * Speaker B is likely "Name".
 * Also looks for self-introductions: "I'm Name" / "my name is Name" / "I am Name".
 */
export function extractNamesFromTranscript(transcript: string): Map<number, string> {
  const map = new Map<number, string>();
  const lines = transcript.split("\n");
  const labelPattern = /^\[(?:Speaker\s*(\d+))[^[\]]*\]:\s*/;

  // Common first names / titles that confirm a name address
  const isPlausibleName = (n: string): boolean => {
    if (n.length < 2 || n.length > 25) return false;
    if (!/^[A-Z]/.test(n)) return false;              // Must start uppercase
    if (/^(The|This|That|What|How|Why|Where|When|Who|If|So|But|And|Or|Yeah|Yes|No|OK|Oh|Well|Now|Hi|Hey|My|We|You|I|It|A|An)$/i.test(n)) return false;
    if (n.split(/\s+/).length > 3) return false;
    return true;
  };

  for (let i = 0; i < lines.length - 1; i++) {
    const curLine = lines[i] ?? "";
    const nextLine = lines[i + 1] ?? "";
    const curMatch = labelPattern.exec(curLine);
    const nextMatch = labelPattern.exec(nextLine);
    if (!curMatch || !nextMatch) continue;

    const curSpeaker = Number(curMatch[1]);
    const nextSpeaker = Number(nextMatch[1]);
    if (curSpeaker === nextSpeaker) continue;

    const curText = curLine.slice(curMatch[0].length);

    // Pattern: "Name, when you..." / "Name, what..." — addressing next speaker
    const addressMatch = /^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?),\s/.exec(curText);
    if (addressMatch) {
      const name = addressMatch[1] ?? "";
      if (isPlausibleName(name) && !map.has(nextSpeaker)) {
        map.set(nextSpeaker, name);
      }
      continue;
    }

    // Pattern: "Thank you, Name" / "right, Name" at end of line
    const endAddressMatch = /,\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*[.?!]?\s*$/.exec(curText);
    if (endAddressMatch) {
      const name = endAddressMatch[1] ?? "";
      if (isPlausibleName(name) && !map.has(nextSpeaker)) {
        map.set(nextSpeaker, name);
      }
    }
  }

  // Self-introductions: "I'm Name" / "my name is Name"
  for (const line of lines) {
    const lineMatch = labelPattern.exec(line);
    if (!lineMatch) continue;
    const speakerIdx = Number(lineMatch[1]);
    const text = line.slice(lineMatch[0].length);

    const selfIntro = /(?:I'm|I am|my name is|this is)\s+([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/i.exec(text);
    if (selfIntro) {
      const name = selfIntro[1] ?? "";
      if (isPlausibleName(name) && !map.has(speakerIdx)) {
        map.set(speakerIdx, name);
      }
    }
  }

  return map;
}
