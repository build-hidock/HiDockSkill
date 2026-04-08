import { describe, expect, it } from "vitest";

import { renameSpeakerInTranscript } from "../src/galaxyServer.js";

describe("renameSpeakerInTranscript", () => {
  const sampleNote = `# Meeting Title

## Summary

Some summary text. Speaker 0 said something important.

## Transcript

[Speaker 0 @0.0]: Hello everyone, welcome to the meeting.
[Speaker 1 @5.2]: Thanks for having me.
[Speaker 0 @8.7]: Let's get started.
[Speaker 2 @12.4]: I have a question.
[Speaker 0 @15.1]: Go ahead.
`;

  it("renames every occurrence of the speaker in the transcript", () => {
    const result = renameSpeakerInTranscript(sampleNote, "Speaker 0", "Sean Song");
    expect(result.replaced).toBe(3);
    expect(result.content).toContain("[Sean Song @0.0]:");
    expect(result.content).toContain("[Sean Song @8.7]:");
    expect(result.content).toContain("[Sean Song @15.1]:");
    // Other speakers untouched
    expect(result.content).toContain("[Speaker 1 @5.2]:");
    expect(result.content).toContain("[Speaker 2 @12.4]:");
  });

  it("preserves the @timestamp suffix on each line", () => {
    const result = renameSpeakerInTranscript(sampleNote, "Speaker 0", "Sean");
    // Each rewritten line keeps its original @<sec>
    expect(result.content).toMatch(/\[Sean @0\.0\]:/);
    expect(result.content).toMatch(/\[Sean @8\.7\]:/);
    expect(result.content).toMatch(/\[Sean @15\.1\]:/);
  });

  it("does not touch the summary section even if the name appears there", () => {
    const result = renameSpeakerInTranscript(sampleNote, "Speaker 0", "Sean Song");
    // The summary line "Speaker 0 said something important." must NOT be rewritten —
    // it's not a `[Speaker 0]:` line and it's not in the transcript section anyway.
    expect(result.content).toContain("Speaker 0 said something important.");
    expect(result.content).not.toContain("Sean Song said something important.");
  });

  it("returns replaced=0 when the from name is not in the transcript", () => {
    const result = renameSpeakerInTranscript(sampleNote, "Nobody", "Sean");
    expect(result.replaced).toBe(0);
    expect(result.content).toBe(sampleNote);
  });

  it("returns replaced=0 when from === to (no-op)", () => {
    const result = renameSpeakerInTranscript(sampleNote, "Speaker 0", "Speaker 0");
    expect(result.replaced).toBe(0);
    expect(result.content).toBe(sampleNote);
  });

  it("returns replaced=0 when from is empty", () => {
    const result = renameSpeakerInTranscript(sampleNote, "", "Sean");
    expect(result.replaced).toBe(0);
  });

  it("returns replaced=0 when to is empty", () => {
    const result = renameSpeakerInTranscript(sampleNote, "Speaker 0", "");
    expect(result.replaced).toBe(0);
  });

  it("handles transcript without ## Transcript section gracefully", () => {
    const noTranscript = `# Title\n\n## Summary\n\nNo transcript here.\n`;
    const result = renameSpeakerInTranscript(noTranscript, "Speaker 0", "Sean");
    expect(result.replaced).toBe(0);
    expect(result.content).toBe(noTranscript);
  });

  it("handles speaker labels without @timestamp", () => {
    const noTime = `# Title\n\n## Transcript\n\n[Speaker 0]: Hello.\n[Speaker 1]: Hi.\n[Speaker 0]: Bye.\n`;
    const result = renameSpeakerInTranscript(noTime, "Speaker 0", "Sean");
    expect(result.replaced).toBe(2);
    expect(result.content).toContain("[Sean]: Hello.");
    expect(result.content).toContain("[Sean]: Bye.");
    expect(result.content).toContain("[Speaker 1]: Hi.");
  });

  it("escapes regex metacharacters in the from name", () => {
    // Names that contain regex specials shouldn't accidentally match other lines
    const note = `# Title\n\n## Transcript\n\n[Speaker (1) @0.0]: Hello.\n[Speaker 1 @5.0]: Hi.\n`;
    const result = renameSpeakerInTranscript(note, "Speaker (1)", "Renamed");
    expect(result.replaced).toBe(1);
    expect(result.content).toContain("[Renamed @0.0]: Hello.");
    expect(result.content).toContain("[Speaker 1 @5.0]: Hi."); // untouched
  });

  it("does not match partial name prefixes", () => {
    // Renaming "Speaker 1" should NOT also match "Speaker 10"
    const note = `# Title\n\n## Transcript\n\n[Speaker 1 @0.0]: Hi.\n[Speaker 10 @5.0]: Hello.\n`;
    const result = renameSpeakerInTranscript(note, "Speaker 1", "One");
    expect(result.replaced).toBe(1);
    expect(result.content).toContain("[One @0.0]: Hi.");
    expect(result.content).toContain("[Speaker 10 @5.0]: Hello."); // untouched
  });

  it("handles a name with spaces and unicode", () => {
    const note = `# Title\n\n## Transcript\n\n[李四 @0.0]: 你好。\n[李四 @3.5]: 再见。\n`;
    const result = renameSpeakerInTranscript(note, "李四", "Li Si");
    expect(result.replaced).toBe(2);
    expect(result.content).toContain("[Li Si @0.0]: 你好。");
    expect(result.content).toContain("[Li Si @3.5]: 再见。");
  });
});
