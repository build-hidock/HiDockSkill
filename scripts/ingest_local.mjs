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
  stripThinkTags,
  parseSpeakerMap,
  applySpeakerNames,
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

  const systemPrompt = hasSpeakers
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

  const clipped = speakerTranscript.slice(0, 30000);
  const llmRaw = await streamOllama(host, {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Source filename: ${sourceFileName}\nTranscript:\n${clipped}` },
    ],
  });

  const llmContent = stripThinkTags(llmRaw);
  console.log("     LLM output:");
  console.log("     " + llmContent.split("\n").slice(0, 8).join("\n     "));

  const title = extractLine(llmContent, "TITLE") || `${baseName} Recording`;
  const attendee = extractLine(llmContent, "ATTENDEE") || "Unknown";
  const brief = extractLine(llmContent, "BRIEF") || speakerTranscript.slice(0, 60);
  const summary = extractSummary(llmContent) || llmContent.slice(0, 500);

  // Resolve speaker names
  const speakerMap = hasSpeakers ? parseSpeakerMap(llmContent) : new Map();
  const finalTranscript = speakerMap.size > 0
    ? applySpeakerNames(speakerTranscript, speakerMap)
    : speakerTranscript;

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
    attendee,
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
