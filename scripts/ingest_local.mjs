#!/usr/bin/env node
/**
 * Ingest a local WAV file into MeetingStorage and launch Galaxy dashboard.
 *
 * Usage: node scripts/ingest_local.mjs <wav_path> [--open]
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { parseMoonshineOutput, formatSpeakerTranscript } from "../dist/transcribe.js";
import {
  sanitizeLlmOutput,
  parseSpeakerMap,
  parseSpeakerMapJson,
  applySpeakerNames,
  resolveSpeakerNames,
} from "../dist/meetingWorkflow.js";
import { MeetingStorage, truncateWords } from "../dist/meetingStorage.js";
import { buildGalaxyData } from "../dist/galaxyData.js";
import { startGalaxyServer } from "../dist/galaxyServer.js";

const STORAGE_DIR = "/Users/seansong/seanslab/Obsidian/OpenClawWorkspace/MeetingNotes";

function execPromise(command, args) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { maxBuffer: 50 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${command} failed: ${stderr || error.message}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function streamOllama(host, body) {
  const response = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, stream: true }),
  });
  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  }
  let content = "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = decoder.decode(value, { stream: true });
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.message?.content) content += obj.message.content;
      } catch { /* partial line */ }
    }
  }
  return content;
}

function extractLine(content, key) {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, "im");
  const match = regex.exec(content);
  return (match?.[1] ?? "").trim();
}

function extractSummary(content) {
  const regex = /^SUMMARY:\s*([\s\S]+)$/im;
  const match = regex.exec(content);
  return (match?.[1] ?? "").trim();
}

