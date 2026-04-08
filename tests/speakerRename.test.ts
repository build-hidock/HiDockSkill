import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  buildSpeakerRegex,
  renameSpeakerInNoteContent,
  renameSpeakerInIndexContent,
  renameSpeakerInWikiDir,
} from "../src/speakerRename.js";

// ---------------------------------------------------------------------------
// buildSpeakerRegex — word-boundary regex with metachar escaping
// ---------------------------------------------------------------------------

describe("buildSpeakerRegex", () => {
  it("matches whole-token occurrences", () => {
    const re = buildSpeakerRegex("Speaker 1");
    expect("Speaker 1 said hi".match(re)).toEqual(["Speaker 1"]);
    expect("hello Speaker 1.".match(re)).toEqual(["Speaker 1"]);
    expect("(Speaker 1)".match(re)).toEqual(["Speaker 1"]);
  });

  it("does NOT match partial-prefix `Speaker 10`", () => {
    const re = buildSpeakerRegex("Speaker 1");
    expect("Speaker 10 said hi".match(re)).toBeNull();
    expect("Speaker 100".match(re)).toBeNull();
  });

  it("does NOT match `Speaker 1` inside another word", () => {
    const re = buildSpeakerRegex("Speaker 1");
    expect("MySpeaker 1".match(re)).toBeNull();
  });

  it("escapes regex metacharacters in the from name", () => {
    const re = buildSpeakerRegex("Speaker (1)");
    expect("Speaker (1) said hi".match(re)).toEqual(["Speaker (1)"]);
    expect("Speaker (10)".match(re)).toBeNull();
  });

  it("matches unicode names", () => {
    const re = buildSpeakerRegex("李四");
    expect("李四 说话".match(re)).toEqual(["李四"]);
  });
});

// ---------------------------------------------------------------------------
// renameSpeakerInNoteContent — Transcript + Summary sections
// ---------------------------------------------------------------------------

