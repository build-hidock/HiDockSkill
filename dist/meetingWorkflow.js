import { promises as fs } from "node:fs";
import OpenAI from "openai";
import { truncateWords } from "./meetingStorage.js";
import { LocalMeetingStorageAdapter } from "./notesStorage.js";
import { HiDockWhisperSkill } from "./skill.js";
const MONTH_NAME_TO_INDEX = {
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
export class HiDockMeetingWorkflow {
    client;
    transcribeSkill;
    storage;
    options;
    openai;
    constructor(client, options) {
        this.client = client;
        this.options = options;
        this.transcribeSkill = new HiDockWhisperSkill(client, options);
        this.storage =
            options.storageAdapter ??
                new LocalMeetingStorageAdapter({ rootDir: options.storageRootDir });
        this.openai = new OpenAI({ apiKey: options.apiKey });
    }
    async processRecording(file, onProgress) {
        const documentType = isWhisperRecording(file.fileName)
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
        const summary = await summarizeTranscriptWithModel(this.openai, {
            transcript: transcription.text,
            sourceFileName: file.fileName,
            ...(this.options.summaryModel ? { model: this.options.summaryModel } : {}),
        });
        const normalized = {
            timestamp,
            sourceFileName: file.fileName,
            title: summary.title,
            attendee: summary.attendee,
            brief: truncateWords(summary.brief, 14),
            summary: summary.summary,
            transcript: transcription.text,
        };
        const saved = documentType === "whisper"
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
    async processAllRecordings(onItem) {
        const { files } = await this.client.listFiles();
        const sorted = [...files].sort((a, b) => a.fileName.localeCompare(b.fileName));
        const results = [];
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
export function isWhisperRecording(fileName) {
    return /whsp/i.test(fileName);
}
export function parseHiDockRecordingDate(fileName) {
    const monthNamePattern = /^(\d{4})([A-Za-z]{3})(\d{2})-(\d{2})(\d{2})(\d{2})-[^.]+\.[A-Za-z0-9]+$/;
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
    const numericPattern = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[^.]+\.[A-Za-z0-9]+$/;
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
async function summarizeTranscriptWithModel(openai, input) {
    const model = input.model ?? "gpt-4o-mini";
    const transcript = input.transcript.trim();
    const clippedTranscript = transcript.slice(0, 30000);
    const prompt = "You are a meeting assistant. Return exactly these keys on separate lines:\n" +
        "TITLE: <short title>\n" +
        "ATTENDEE: <comma separated attendee names or Unknown>\n" +
        "BRIEF: <max 14 words>\n" +
        "SUMMARY: <2-4 concise sentences>\n\n" +
        "Keep BRIEF <= 14 words.";
    try {
        const completion = await openai.chat.completions.create({
            model,
            messages: [
                { role: "system", content: prompt },
                {
                    role: "user",
                    content: `Source filename: ${input.sourceFileName}\n` +
                        `Transcript:\n${clippedTranscript || "(empty transcript)"}`,
                },
            ],
            temperature: 0.2,
        });
        const content = completion.choices[0]?.message?.content ?? "";
        const parsed = parseSummaryBlock(content);
        return {
            title: parsed.title || fallbackTitleFromTranscript(transcript),
            attendee: parsed.attendee || "Unknown",
            brief: truncateWords(parsed.brief || transcript || "No content", 14),
            summary: parsed.summary ||
                fallbackSummaryFromTranscript(transcript) ||
                "No summary available.",
        };
    }
    catch {
        return {
            title: fallbackTitleFromTranscript(transcript),
            attendee: "Unknown",
            brief: truncateWords(transcript || "No content", 14),
            summary: fallbackSummaryFromTranscript(transcript) || "No summary available.",
        };
    }
}
function parseSummaryBlock(content) {
    const title = extractLine(content, "TITLE");
    const attendee = extractLine(content, "ATTENDEE");
    const brief = extractLine(content, "BRIEF");
    const summary = extractSummary(content);
    return { title, attendee, brief, summary };
}
function extractLine(content, key) {
    const regex = new RegExp(`^${key}:\\s*(.+)$`, "im");
    const match = regex.exec(content);
    return (match?.[1] ?? "").trim();
}
function extractSummary(content) {
    const summaryRegex = /^SUMMARY:\s*([\s\S]+)$/im;
    const summaryMatch = summaryRegex.exec(content);
    return (summaryMatch?.[1] ?? "").trim();
}
function fallbackTitleFromTranscript(transcript) {
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
function fallbackSummaryFromTranscript(transcript) {
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
//# sourceMappingURL=meetingWorkflow.js.map