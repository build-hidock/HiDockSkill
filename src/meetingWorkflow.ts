import { promises as fs } from "node:fs";

import { HiDockClient } from "./client.js";
import { HiDockFileEntry } from "./fileList.js";
import { DocumentKind, SavedMeetingDocument, truncateWords } from "./meetingStorage.js";
import { LocalMeetingStorageAdapter, NotesStorageAdapter } from "./notesStorage.js";
import { HiDockSkillOptions, HiDockWhisperSkill } from "./skill.js";
import { formatSpeakerTranscript, transcribeAudio } from "./transcribe.js";

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

export interface DownloadedRecording {
  file: HiDockFileEntry;
  audioBytes: Uint8Array;
  audioCodec: "mp3" | "wav";
  documentType: DocumentKind;
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

  /**
   * Download a recording from the device (USB-bound stage).
   * Returns audio bytes ready for offline processing.
   */
  async downloadRecording(
    file: HiDockFileEntry,
    onProgress?: (receivedBytes: number, expectedBytes: number) => void,
  ): Promise<DownloadedRecording> {
    const documentType: DocumentKind = isWhisperRecording(file.fileName)
      ? "whisper"
      : "meeting";
    const indexPath = this.storage.getIndexPath(documentType);
    if (await this.storage.isIndexed(file.fileName, documentType)) {
      return { file, audioBytes: new Uint8Array(), audioCodec: "mp3", documentType, indexPath, skipped: true };
    }

    const downloadOptions = {
      expectedSize: file.fileSize,
      ...(onProgress ? { onProgress } : {}),
    };
    const audioBytes = await this.client.withConnection(() =>
      this.client.downloadFile(file, downloadOptions),
    );

    return {
      file,
      audioBytes,
      audioCodec: file.audioProfile?.codec ?? "mp3",
      documentType,
      indexPath,
      skipped: false,
    };
  }

  /**
   * Transcribe, summarize, and save a previously downloaded recording.
   * This stage is CPU/LLM-bound and does not touch USB.
   */
  async processDownloadedRecording(
    downloaded: DownloadedRecording,
    onStageChange?: (stage: "transcribing" | "summarizing") => void,
  ): Promise<ProcessedRecordingResult> {
    const { file, documentType, indexPath } = downloaded;
    if (downloaded.skipped) {
      return { sourceFileName: file.fileName, documentType, notePath: "", indexPath, skipped: true };
    }

    if (onStageChange) onStageChange("transcribing");

    const transcription = await transcribeAudio({
      audioBytes: downloaded.audioBytes,
      sourceFileName: file.fileName,
      fileVersion: file.fileVersion,
      ...(this.options.language ? { language: this.options.language } : {}),
      ...(this.options.pythonBin ? { pythonBin: this.options.pythonBin } : {}),
    });

    const timestamp = parseHiDockRecordingDate(file.fileName) ?? new Date();
    const hasSpeakers = transcription.speakerSegments && transcription.speakerSegments.length > 0;
    const transcriptForLlm = hasSpeakers
      ? formatSpeakerTranscript(transcription.speakerSegments!)
      : transcription.text;

    if (onStageChange) onStageChange("summarizing");

    const summary = await summarizeTranscriptWithOllama({
      transcript: transcriptForLlm,
      sourceFileName: file.fileName,
      hasSpeakerLabels: hasSpeakers ?? false,
      ...(this.options.summaryModel ? { model: this.options.summaryModel } : {}),
      ...(this.options.ollamaHost ? { ollamaHost: this.options.ollamaHost } : {}),
    });

    let speakerMap = summary.speakerMap ?? new Map<number, string>();
    if (hasSpeakers && speakerMap.size === 0 && (transcription.speakerCount ?? 0) > 0) {
      speakerMap = await resolveSpeakerNames({
        transcript: transcriptForLlm,
        speakerCount: transcription.speakerCount!,
        ...(this.options.summaryModel ? { model: this.options.summaryModel } : {}),
        ...(this.options.ollamaHost ? { ollamaHost: this.options.ollamaHost } : {}),
      });
    }

    const finalTranscript = speakerMap.size > 0
      ? applySpeakerNames(transcriptForLlm, speakerMap)
      : transcriptForLlm;

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

    if (!saved.skipped && downloaded.audioBytes.length > 0) {
      const ext = downloaded.audioCodec === "wav" ? ".wav" : ".mp3";
      const audioPath = saved.notePath.replace(/\.md$/, ext);
      await fs.writeFile(audioPath, downloaded.audioBytes);
    }

    return {
      sourceFileName: file.fileName,
      documentType,
      notePath: saved.notePath,
      indexPath: saved.indexPath,
      skipped: saved.skipped,
    };
  }