describe("renameSpeakerInNoteContent", () => {
  const sampleNote = `# Meeting Title

- DateTime: 2026-04-08 10:00:00
- Attendee: Alice, Bob, Speaker 0

## Summary

## About Meeting
- **Attendees:**
  - Speaker 0 (Engineering rep)
  - Speaker 1 (Industry rep)

Speaker 0 contrasted this with another approach. Speaker 0 suggested a follow-up.

## Transcript

[Speaker 0 @0.0]: Hello everyone.
[Speaker 1 @5.2]: Thanks for having me.
[Speaker 0 @8.7]: Let's get started.
`;

  it("rewrites BOTH transcript lines AND summary mentions", () => {
    const result = renameSpeakerInNoteContent(sampleNote, "Speaker 0", "Sean Song");
    // 2 transcript lines + 1 attendee bullet + 2 summary sentence mentions = 5
    expect(result.replaced).toBe(5);
    expect(result.content).toContain("[Sean Song @0.0]: Hello everyone.");
    expect(result.content).toContain("[Sean Song @8.7]: Let's get started.");
    expect(result.content).toContain("- Sean Song (Engineering rep)");
    expect(result.content).toContain("Sean Song contrasted this with another approach.");
    expect(result.content).toContain("Sean Song suggested a follow-up.");
  });

  it("preserves @timestamp suffix on each transcript line", () => {
    const result = renameSpeakerInNoteContent(sampleNote, "Speaker 0", "Sean");
    expect(result.content).toMatch(/\[Sean @0\.0\]:/);
    expect(result.content).toMatch(/\[Sean @8\.7\]:/);
  });

  it("does NOT touch the frontmatter Attendee line (different layer)", () => {
    const result = renameSpeakerInNoteContent(sampleNote, "Speaker 0", "Sean Song");
    // The `- Attendee: ... Speaker 0` frontmatter line is OUTSIDE both
    // ## Summary and ## Transcript sections, so it should be left alone.
    expect(result.content).toContain("- Attendee: Alice, Bob, Speaker 0");
  });

  it("does NOT touch other speakers in the transcript", () => {
    const result = renameSpeakerInNoteContent(sampleNote, "Speaker 0", "Sean");
    expect(result.content).toContain("[Speaker 1 @5.2]: Thanks for having me.");
    expect(result.content).toContain("- Speaker 1 (Industry rep)");
  });

  it("returns replaced=0 and unchanged content when from is missing", () => {
    const result = renameSpeakerInNoteContent(sampleNote, "Nobody", "X");
    expect(result.replaced).toBe(0);
    expect(result.content).toBe(sampleNote);
  });

  it("returns replaced=0 when from===to", () => {
    const result = renameSpeakerInNoteContent(sampleNote, "Speaker 0", "Speaker 0");
    expect(result.replaced).toBe(0);
    expect(result.content).toBe(sampleNote);
  });

  it("does not match Speaker 1 inside Speaker 10 in transcript", () => {
    const note = `# T\n\n## Transcript\n\n[Speaker 1 @0.0]: Hi.\n[Speaker 10 @5.0]: Hello.\n`;
    const result = renameSpeakerInNoteContent(note, "Speaker 1", "One");
    expect(result.replaced).toBe(1);
    expect(result.content).toContain("[One @0.0]: Hi.");
    expect(result.content).toContain("[Speaker 10 @5.0]: Hello.");
  });

  it("is idempotent — running twice yields the same content as running once", () => {
    const first = renameSpeakerInNoteContent(sampleNote, "Speaker 0", "Sean Song");
    const second = renameSpeakerInNoteContent(first.content, "Speaker 0", "Sean Song");
    expect(second.replaced).toBe(0);
    expect(second.content).toBe(first.content);
  });

  it("handles transcript labels without @timestamp", () => {
    const note = `# T\n\n## Transcript\n\n[Speaker 0]: Hello.\n[Speaker 1]: Hi.\n[Speaker 0]: Bye.\n`;
    const result = renameSpeakerInNoteContent(note, "Speaker 0", "Sean");
    expect(result.replaced).toBe(2);
    expect(result.content).toContain("[Sean]: Hello.");
    expect(result.content).toContain("[Sean]: Bye.");
    expect(result.content).toContain("[Speaker 1]: Hi.");
  });

  it("handles a note with no ## Transcript section gracefully", () => {
    const noTranscript = `# T\n\n## Summary\n\nSpeaker 0 spoke briefly.\n`;
    const result = renameSpeakerInNoteContent(noTranscript, "Speaker 0", "Sean");
    // Summary still gets the rewrite even when transcript section is absent
    expect(result.replaced).toBe(1);
    expect(result.content).toContain("Sean spoke briefly.");
  });
});

// ---------------------------------------------------------------------------
// renameSpeakerInIndexContent — meetingindex.md row rewrites
// ---------------------------------------------------------------------------

describe("renameSpeakerInIndexContent", () => {
  const sampleIndex = `# Meeting Index
- DateTime: 2026-04-08 10:00:00 | Title: Strategy Review | Attendee: Speaker 0, Speaker 1 | Brief: [Speaker 0 @0.0]: Welcome | Source: 2026Apr08-100000-Rec99.hda | Note: meetings/hotmem/202604/foo.md
- DateTime: 2026-04-07 09:00:00 | Title: Different Meeting | Attendee: Speaker 0 | Brief: Speaker 0 spoke about goals | Source: 2026Apr07-090000-Rec98.hda | Note: meetings/hotmem/202604/bar.md
`;

  it("rewrites ALL fields on the matching row only", () => {
    const result = renameSpeakerInIndexContent(sampleIndex, "2026Apr08-100000-Rec99.hda", "Speaker 0", "Sean");
    // Speaker 0 appears twice in row 1 (Attendee + Brief), once in row 2.
    // We should only update row 1 → 2 replacements.
    expect(result.replaced).toBe(2);
    expect(result.content).toContain("Attendee: Sean, Speaker 1");
    expect(result.content).toContain("Brief: [Sean @0.0]: Welcome");
    // Row 2 untouched
    expect(result.content).toContain("Attendee: Speaker 0 | Brief: Speaker 0 spoke about goals");
  });

  it("returns unchanged content when from is absent in the matching row", () => {
    const result = renameSpeakerInIndexContent(sampleIndex, "2026Apr08-100000-Rec99.hda", "Speaker 99", "Nobody");
    expect(result.replaced).toBe(0);
    expect(result.content).toBe(sampleIndex);
  });

  it("returns unchanged content when source does not match any row", () => {
    const result = renameSpeakerInIndexContent(sampleIndex, "fake-source.hda", "Speaker 0", "X");
    expect(result.replaced).toBe(0);
    expect(result.content).toBe(sampleIndex);
  });

  it("is idempotent", () => {
    const first = renameSpeakerInIndexContent(sampleIndex, "2026Apr08-100000-Rec99.hda", "Speaker 0", "Sean");
    const second = renameSpeakerInIndexContent(first.content, "2026Apr08-100000-Rec99.hda", "Speaker 0", "Sean");
    expect(second.replaced).toBe(0);
    expect(second.content).toBe(first.content);
  });
});

