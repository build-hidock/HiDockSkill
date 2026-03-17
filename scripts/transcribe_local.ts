#!/usr/bin/env node
/**
 * Standalone transcription script for local WAV files.
 * Runs Moonshine → speaker formatting → Ollama summarization → writes markdown.
 *
 * Usage: node --loader ts-node/esm scripts/transcribe_local.ts <wav_path> [output_dir]
 *        (or build first and run via: node dist/scripts/transcribe_local.js)
 *
 * After `npm run build`, run with:
 *   node scripts/transcribe_local_runner.mjs tests/steve.wav tests/
 */

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import {
  parseMoonshineOutput,
  formatSpeakerTranscript,
} from "../dist/transcribe.js";
import {
  stripThinkTags,
  parseSpeakerMap,
  applySpeakerNames,
} from "../dist/meetingWorkflow.js";

async function main() {
  const wavPath = process.argv[2];
  const outputDir = process.argv[3] ?? "tests";

  if (!wavPath) {
    console.error("Usage: transcribe_local.mjs <wav_path> [output_dir]");
    process.exit(1);
  }

  const baseName = path.basename(wavPath, path.extname(wavPath));

  // Step 1: Convert to 16kHz PCM WAV if needed
  console.log(`[1/4] Converting ${path.basename(wavPath)} to 16kHz PCM WAV...`);
  const tempDir = await fs.mkdtemp(path.join(tmpdir(), "hidock-local-"));
  const pcmPath = path.join(tempDir, "input_16k.wav");

  await execPromise("ffmpeg", [
    "-y", "-i", wavPath,
    "-ar", "16000", "-ac", "1", "-f", "wav",
    pcmPath,
  ]);

  // Step 2: Run Moonshine transcription
  console.log("[2/4] Running Moonshine transcription with speaker diarization...");
  const scriptPath = path.resolve("scripts", "moonshine_transcribe.py");
  const pythonBin = path.resolve(".venv", "bin", "python");
  const rawOutput = await execPromise(pythonBin, [scriptPath, pcmPath, "en"]);

  const parsed = parseMoonshineOutput(rawOutput.trim());
  console.log(
    `     ${parsed.speakerSegments?.length ?? 0} segments, ` +
    `${parsed.speakerCount ?? 0} speakers detected`,
  );

  // Step 3: Format with speaker labels
  const hasSpeakers = parsed.speakerSegments && parsed.speakerSegments.length > 0;
  const speakerTranscript = hasSpeakers
    ? formatSpeakerTranscript(parsed.speakerSegments)
    : parsed.text;

  // Step 4: Summarize with Ollama
  console.log("[3/4] Summarizing with Ollama (qwen3.5:9b)...");
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
      {
        role: "user",
        content: `Source filename: ${path.basename(wavPath)}\nTranscript:\n${clipped}`,
      },
    ],
  });

  const llmContent = stripThinkTags(llmRaw);

  // Parse structured fields
  const title = extractLine(llmContent, "TITLE") || `Transcript — ${baseName}`;
  const attendee = extractLine(llmContent, "ATTENDEE") || "Unknown";
  const brief = extractLine(llmContent, "BRIEF") || "";
  const summary = extractSummary(llmContent) || llmContent.slice(0, 500);

  // Resolve speaker names
  const speakerMap = hasSpeakers ? parseSpeakerMap(llmContent) : new Map();
  const finalTranscript = speakerMap.size > 0
    ? applySpeakerNames(speakerTranscript, speakerMap)
    : speakerTranscript;

  console.log(`     Speaker map: ${speakerMap.size > 0
    ? [...speakerMap.entries()].map(([i, n]) => `Speaker ${i}→${n}`).join(", ")
    : "(none resolved)"}`);

  // Step 5: Write markdown files
  console.log("[4/4] Writing markdown files...");

  const transcriptMd =
    `# Transcript — ${baseName}\n\n` +
    `**Speakers**: ${parsed.speakerCount ?? "unknown"} detected\n` +
    (speakerMap.size > 0
      ? `**Identified**: ${[...speakerMap.entries()].map(([i, n]) => `Speaker ${i} = ${n}`).join(", ")}\n`
      : "") +
    `\n---\n\n` +
    finalTranscript + "\n";

  const summaryMd =
    `# ${title}\n\n` +
    `**Attendees**: ${attendee}\n` +
    `**Brief**: ${brief}\n\n` +
    `## Summary\n\n${summary}\n` +
    (speakerMap.size > 0
      ? `\n## Speaker Map\n\n${[...speakerMap.entries()].map(([i, n]) => `- Speaker ${i} → ${n}`).join("\n")}\n`
      : "");

  const transcriptPath = path.join(outputDir, `${baseName}_transcript.md`);
  const summaryPath = path.join(outputDir, `${baseName}_summary.md`);

  await fs.writeFile(transcriptPath, transcriptMd);
  await fs.writeFile(summaryPath, summaryMd);

  // Cleanup
  await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});

  console.log();
  console.log(`Done! Output:`);
  console.log(`  ${transcriptPath}`);
  console.log(`  ${summaryPath}`);
}

function execPromise(command: string, args: string[]): Promise<string> {
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

async function streamOllama(
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
        const obj = JSON.parse(line) as { message?: { content?: string } };
        if (obj.message?.content) content += obj.message.content;
      } catch {
        // partial JSON line
      }
    }
  }
  return content;
}

function extractLine(content: string, key: string): string {
  const regex = new RegExp(`^${key}:\\s*(.+)$`, "im");
  const match = regex.exec(content);
  return (match?.[1] ?? "").trim();
}

function extractSummary(content: string): string {
  const regex = /^SUMMARY:\s*([\s\S]+)$/im;
  const match = regex.exec(content);
  return (match?.[1] ?? "").trim();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
