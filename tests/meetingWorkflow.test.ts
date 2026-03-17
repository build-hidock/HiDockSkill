import { describe, expect, it } from "vitest";

import {
  isWhisperRecording,
  parseHiDockRecordingDate,
  parseSpeakerMap,
  applySpeakerNames,
} from "../src/meetingWorkflow.js";

describe("meeting workflow helpers", () => {
  it("detects whisper files from file name", () => {
    expect(isWhisperRecording("20250922-180847-Whsp12.hda")).toBe(true);
    expect(isWhisperRecording("20260221-091626-Rec23.hda")).toBe(false);
  });

  it("parses legacy month-name timestamp from HiDock filename", () => {
    const parsed = parseHiDockRecordingDate("2026Feb21-091626-Rec23.hda");
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(1);
    expect(parsed?.getDate()).toBe(21);
    expect(parsed?.getHours()).toBe(9);
    expect(parsed?.getMinutes()).toBe(16);
    expect(parsed?.getSeconds()).toBe(26);
  });

  it("parses numeric timestamp fallback format", () => {
    const parsed = parseHiDockRecordingDate("20260221-091626-Rec23.hda");
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(1);
    expect(parsed?.getDate()).toBe(21);
  });
});

describe("parseSpeakerMap", () => {
  it("parses a standard SPEAKER_MAP line", () => {
    const content =
      "TITLE: Test\nSPEAKER_MAP: Speaker 0=Alice, Speaker 1=Bob\nSUMMARY: A test.";
    const map = parseSpeakerMap(content);
    expect(map.size).toBe(2);
    expect(map.get(0)).toBe("Alice");
    expect(map.get(1)).toBe("Bob");
  });

  it("handles single speaker in map", () => {
    const content = "SPEAKER_MAP: Speaker 0=Charlie";
    const map = parseSpeakerMap(content);
    expect(map.size).toBe(1);
    expect(map.get(0)).toBe("Charlie");
  });

  it("returns empty map when no SPEAKER_MAP line", () => {
    const content = "TITLE: Test\nSUMMARY: No speakers.";
    const map = parseSpeakerMap(content);
    expect(map.size).toBe(0);
  });

  it("handles extra whitespace in pairs", () => {
    const content = "SPEAKER_MAP:  Speaker 0 = Alice ,  Speaker 1 = Bob ";
    const map = parseSpeakerMap(content);
    expect(map.get(0)).toBe("Alice");
    expect(map.get(1)).toBe("Bob");
  });
});

describe("applySpeakerNames", () => {
  it("replaces speaker labels with real names (with timestamps)", () => {
    const transcript =
      "[Speaker 0 @0.0]: Hello everyone\n[Speaker 1 @2.5]: Hi Alice\n[Speaker 0 @5.0]: Let's begin";
    const map = new Map<number, string>([
      [0, "Alice"],
      [1, "Bob"],
    ]);
    const result = applySpeakerNames(transcript, map);
    expect(result).toBe(
      "[Alice @0.0]: Hello everyone\n[Bob @2.5]: Hi Alice\n[Alice @5.0]: Let's begin",
    );
  });

  it("replaces speaker labels without timestamps", () => {
    const transcript = "[Speaker 0]: Hello\n[Speaker 1]: Hi";
    const map = new Map<number, string>([
      [0, "Alice"],
      [1, "Bob"],
    ]);
    const result = applySpeakerNames(transcript, map);
    expect(result).toBe("[Alice]: Hello\n[Bob]: Hi");
  });

  it("leaves unresolved speakers untouched", () => {
    const transcript = "[Speaker 0 @1.0]: Hello\n[Speaker 1 @3.0]: Hi\n[Speaker 2 @5.0]: Hey";
    const map = new Map<number, string>([[0, "Alice"]]);
    const result = applySpeakerNames(transcript, map);
    expect(result).toBe("[Alice @1.0]: Hello\n[Speaker 1 @3.0]: Hi\n[Speaker 2 @5.0]: Hey");
  });

  it("handles empty map", () => {
    const transcript = "[Speaker 0 @0.0]: Hello";
    const result = applySpeakerNames(transcript, new Map());
    expect(result).toBe("[Speaker 0 @0.0]: Hello");
  });
});