  /** Convenience: download + process in one call (legacy sequential path). */
  async processRecording(
    file: HiDockFileEntry,
    onProgress?: (receivedBytes: number, expectedBytes: number) => void,
    onStageChange?: (stage: "summarizing") => void,
  ): Promise<ProcessedRecordingResult> {
    const downloaded = await this.downloadRecording(file, onProgress);
    return this.processDownloadedRecording(downloaded, (stage) => {
      if (stage === "summarizing" && onStageChange) onStageChange("summarizing");
    });
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

const MEETING_SUMMARY_PROMPT =
  "You are a professional meeting summarizing assistant.\n\n" +
  'Please use this format, but don\'t use "topic 1", "subtopic 1", "summary", use the summarization content instead.\n\n' +
  "## About Meeting\n" +
  "Date & Time: [insert meeting date and time]\n" +
  "Location: [insert location]\n" +
  "Attendee: [insert names]\n\n" +
  "## Meeting Outline\n" +
  "### Topic 1\n" +
  "- subtopic 1: summary description of subtopic 1\n" +
  "- subtopic 2: summary description of subtopic 2\n" +
  "- subtopic 3: summary description of subtopic 3\n\n" +
  "### Topic 2\n" +
  "- subtopic 4: summary description of subtopic 4\n" +
  "- subtopic 5: summary description of subtopic 5\n" +
  "- subtopic 6: summary description of subtopic 6\n\n" +
  "### Topic 3 and more\n\n" +
  "## Overview\n" +
  "- conclusion of subtopic 1\n" +
  "- conclusion of subtopic 2\n" +
  "- conclusion of subtopic 3\n" +
  "- conclusion of subtopic 4 ...\n\n" +
  "## Todo List\n" +
  "- [ ] Action item with deadline and owner\n\n" +
  'Please generate a meeting summary to be comprehensive. including "About Meeting" with time, location and attendees, ' +
  '"meeting outline" with the key points, for each subtopic, please describe detailed discussion content. ' +
  "Please group related subtopics into one topic, and give a name for the topic.\n\n" +
  "Please make sure you list all action items one by one, if there is clear deadline, assigned person and deliverables, please list together.\n\n" +
  "Present this as a professional meeting summary assistant, akin to the work of a personal secretary.\n\n" +
  "Summarize in a professional, concise, and clear manner, avoiding complex terminology to ensure all team members, " +
  "regardless of their level of expertise, can understand the content.\n\n" +
  "This meeting summary is intended for all team members, including those who attended and those who did not, " +
  "serving as a reference for their review and work.\n\n" +
  "Please output in Markdown format, using appropriate font sizes and formatting symbols (##, ###, -).";

const SPEAKER_ADDENDUM =
  "\n\nThe transcript has speaker labels like [Speaker 0], [Speaker 1]. " +
  "Identify real names from context (introductions, addressing by name). " +
  "At the very end of your output, add a line:\n" +
  "SPEAKER_MAP: Speaker 0=Name1, Speaker 1=Name2, ...";

async function summarizeTranscriptWithOllama(
  input: {
    transcript: string;
    model?: string;
    sourceFileName: string;
    ollamaHost?: string;
    hasSpeakerLabels?: boolean;
  },
): Promise<MeetingSummaryResult> {
  const model = input.model ?? "mlx-community/Qwen3.5-9B-4bit";
  const host = input.ollamaHost ?? "http://localhost:8080";
  const transcript = input.transcript.trim();
  const clippedTranscript = transcript.slice(0, 30000);

  const prompt = input.hasSpeakerLabels
    ? MEETING_SUMMARY_PROMPT + SPEAKER_ADDENDUM
    : MEETING_SUMMARY_PROMPT;

  try {
    const rawContent = await streamLlmChat(host, {
      model,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content:
            `Source filename: ${input.sourceFileName}\n` +
            `Transcript:\n${clippedTranscript || "(empty transcript)"}\n\n/no_think`,
        },
      ],
    });

    const content = sanitizeLlmOutput(rawContent);

    const parsed = parseMeetingSummaryMarkdown(content);
    const speakerMap = input.hasSpeakerLabels ? parseSpeakerMap(content) : undefined;
    return {
      title: parsed.title || fallbackTitleFromTranscript(transcript),
      attendee: parsed.attendee || "Unknown",
      brief: truncateWords(parsed.brief || transcript || "No content", 14),
      summary: parsed.summary || fallbackSummaryFromTranscript(transcript) || "No summary available.",
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

/**
 * Parse the markdown meeting summary output.
 * Extracts attendee, title (from first topic), brief (from overview), and full markdown as summary.
 */
function parseMeetingSummaryMarkdown(content: string): Partial<MeetingSummaryResult> {
  // Extract attendee from "Attendee: ..." line
  const attendeeMatch = /Attendee:\s*(.+)/im.exec(content);
  const attendee = attendeeMatch
    ? (attendeeMatch[1] ?? "").replace(/\[|\]/g, "").trim()
    : "";

  // Extract title from first ### heading (first topic)
  const topicMatch = /^###\s+(.+)/m.exec(content);
  const title = topicMatch ? (topicMatch[1] ?? "").trim() : "";

  // Extract brief from first bullet in Overview section
  const overviewMatch = /## (?:📋\s*)?Overview\n([\s\S]*?)(?=\n## |\n#\s|$)/i.exec(content);
  let brief = "";
  if (overviewMatch) {
    const firstBullet = /^-\s+(.+)/m.exec(overviewMatch[1] ?? "");
    brief = firstBullet ? (firstBullet[1] ?? "").trim() : "";
  }

  // Strip SPEAKER_MAP line from summary (it's metadata, not content)
  const summary = content.replace(/^SPEAKER_MAP:.*$/gm, "").trim();

  // Fallback: try old structured format if markdown parsing found nothing
  if (!attendee && !title) {
    return parseSummaryBlock(content);
  }

  return { title, attendee, brief, summary };
}

async function streamLlmChat(
  host: string,
  body: { model: string; messages: { role: string; content: string }[] },
): Promise<string> {
  // Detect API style from host URL
  const isOllama = host.includes("11434");
  const url = isOllama ? `${host}/api/chat` : `${host}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...body,
      stream: true,
      ...(!isOllama ? { max_tokens: 4096 } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM server returned ${response.status}: ${await response.text()}`);
  }

  let content = "";
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split("\n")) {
      const trimmed = line.replace(/^data: /, "").trim();
      if (!trimmed || trimmed === "[DONE]") continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        // Ollama format: { message: { content } }
        const ollamaContent = (obj.message as { content?: string } | undefined)?.content;
        if (ollamaContent) { content += ollamaContent; continue; }
        // OpenAI format: { choices: [{ delta: { content } }] }
        const choices = obj.choices as { delta?: { content?: string } }[] | undefined;
        if (choices?.[0]?.delta?.content) content += choices[0].delta.content;
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

/** Strip LLM artifacts: think tags, special tokens, trailing token fragments. */
export function sanitizeLlmOutput(text: string): string {
  return stripThinkTags(text)
    .replace(/<\|[^|]*\|>/g, "")      // Qwen/ChatML tokens like <|endoftext|>, <|im_start|>
    .replace(/\|>[\s\S]*$/g, "")       // Truncate from stray |> onwards
    .replace(/(?:^|\n)\s*(?:user|assistant|system)\s*$/gm, "") // Trailing role labels
    .trim();
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
  const host = input.ollamaHost ?? "http://localhost:8080";
  const model = input.model ?? "mlx-community/Qwen3.5-9B-4bit";
  const clipped = input.transcript.slice(0, 5000);

  const prompt =
    `Who is each speaker? List each as "Speaker N = Name".\n` +
    `Example:\nSpeaker 0 = Alice\nSpeaker 1 = Bob\n\n` +
    `If unknown, write "Speaker N = Unknown".`;

  try {
    const rawContent = await streamLlmChat(host, {
      model,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: clipped + "\n\n/no_think" },
      ],
    });
    const content = sanitizeLlmOutput(rawContent);

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
