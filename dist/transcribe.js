import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectAudioContainer, getAudioProfileByVersion } from "./fileList.js";
export async function transcribeAudio(input) {
    const format = pickAudioFormat(input.audioBytes, input.fileVersion);
    const uploadFileName = normalizeUploadFileName(input.sourceFileName, format.extension);
    const tempDir = await fs.mkdtemp(path.join(tmpdir(), "hidock-"));
    const rawPath = path.join(tempDir, `input.${format.extension}`);
    const wavPath = path.join(tempDir, "input_16k.wav");
    try {
        await fs.writeFile(rawPath, input.audioBytes);
        // Convert to 16kHz mono WAV for Moonshine
        await execPromise("ffmpeg", [
            "-y", "-i", rawPath,
            "-ar", "16000", "-ac", "1", "-f", "wav",
            wavPath,
        ]);
        const scriptName = process.env.ASR_BACKEND === "moonshine"
            ? "moonshine_transcribe.py"
            : "dicow_transcribe.py";
        const scriptPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "scripts", scriptName);
        const venvPython = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", ".venv", "bin", "python3");
        const pythonBin = input.pythonBin
            ?? (await fs.access(venvPython).then(() => venvPython, () => "python3"));
        const args = [scriptPath, wavPath];
        if (input.language) {
            args.push(input.language);
        }
        const rawOutput = await execPromise(pythonBin, args);
        const parsed = parseMoonshineOutput(rawOutput.trim());
        return {
            text: parsed.text,
            model: scriptName === "moonshine_transcribe.py" ? "moonshine" : "dicow",
            uploadFileName,
            mimeType: format.mimeType,
            detectedFormat: format.detectedFormat,
            ...(parsed.speakerSegments ? { speakerSegments: parsed.speakerSegments } : {}),
            ...(parsed.speakerCount !== undefined ? { speakerCount: parsed.speakerCount } : {}),
        };
    }
    finally {
        await fs.rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
}
/** @deprecated Use transcribeAudio */
export async function transcribeWithWhisper(input) {
    return transcribeAudio(input);
}
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
export function parseMoonshineOutput(raw) {
    try {
        const json = JSON.parse(raw);
        if (json.segments && Array.isArray(json.segments)) {
            const segments = json.segments.map((s) => ({
                text: s.text,
                speakerIndex: s.speaker_index,
                hasSpeakerId: s.has_speaker_id,
                startTime: s.start_time,
                duration: s.duration,
            }));
            const speakerIndices = new Set(segments.map((s) => s.speakerIndex));
            return {
                text: json.text ?? segments.map((s) => s.text).join(" "),
                speakerSegments: segments,
                speakerCount: speakerIndices.size,
            };
        }
    }
    catch {
        // Not JSON — fall back to plain text
    }
    return { text: raw };
}
/**
 * Format speaker segments into a labeled transcript.
 * Merges adjacent segments from the same speaker.
 * Includes timestamps as `@seconds` for audio sync.
 * Returns plain text (no labels) if no segments have hasSpeakerId.
 */
export function formatSpeakerTranscript(segments) {
    if (segments.length === 0)
        return "";
    const hasSpeakers = segments.some((s) => s.hasSpeakerId);
    if (!hasSpeakers) {
        return segments.map((s) => s.text).join(" ");
    }
    // Merge adjacent same-speaker segments, keep first startTime
    const merged = [];
    for (const seg of segments) {
        const last = merged[merged.length - 1];
        if (last && last.speakerIndex === seg.speakerIndex) {
            last.texts.push(seg.text);
        }
        else {
            merged.push({ speakerIndex: seg.speakerIndex, startTime: seg.startTime, texts: [seg.text] });
        }
    }
    return merged
        .map((m) => `[Speaker ${m.speakerIndex} @${m.startTime.toFixed(1)}]: ${m.texts.join(" ")}`)
        .join("\n");
}
export function pickAudioFormat(audioBytes, fileVersion) {
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
export function normalizeUploadFileName(sourceFileName, extension) {
    const base = sourceFileName.replace(/\.[^./\\]+$/g, "");
    return `${base}.${extension}`;
}
//# sourceMappingURL=transcribe.js.map