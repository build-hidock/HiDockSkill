import { describe, expect, it } from "vitest";

import {
  isWhisperRecording,
  parseHiDockRecordingDate,
} from "../src/meetingWorkflow.js";

describe("meeting workflow helpers", () => {
  it("detects whisper files from file name", () => {
    expect(isWhisperRecording("2025Sep22-180847-Whsp12.hda")).toBe(true);
    expect(isWhisperRecording("2026Feb21-091626-Rec23.hda")).toBe(false);
  });

  it("parses month-name timestamp from HiDock filename", () => {
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
