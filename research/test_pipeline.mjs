#!/usr/bin/env node
/**
 * Test the transcription + summary + storage pipeline with a local audio file.
 * Bypasses USB — proves Whisper, GPT summary, and MeetingStorage work end-to-end.
 *
 * Usage:
 *   node research/test_pipeline.mjs <path-to-audio-file>
 *
 * Requires OPENAI_API_KEY in .env or environment.
 */
import fs from "node:fs";
import path from "node:path";
import { transcribeWithWhisper } from "../dist/whisper.js";
import { MeetingStorage, truncateWords } from "../dist/meetingStorage.js";
import OpenAI from "openai";

const audioPath = process.argv[2];
if (!audioPath) {
  console.error("Usage: node research/test_pipeline.mjs <audio-file>");
  process.exit(1);
}

// Load .env if present
try {
  const envPath = path.resolve(process.cwd(), ".env");
  const envContent = fs.readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim();
    }
  }
} catch {}

const apiKey = process.env.OPENAI_API_KEY ?? "";
if (!apiKey) {
  console.error("OPENAI_API_KEY is required. Set it in .env or export it.");
  process.exit(1);
}

const resolved = path.resolve(audioPath);
if (!fs.existsSync(resolved)) {
  console.error(`File not found: ${resolved}`);
  process.exit(1);
}

const audioBytes = new Uint8Array(fs.readFileSync(resolved));
const sourceFileName = path.basename(resolved);
const storageDir = path.resolve(process.cwd(), "meeting-storage");

console.log(`Audio file  : ${resolved} (${(audioBytes.length / 1024).toFixed(1)} KB)`);
console.log(`Storage dir : ${storageDir}`);
console.log();

// Step 1: Whisper transcription
console.log("[1/3] Transcribing with Whisper...");
const transcript = await transcribeWithWhisper({
  apiKey,
  audioBytes,
  sourceFileName,
  model: "whisper-1",
});
console.log(`      Model    : ${transcript.model}`);
console.log(`      Format   : ${transcript.detectedFormat}`);
console.log(`      Text     : ${transcript.text.slice(0, 200)}${transcript.text.length > 200 ? "..." : ""}`);
console.log();

// Step 2: GPT summary
console.log("[2/3] Summarizing with GPT...");
const openai = new OpenAI({ apiKey });
const prompt =
  "You are a meeting assistant. Return exactly these keys on separate lines:\n" +
  "TITLE: <short title>\n" +
  "ATTENDEE: <comma separated attendee names or Unknown>\n" +
  "BRIEF: <max 14 words>\n" +
  "SUMMARY: <2-4 concise sentences>\n\n" +
  "Keep BRIEF <= 14 words.";

const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [
    { role: "system", content: prompt },
    { role: "user", content: `Source filename: ${sourceFileName}\nTranscript:\n${transcript.text.slice(0, 30000)}` },
  ],
  temperature: 0.2,
});
const summaryRaw = completion.choices[0]?.message?.content ?? "";
console.log(`      Raw GPT output:\n${summaryRaw}`);
console.log();

// Parse summary
function extractLine(content, key) {
  const m = new RegExp(`^${key}:\\s*(.+)$`, "im").exec(content);
  return m?.[1]?.trim() ?? "";
}
const title = extractLine(summaryRaw, "TITLE") || "Untitled";
const attendee = extractLine(summaryRaw, "ATTENDEE") || "Unknown";
const brief = extractLine(summaryRaw, "BRIEF") || transcript.text.split(" ").slice(0, 14).join(" ");
const summaryMatch = /^SUMMARY:\s*([\s\S]+)$/im.exec(summaryRaw);
const summary = summaryMatch?.[1]?.trim() ?? "No summary.";

// Step 3: Save to storage
console.log("[3/3] Saving to MeetingStorage...");
const storage = new MeetingStorage({ rootDir: storageDir });
const saved = await storage.saveMeeting({
  timestamp: new Date(),
  sourceFileName,
  title,
  attendee,
  brief: truncateWords(brief, 14),
  summary,
  transcript: transcript.text,
});

if (saved.skipped) {
  console.log(`      Skipped (already indexed)`);
} else {
  console.log(`      Note  : ${saved.notePath}`);
  console.log(`      Index : ${saved.indexPath}`);
}

console.log();
console.log("=== Pipeline test complete ===");
