import { describe, expect, it } from "vitest";

import {
  pickAudioFormat,
  normalizeUploadFileName,
  parseMoonshineOutput,
  formatSpeakerTranscript,
  SpeakerSegment,
} from "../src/transcribe.js";
import { stripThinkTags } from "../src/meetingWorkflow.js";

describe("pickAudioFormat", () => {
  it("returns mp3 for unknown bytes without fileVersion", () => {
    const result = pickAudioFormat(new Uint8Array([0, 0, 0, 0]));
    expect(result.extension).toBe("mp3");
    expect(result.mimeType).toBe("audio/mpeg");
  });

  it("returns wav for WAV header bytes", () => {
    // RIFF header
    const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    const result = pickAudioFormat(wav);
    expect(result.extension).toBe("wav");
    expect(result.detectedFormat).toBe("wav");
  });

  it("uses fileVersion when available (version 0x02 = wav)", () => {
    const result = pickAudioFormat(new Uint8Array([0, 0, 0, 0]), 0x02);
    expect(result.extension).toBe("wav");
    expect(result.detectedFormat).toBe("wav");
  });
});

describe("normalizeUploadFileName", () => {
  it("replaces .hda extension with target extension", () => {
    expect(normalizeUploadFileName("2026Feb21-091626-Rec23.hda", "mp3")).toBe(
      "2026Feb21-091626-Rec23.mp3",
    );
  });

  it("replaces .wav extension with target", () => {
    expect(normalizeUploadFileName("file.wav", "mp3")).toBe("file.mp3");
  });

  it("handles filenames without extensions", () => {
    expect(normalizeUploadFileName("noext", "wav")).toBe("noext.wav");
  });
});

describe("stripThinkTags", () => {
  it("removes think tags from text", () => {
    const input = "<think>internal reasoning here</think>TITLE: My Meeting";
    expect(stripThinkTags(input)).toBe("TITLE: My Meeting");
  });

  it("removes multiline think blocks", () => {
    const input =
      "<think>\nLet me analyze this...\nOk done.\n</think>\nTITLE: Test\nSUMMARY: A test.";
    expect(stripThinkTags(input)).toBe("TITLE: Test\nSUMMARY: A test.");
  });

  it("handles multiple think blocks", () => {
    const input = "<think>first</think>Hello <think>second</think>World";
    expect(stripThinkTags(input)).toBe("Hello World");
  });

  it("passes through text without think tags", () => {
    const input = "TITLE: Normal output";
    expect(stripThinkTags(input)).toBe("TITLE: Normal output");
  });

  it("handles empty string", () => {
    expect(stripThinkTags("")).toBe("");
  });
});

describe("parseMoonshineOutput", () => {
  it("parses valid JSON with speaker segments", () => {
    const json = JSON.stringify({
      segments: [
        { text: "Hello", speaker_index: 0, has_speaker_id: true, start_time: 0.0, duration: 1.5 },
        { text: "Hi there", speaker_index: 1, has_speaker_id: true, start_time: 1.5, duration: 2.0 },
      ],
      text: "Hello Hi there",
    });
    const result = parseMoonshineOutput(json);
    expect(result.text).toBe("Hello Hi there");
    expect(result.speakerSegments).toHaveLength(2);
    expect(result.speakerSegments![0]).toEqual({
      text: "Hello",
      speakerIndex: 0,
      hasSpeakerId: true,
      startTime: 0.0,
      duration: 1.5,
    });
    expect(result.speakerCount).toBe(2);
  });

  it("falls back to plain text for non-JSON input", () => {
    const result = parseMoonshineOutput("Hello world this is a transcript");
    expect(result.text).toBe("Hello world this is a transcript");
    expect(result.speakerSegments).toBeUndefined();
    expect(result.speakerCount).toBeUndefined();
  });

  it("falls back to plain text for JSON without segments array", () => {
    const result = parseMoonshineOutput(JSON.stringify({ foo: "bar" }));
    expect(result.text).toBe(JSON.stringify({ foo: "bar" }));
    expect(result.speakerSegments).toBeUndefined();
  });

  it("joins segment text when top-level text is missing", () => {
    const json = JSON.stringify({
      segments: [
        { text: "A", speaker_index: 0, has_speaker_id: true, start_time: 0, duration: 1 },
        { text: "B", speaker_index: 0, has_speaker_id: true, start_time: 1, duration: 1 },
      ],
    });
    const result = parseMoonshineOutput(json);
    expect(result.text).toBe("A B");
  });
});

describe("formatSpeakerTranscript", () => {
  it("formats segments with speaker labels and timestamps", () => {
    const segments: SpeakerSegment[] = [
      { text: "Hello", speakerIndex: 0, hasSpeakerId: true, startTime: 0, duration: 1 },
      { text: "Hi", speakerIndex: 1, hasSpeakerId: true, startTime: 1, duration: 1 },
      { text: "How are you?", speakerIndex: 0, hasSpeakerId: true, startTime: 2, duration: 1 },
    ];
    expect(formatSpeakerTranscript(segments)).toBe(
      "[Speaker 0 @0.0]: Hello\n[Speaker 1 @1.0]: Hi\n[Speaker 0 @2.0]: How are you?",
    );
  });

  it("merges adjacent same-speaker segments with first timestamp", () => {
    const segments: SpeakerSegment[] = [
      { text: "First", speakerIndex: 0, hasSpeakerId: true, startTime: 0, duration: 1 },
      { text: "second", speakerIndex: 0, hasSpeakerId: true, startTime: 1, duration: 1 },
      { text: "third", speakerIndex: 1, hasSpeakerId: true, startTime: 2, duration: 1 },
    ];
    expect(formatSpeakerTranscript(segments)).toBe(
      "[Speaker 0 @0.0]: First second\n[Speaker 1 @2.0]: third",
    );
  });

  it("returns plain text when no segments have hasSpeakerId", () => {
    const segments: SpeakerSegment[] = [
      { text: "Hello", speakerIndex: 0, hasSpeakerId: false, startTime: 0, duration: 1 },
      { text: "world", speakerIndex: 0, hasSpeakerId: false, startTime: 1, duration: 1 },
    ];
    expect(formatSpeakerTranscript(segments)).toBe("Hello world");
  });

  it("returns empty string for empty segments", () => {
    expect(formatSpeakerTranscript([])).toBe("");
  });
});
