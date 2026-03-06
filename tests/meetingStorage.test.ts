import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MeetingStorage,
  formatMonthFolder,
  formatTimestampToken,
  truncateWords,
} from "../src/meetingStorage.js";

describe("MeetingStorage", () => {
  it("saves meeting note and appends meetingindex with required fields", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hidock-meeting-"));
    const storage = new MeetingStorage({ rootDir: root });
    const timestamp = new Date(2026, 1, 21, 9, 16, 26);

    const saved = await storage.saveMeeting({
      timestamp,
      sourceFileName: "2026Feb21-091626-Rec23.hda",
      title: "Weekly product and engineering sync",
      attendee: "Alice, Bob",
      brief:
        "Discussed launch milestones dependencies risks owners and action items for next sprint planning",
      summary: "Team aligned on launch milestones and owners.",
      transcript: "Long transcript text...",
    });

    expect(saved.skipped).toBe(false);
    const monthFolder = formatMonthFolder(timestamp);
    expect(saved.relativeNotePath.startsWith(`meetings/${monthFolder}/`)).toBe(true);

    const indexContent = await fs.readFile(path.join(root, "meetingindex.md"), "utf8");
    expect(indexContent).toContain("DateTime:");
    expect(indexContent).toContain("Title:");
    expect(indexContent).toContain("Attendee:");
    expect(indexContent).toContain("Brief:");
    expect(indexContent).toContain("Source: 2026Feb21-091626-Rec23.hda");
  });

  it("saves whisper note with YYYYMMMDD-HHMMSS naming and whisperindex", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hidock-whisper-"));
    const storage = new MeetingStorage({ rootDir: root });
    const timestamp = new Date(2026, 1, 21, 18, 8, 47);

    const saved = await storage.saveWhisper({
      timestamp,
      sourceFileName: "2025Sep22-180847-Whsp12.hda",
      title: "Whisper snippet",
      attendee: "Unknown",
      brief: "Condensed whisper summary line for index collection and quick glance references",
      summary: "Short whisper summary.",
      transcript: "Whisper transcript content.",
    });

    const expectedToken = formatTimestampToken(timestamp);
    expect(saved.relativeNotePath).toBe(`whispers/${expectedToken}.md`);

    const whisperIndex = await fs.readFile(path.join(root, "whisperindex.md"), "utf8");
    expect(whisperIndex).toContain("Brief:");
    expect(whisperIndex).toContain(`Source: 2025Sep22-180847-Whsp12.hda`);
  });

  it("limits brief text to 14 words", () => {
    const input =
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen";
    expect(truncateWords(input, 14)).toBe(
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen",
    );
  });
});
