import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  MeetingStorage,
  TIER_HOT_MAX_AGE_DAYS_ENV,
  TIER_WARM_MAX_AGE_DAYS_ENV,
  formatMonthFolder,
  formatTimestampToken,
  selectStorageTier,
  truncateWords,
} from "../src/meetingStorage.js";

describe("MeetingStorage", () => {
  it("saves meeting note and appends meetingindex with required fields", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hidock-meeting-"));
    const now = new Date(2026, 1, 25, 12, 0, 0);
    const storage = new MeetingStorage({ rootDir: root, now: () => now });
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
    expect(saved.relativeNotePath.startsWith(`meetings/hotmem/${monthFolder}/`)).toBe(true);

    const indexContent = await fs.readFile(path.join(root, "meetingindex.md"), "utf8");
    expect(indexContent).toContain("DateTime:");
    expect(indexContent).toContain("Title:");
    expect(indexContent).toContain("Attendee:");
    expect(indexContent).toContain("Brief:");
    expect(indexContent).toContain("Source: 2026Feb21-091626-Rec23.hda");
    expect(indexContent).toContain(`Note: ${saved.relativeNotePath}`);
  });

  it("saves whisper note with YYYYMMMDD-HHMMSS naming and whisperindex", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hidock-whisper-"));
    const now = new Date(2026, 3, 5, 0, 0, 0);
    const storage = new MeetingStorage({ rootDir: root, now: () => now });
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
    expect(saved.relativeNotePath).toBe(`whispers/warmmem/${expectedToken}.md`);

    const whisperIndex = await fs.readFile(path.join(root, "whisperindex.md"), "utf8");
    expect(whisperIndex).toContain("Brief:");
    expect(whisperIndex).toContain(`Source: 2025Sep22-180847-Whsp12.hda`);
    expect(whisperIndex).toContain(`Note: ${saved.relativeNotePath}`);
  });

  it("supports env-configured tier thresholds for local storage paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hidock-tier-env-"));
    const originalHot = process.env[TIER_HOT_MAX_AGE_DAYS_ENV];
    const originalWarm = process.env[TIER_WARM_MAX_AGE_DAYS_ENV];
    process.env[TIER_HOT_MAX_AGE_DAYS_ENV] = "2";
    process.env[TIER_WARM_MAX_AGE_DAYS_ENV] = "5";

    try {
      const now = new Date(2026, 2, 6, 0, 0, 0);
      const storage = new MeetingStorage({ rootDir: root, now: () => now });

      const warmTimestamp = new Date(2026, 2, 2, 0, 0, 0);
      const warmSaved = await storage.saveMeeting({
        timestamp: warmTimestamp,
        sourceFileName: "2026Mar02-000000-Rec01.hda",
        title: "Warm Tier",
        attendee: "A, B",
        brief: "Warm tier brief",
        summary: "Warm tier summary",
        transcript: "Warm tier transcript",
      });
      expect(warmSaved.relativeNotePath.startsWith("meetings/warmmem/")).toBe(true);

      const coldTimestamp = new Date(2026, 1, 26, 0, 0, 0);
      const coldSaved = await storage.saveWhisper({
        timestamp: coldTimestamp,
        sourceFileName: "2026Feb26-000000-Whsp01.hda",
        title: "Cold Tier",
        attendee: "Unknown",
        brief: "Cold tier brief",
        summary: "Cold tier summary",
        transcript: "Cold tier transcript",
      });
      expect(coldSaved.relativeNotePath.startsWith("whispers/coldmem/")).toBe(true);
    } finally {
      if (typeof originalHot === "string") {
        process.env[TIER_HOT_MAX_AGE_DAYS_ENV] = originalHot;
      } else {
        delete process.env[TIER_HOT_MAX_AGE_DAYS_ENV];
      }
      if (typeof originalWarm === "string") {
        process.env[TIER_WARM_MAX_AGE_DAYS_ENV] = originalWarm;
      } else {
        delete process.env[TIER_WARM_MAX_AGE_DAYS_ENV];
      }
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("limits brief text to 14 words", () => {
    const input =
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen";
    expect(truncateWords(input, 14)).toBe(
      "one two three four five six seven eight nine ten eleven twelve thirteen fourteen",
    );
  });

  it("classifies age into hotmem/warmmem/coldmem tiers", () => {
    expect(selectStorageTier(0)).toBe("hotmem");
    expect(selectStorageTier(30)).toBe("hotmem");
    expect(selectStorageTier(31)).toBe("warmmem");
    expect(selectStorageTier(180)).toBe("warmmem");
    expect(selectStorageTier(181)).toBe("coldmem");
  });
});