async function main() {
  const args = process.argv.slice(2);
  const wavPath = args.find(a => !a.startsWith("--"));
  const shouldOpen = args.includes("--open");

  if (!wavPath) {
    console.error("Usage: node scripts/ingest_local.mjs <wav_path> [--open]");
    process.exit(1);
  }

  const baseName = path.basename(wavPath, path.extname(wavPath));
  const sourceFileName = `20260318-120000-${baseName}.wav`;

  // Step 1: Convert to 16kHz PCM WAV
  console.log(`[1/5] Converting ${path.basename(wavPath)} to 16kHz PCM WAV...`);
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "hidock-ingest-"));
  const pcmPath = path.join(tempDir, "input_16k.wav");
  await execPromise("ffmpeg", ["-y", "-i", wavPath, "-ar", "16000", "-ac", "1", "-f", "wav", pcmPath]);

  // Step 2: Transcribe with Moonshine
  console.log("[2/5] Transcribing with Moonshine (speaker diarization)...");
  const scriptPath = path.resolve("scripts", "moonshine_transcribe.py");
  const pythonBin = path.resolve(".venv", "bin", "python");
  const rawOutput = await execPromise(pythonBin, [scriptPath, pcmPath, "en"]);

  const parsed = parseMoonshineOutput(rawOutput.trim());
  const segCount = parsed.speakerSegments?.length ?? 0;
  const spkCount = parsed.speakerCount ?? 0;
  console.log(`     ${segCount} segments, ${spkCount} speakers`);

  const hasSpeakers = parsed.speakerSegments && parsed.speakerSegments.length > 0;
  const speakerTranscript = hasSpeakers
    ? formatSpeakerTranscript(parsed.speakerSegments)
    : parsed.text;

  // Step 3: Summarize with Ollama
  console.log("[3/5] Summarizing with Ollama...");
  const host = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL ?? "qwen3.5:9b";

  const MEETING_SUMMARY_PROMPT =
    "You are a professional meeting summarizing assistant.\n\n" +
    'Please use this format, but don\'t use "topic 1", "subtopic 1", "summary", use the summarization content instead.\n\n' +
    "## About Meeting\nDate & Time: [insert meeting date and time]\nLocation: [insert location]\nAttendee: [insert names]\n\n" +
    "## Meeting Outline\n### Topic 1\n- subtopic 1: summary description\n- subtopic 2: summary description\n\n" +
    "### Topic 2\n- subtopic 3: summary description\n\n### Topic 3 and more\n\n" +
    "## Overview\n- conclusion of subtopic 1\n- conclusion of subtopic 2\n\n" +
    "## Todo List\n- [ ] Action item with deadline and owner\n\n" +
    "Please generate a comprehensive meeting summary including About Meeting, Meeting Outline with detailed subtopics, Overview with conclusions, and Todo List with action items.\n" +
    "Group related subtopics into named topics. Output in Markdown format.";

  const SPEAKER_ADDENDUM =
    "\n\nThe transcript has speaker labels like [Speaker 0], [Speaker 1]. " +
    "Identify real names from context. At the very end, add: SPEAKER_MAP: Speaker 0=Name1, Speaker 1=Name2, ...";

  const systemPrompt = hasSpeakers
    ? MEETING_SUMMARY_PROMPT + SPEAKER_ADDENDUM
    : MEETING_SUMMARY_PROMPT;

  const clipped = speakerTranscript.slice(0, 30000);
  const llmRaw = await streamOllama(host, {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Source filename: ${sourceFileName}\nTranscript:\n${clipped}` },
    ],
  });

  const llmContent = sanitizeLlmOutput(llmRaw);
  console.log("     LLM output (first 10 lines):");
  console.log("     " + llmContent.split("\n").slice(0, 10).join("\n     "));

  // Parse markdown summary format
  const attendeeMatch = /Attendee:\s*(.+)/im.exec(llmContent);
  const attendee = attendeeMatch ? attendeeMatch[1].replace(/\[|\]/g, "").trim() : "Unknown";
  const topicMatch = /^###\s+(.+)/m.exec(llmContent);
  const title = topicMatch ? topicMatch[1].trim() : `${baseName} Recording`;
  const overviewMatch = /## (?:📋\s*)?Overview\n([\s\S]*?)(?=\n## |\n#\s|$)/i.exec(llmContent);
  let brief = "";
  if (overviewMatch) { const fb = /^-\s+(.+)/m.exec(overviewMatch[1] || ""); brief = fb ? fb[1].trim() : ""; }
  brief = brief || speakerTranscript.slice(0, 60);
  const summary = llmContent.replace(/^SPEAKER_MAP:.*$/gm, "").trim();

  // Try to resolve speaker names from summary output first
  let speakerMap = hasSpeakers ? parseSpeakerMap(llmContent) : new Map();
  if (speakerMap.size === 0 && hasSpeakers) {
    speakerMap = parseSpeakerMapJson(llmContent);
  }

  // If still no names, do a dedicated speaker resolution call
  if (speakerMap.size === 0 && hasSpeakers && parsed.speakerCount > 0) {
    console.log("[3.5/5] Resolving speaker names (dedicated call)...");
    speakerMap = await resolveSpeakerNames({
      transcript: speakerTranscript,
      speakerCount: parsed.speakerCount,
      model,
      ollamaHost: host,
    });
  }

  const finalTranscript = speakerMap.size > 0
    ? applySpeakerNames(speakerTranscript, speakerMap)
    : speakerTranscript;

  const resolvedAttendee = speakerMap.size > 0
    ? [...speakerMap.values()].filter(n => n !== "Unknown").join(", ") || attendee
    : attendee;

  if (speakerMap.size > 0) {
    console.log("     Speaker map: " +
      [...speakerMap.entries()].map(([i, n]) => `Speaker ${i} -> ${n}`).join(", "));
  }

  // Step 4: Save to MeetingStorage
  console.log("[4/5] Saving to MeetingStorage...");
  const storage = new MeetingStorage({ rootDir: STORAGE_DIR });
  const saved = await storage.saveMeeting({
    timestamp: new Date(),
    sourceFileName,
    title,
    attendee: resolvedAttendee,
    brief: truncateWords(brief, 14),
    summary,
    transcript: finalTranscript,
  });

  if (saved.skipped) {
    console.log("     Already indexed, skipping");
  } else {
    console.log(`     Saved: ${saved.notePath}`);

    // Copy audio alongside the note
    const audioPath = saved.notePath.replace(/\.md$/, ".wav");
    await fs.copyFile(wavPath, audioPath);
    console.log(`     Audio: ${audioPath}`);
  }

  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

  // Step 5: Launch Galaxy dashboard
  console.log("[5/5] Launching Galaxy dashboard...");
  const graphData = await buildGalaxyData({
    storageDir: STORAGE_DIR,
    newlySyncedSources: [sourceFileName],
  });
  console.log(`     ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`);

  const handle = await startGalaxyServer({
    port: 18180,
    graphData,
    log: (msg) => console.log(`[Galaxy] ${msg}`),
  });

  console.log();
  console.log(`Done! Galaxy dashboard: ${handle.url}`);

  if (shouldOpen) {
    const { exec: execCmd } = await import("node:child_process");
    execCmd(`open ${handle.url}`);
  }

  process.on("SIGINT", () => { handle.close().then(() => process.exit(0)); });
  process.on("SIGTERM", () => { handle.close().then(() => process.exit(0)); });
}

main().catch((err) => { console.error(err); process.exit(1); });