// ---------------------------------------------------------------------------
// renameSpeakerInWikiDir — file rename, merge, and walk
// ---------------------------------------------------------------------------

describe("renameSpeakerInWikiDir", () => {
  let wikiDir: string;

  beforeEach(async () => {
    wikiDir = await fs.mkdtemp(path.join(os.tmpdir(), "speaker-rename-test-"));
    for (const sub of ["people", "projects", "topics", "decisions", "actions"]) {
      await fs.mkdir(path.join(wikiDir, sub), { recursive: true });
    }
  });

  afterEach(async () => {
    await fs.rm(wikiDir, { recursive: true, force: true }).catch(() => {});
  });

  async function writeFile(rel: string, content: string): Promise<void> {
    const full = path.join(wikiDir, rel);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf8");
  }

  async function readFile(rel: string): Promise<string> {
    return fs.readFile(path.join(wikiDir, rel), "utf8");
  }

  async function fileExists(rel: string): Promise<boolean> {
    try { await fs.access(path.join(wikiDir, rel)); return true; } catch { return false; }
  }

  it("renames the people page when destination does not exist", async () => {
    await writeFile("people/speaker-2.md", `# Speaker 2

- Role: Industry rep, AMP
- Last seen: 2026-04-05

## Key Facts
- Speaker 2 spoke about open models
`);

    const result = await renameSpeakerInWikiDir(wikiDir, "Speaker 2", "Sean Song");

    expect(result.peopleRenamed).toBe(1);
    expect(result.peopleMerged).toBe(0);
    expect(await fileExists("people/speaker-2.md")).toBe(false);
    expect(await fileExists("people/sean-song.md")).toBe(true);

    const renamed = await readFile("people/sean-song.md");
    expect(renamed).toContain("# Sean Song");
    expect(renamed).toContain("Sean Song spoke about open models");
    expect(renamed).not.toContain("Speaker 2");
  });

  it("MERGES the people page when destination already exists", async () => {
    await writeFile("people/speaker-2.md", `# Speaker 2

- Role: Industry rep
- Last seen: 2026-04-05

## Key Facts
- Spoke at panel
`);
    await writeFile("people/sean-song.md", `# Sean Song

- Role: Engineer
- Last seen: 2026-03-01

## Key Facts
- Built HiDockSkill
`);

    const result = await renameSpeakerInWikiDir(wikiDir, "Speaker 2", "Sean Song");

    expect(result.peopleMerged).toBe(1);
    expect(result.peopleRenamed).toBe(0);
    expect(await fileExists("people/speaker-2.md")).toBe(false);

    const merged = await readFile("people/sean-song.md");
    expect(merged).toContain("# Sean Song");          // original heading preserved
    expect(merged).toContain("Built HiDockSkill");    // original content preserved
    expect(merged).toContain('## Merged from "Speaker 2"');  // merge marker
    expect(merged).toContain("Spoke at panel");       // merged content present
    expect(merged).not.toContain("# Speaker 2");      // source heading dropped during merge
  });

  it("walks projects/decisions/topics and rewrites inline mentions", async () => {
    await writeFile("projects/openclaw.md", `# OpenClaw

## Updates
- 2026-04-05: Speaker 2 contrasts this with another approach.
- 2026-04-06: Speaker 2 will follow up next week.
`);
    await writeFile("decisions/decisions-2026-04.md", `# April 2026 Decisions

- Speaker 2 to lead the Q2 review.
`);
    await writeFile("topics/open-models.md", `# Open Models

- Speaker 2 raised concerns about licensing.
`);

    const result = await renameSpeakerInWikiDir(wikiDir, "Speaker 2", "Sean Song");

    expect(result.filesUpdated).toBe(3);
    expect(result.replacements).toBe(4); // 2 + 1 + 1
    expect(await readFile("projects/openclaw.md")).toContain("Sean Song contrasts");
    expect(await readFile("projects/openclaw.md")).toContain("Sean Song will follow up");
    expect(await readFile("decisions/decisions-2026-04.md")).toContain("Sean Song to lead");
    expect(await readFile("topics/open-models.md")).toContain("Sean Song raised concerns");
  });

  it("does NOT match Speaker 1 inside Speaker 10 anywhere in the wiki", async () => {
    await writeFile("projects/example.md", `# Example

- Speaker 1 spoke first.
- Speaker 10 spoke last.
`);

    const result = await renameSpeakerInWikiDir(wikiDir, "Speaker 1", "Alice");
    expect(result.filesUpdated).toBe(1);
    expect(result.replacements).toBe(1);
    const updated = await readFile("projects/example.md");
    expect(updated).toContain("Alice spoke first");
    expect(updated).toContain("Speaker 10 spoke last"); // unchanged
  });

  it("returns zero counts and no changes when from name is absent everywhere", async () => {
    await writeFile("projects/openclaw.md", `# OpenClaw\n\n- Alice spoke.\n`);

    const result = await renameSpeakerInWikiDir(wikiDir, "Speaker 99", "Bob");
    expect(result.peopleRenamed).toBe(0);
    expect(result.peopleMerged).toBe(0);
    expect(result.filesUpdated).toBe(0);
    expect(result.replacements).toBe(0);
    expect(await readFile("projects/openclaw.md")).toBe(`# OpenClaw\n\n- Alice spoke.\n`);
  });

  it("is idempotent — running twice in a row matches a single run", async () => {
    await writeFile("people/speaker-3.md", `# Speaker 3\n\n- Role: Researcher\n`);
    await writeFile("projects/p.md", `# P\n\n- Speaker 3 wrote the doc.\n`);

    const first = await renameSpeakerInWikiDir(wikiDir, "Speaker 3", "Madeline");
    const second = await renameSpeakerInWikiDir(wikiDir, "Speaker 3", "Madeline");

    expect(second.peopleRenamed).toBe(0);
    expect(second.filesUpdated).toBe(0);
    expect(second.replacements).toBe(0);
    expect(first.peopleRenamed).toBe(1);

    expect(await fileExists("people/madeline.md")).toBe(true);
    expect(await fileExists("people/speaker-3.md")).toBe(false);
    expect(await readFile("projects/p.md")).toContain("Madeline wrote the doc");
  });

  it("handles the case where the people page does not exist (only inline mentions)", async () => {
    await writeFile("projects/openclaw.md", `# OpenClaw\n\n- Speaker 4 raised an issue.\n`);

    const result = await renameSpeakerInWikiDir(wikiDir, "Speaker 4", "Eve");

    expect(result.peopleRenamed).toBe(0);
    expect(result.peopleMerged).toBe(0);
    expect(result.filesUpdated).toBe(1);
    expect(result.replacements).toBe(1);
    expect(await readFile("projects/openclaw.md")).toContain("Eve raised an issue");
  });

  it("handles unicode names in file content", async () => {
    await writeFile("people/speaker-5.md", `# Speaker 5\n\n- Role: Engineer\n`);
    await writeFile("projects/p.md", `# P\n\n- Speaker 5 said hello.\n`);

    const result = await renameSpeakerInWikiDir(wikiDir, "Speaker 5", "李四");

    expect(result.peopleRenamed).toBe(1);
    // slugify keeps CJK characters per the existing wikiCompiler.slugify regex
    expect(await fileExists("people/李四.md")).toBe(true);
    expect(await readFile("projects/p.md")).toContain("李四 said hello");
  });

  it("returns zero counts when from===to (no-op)", async () => {
    await writeFile("people/speaker-6.md", `# Speaker 6\n`);
    const result = await renameSpeakerInWikiDir(wikiDir, "Speaker 6", "Speaker 6");
    expect(result).toEqual({
      filesUpdated: 0,
      peopleRenamed: 0,
      peopleMerged: 0,
      replacements: 0,
    });
    // File should still exist
    expect(await fileExists("people/speaker-6.md")).toBe(true);
  });
});
