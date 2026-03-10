import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildGalaxyData,
  extractField,
  extractKeywords,
  extractTier,
  jaccardSimilarity,
  parseIndexLine,
  toISO8601,
  extractCalendarDate,
} from "../src/galaxyData.js";

// ---------------------------------------------------------------------------
// parseIndexLine
// ---------------------------------------------------------------------------

describe("parseIndexLine", () => {
  it("parses a full meeting index line", () => {
    const line =
      "- DateTime: 2026-02-21 13:28:25 | Title: Recording Test | " +
      "Attendee: Alice, Bob | Brief: Testing recording. | " +
      "Source: 2026Feb21-132825-Rec00.hda | Note: meetings/hotmem/202602/20260221-132825-recording-test.md";
    const entry = parseIndexLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.dateTime).toBe("2026-02-21 13:28:25");
    expect(entry!.title).toBe("Recording Test");
    expect(entry!.attendees).toEqual(["Alice", "Bob"]);
    expect(entry!.brief).toBe("Testing recording.");
    expect(entry!.source).toBe("2026Feb21-132825-Rec00.hda");
    expect(entry!.notePath).toBe("meetings/hotmem/202602/20260221-132825-recording-test.md");
  });

  it("parses a whisper index line (no Title/Attendee)", () => {
    const line =
      "- DateTime: 2026-03-01 09:00:00 | Brief: Quick whisper. | " +
      "Source: 2026Mar01-090000-Whsp01.hda | Note: whispers/hotmem/20260301-090000.md";
    const entry = parseIndexLine(line);
    expect(entry).not.toBeNull();
    expect(entry!.title).toBe("");
    expect(entry!.attendees).toEqual([]);
    expect(entry!.brief).toBe("Quick whisper.");
    expect(entry!.source).toBe("2026Mar01-090000-Whsp01.hda");
  });

  it("strips Unknown from attendees", () => {
    const line =
      "- DateTime: 2026-01-01 10:00:00 | Title: Test | Attendee: Unknown | " +
      "Brief: Brief. | Source: src.hda | Note: meetings/hotmem/202601/test.md";
    const entry = parseIndexLine(line);
    expect(entry!.attendees).toEqual([]);
  });

  it("handles mixed known and unknown attendees", () => {
    const line =
      "- DateTime: 2026-01-01 10:00:00 | Title: Test | Attendee: Alice, Unknown, Bob | " +
      "Brief: Brief. | Source: src.hda | Note: meetings/hotmem/202601/test.md";
    const entry = parseIndexLine(line);
    expect(entry!.attendees).toEqual(["Alice", "Bob"]);
  });

  it("returns null for header lines", () => {
    expect(parseIndexLine("# Meeting Index")).toBeNull();
    expect(parseIndexLine("")).toBeNull();
    expect(parseIndexLine("   ")).toBeNull();
  });

  it("returns null for malformed lines missing DateTime", () => {
    expect(parseIndexLine("- Title: Something | Brief: blah")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// extractField
// ---------------------------------------------------------------------------

describe("extractField", () => {
  it("extracts a mid-line field", () => {
    const line = "- DateTime: 2026-01-01 | Title: Hello | Brief: world";
    expect(extractField(line, "Title")).toBe("Hello");
  });

  it("extracts the last field (no trailing pipe)", () => {
    const line = "- DateTime: 2026-01-01 | Note: meetings/hotmem/file.md";
    expect(extractField(line, "Note")).toBe("meetings/hotmem/file.md");
  });

  it("returns empty string for missing field", () => {
    const line = "- DateTime: 2026-01-01 | Brief: hi";
    expect(extractField(line, "Title")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// extractTier
// ---------------------------------------------------------------------------

describe("extractTier", () => {
  it("detects hotmem", () => {
    expect(extractTier("meetings/hotmem/202602/file.md")).toBe("hotmem");
  });

  it("detects warmmem", () => {
    expect(extractTier("meetings/warmmem/202509/file.md")).toBe("warmmem");
  });

  it("detects coldmem", () => {
    expect(extractTier("meetings/coldmem/202507/file.md")).toBe("coldmem");
  });

  it("defaults to coldmem for unknown path", () => {
    expect(extractTier("meetings/archive/file.md")).toBe("coldmem");
  });
});

// ---------------------------------------------------------------------------
// toISO8601 / extractCalendarDate
// ---------------------------------------------------------------------------

describe("datetime helpers", () => {
  it("converts space-separated datetime to ISO 8601", () => {
    expect(toISO8601("2026-02-21 13:28:25")).toBe("2026-02-21T13:28:25");
  });

  it("extracts calendar date", () => {
    expect(extractCalendarDate("2026-02-21 13:28:25")).toBe("2026-02-21");
  });
});

// ---------------------------------------------------------------------------
// extractKeywords / jaccardSimilarity
// ---------------------------------------------------------------------------

describe("keyword extraction and Jaccard", () => {
  it("extracts lowercase keywords excluding stop words", () => {
    const kw = extractKeywords("The Quick Brown Fox");
    expect(kw.has("quick")).toBe(true);
    expect(kw.has("brown")).toBe(true);
    expect(kw.has("fox")).toBe(true);
    expect(kw.has("the")).toBe(false);
  });

  it("filters single-character tokens", () => {
    const kw = extractKeywords("A B Cat");
    expect(kw.has("a")).toBe(false);
    expect(kw.has("b")).toBe(false);
    expect(kw.has("cat")).toBe(true);
  });

  it("computes Jaccard similarity correctly", () => {
    const a = new Set(["cat", "dog", "fish"]);
    const b = new Set(["cat", "dog", "bird"]);
    // intersection=2, union=4 → 0.5
    expect(jaccardSimilarity(a, b)).toBeCloseTo(0.5);
  });

  it("returns 0 for disjoint sets", () => {
    expect(jaccardSimilarity(new Set(["a"]), new Set(["b"]))).toBe(0);
  });

  it("returns 0 for two empty sets", () => {
    expect(jaccardSimilarity(new Set(), new Set())).toBe(0);
  });

  it("returns 1 for identical sets", () => {
    const s = new Set(["x", "y"]);
    expect(jaccardSimilarity(s, s)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildGalaxyData — integration-level tests using temp dirs
// ---------------------------------------------------------------------------

async function makeTempStorage(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "hidock-galaxy-"));
}

describe("buildGalaxyData", () => {
  it("handles empty index files", async () => {
    const dir = await makeTempStorage();
    const graph = await buildGalaxyData({ storageDir: dir });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.generatedAt).toBeTruthy();
  });

  it("handles missing index files gracefully", async () => {
    const dir = path.join(os.tmpdir(), "hidock-galaxy-nonexistent-" + Date.now());
    const graph = await buildGalaxyData({ storageDir: dir });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
  });

  it("parses a single meeting entry into one node", async () => {
    const dir = await makeTempStorage();
    const indexContent =
      "# Meeting Index\n\n" +
      "- DateTime: 2026-02-21 13:28:25 | Title: Recording Test | " +
      "Attendee: Alice | Brief: Testing. | " +
      "Source: 2026Feb21-132825-Rec00.hda | Note: meetings/hotmem/202602/file.md\n";
    await fs.writeFile(path.join(dir, "meetingindex.md"), indexContent, "utf8");

    const graph = await buildGalaxyData({ storageDir: dir });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].id).toBe("meetings/hotmem/202602/file.md");
    expect(graph.nodes[0].title).toBe("Recording Test");
    expect(graph.nodes[0].attendees).toEqual(["Alice"]);
    expect(graph.nodes[0].tier).toBe("hotmem");
    expect(graph.nodes[0].kind).toBe("meeting");
    expect(graph.nodes[0].dateTime).toBe("2026-02-21T13:28:25");
    expect(graph.nodes[0].notePath).toBe(path.join(dir, "meetings/hotmem/202602/file.md"));
  });

  it("parses whisper entries with kind=whisper", async () => {
    const dir = await makeTempStorage();
    const indexContent =
      "# Whisper Index\n\n" +
      "- DateTime: 2026-03-01 09:00:00 | Brief: Quick note. | " +
      "Source: 2026Mar01-090000-Whsp01.hda | Note: whispers/hotmem/20260301-090000.md\n";
    await fs.writeFile(path.join(dir, "whisperindex.md"), indexContent, "utf8");

    const graph = await buildGalaxyData({ storageDir: dir });
    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].kind).toBe("whisper");
    expect(graph.nodes[0].title).toBe("Whisper");
  });

  it("marks isNew for sources in newlySyncedSources", async () => {
    const dir = await makeTempStorage();
    const indexContent =
      "# Meeting Index\n\n" +
      "- DateTime: 2026-01-01 10:00:00 | Title: A | Attendee: Unknown | " +
      "Brief: Brief. | Source: new-file.hda | Note: meetings/hotmem/202601/a.md\n" +
      "- DateTime: 2026-01-02 10:00:00 | Title: B | Attendee: Unknown | " +
      "Brief: Brief. | Source: old-file.hda | Note: meetings/hotmem/202601/b.md\n";
    await fs.writeFile(path.join(dir, "meetingindex.md"), indexContent, "utf8");

    const graph = await buildGalaxyData({
      storageDir: dir,
      newlySyncedSources: ["new-file.hda"],
    });
    expect(graph.nodes).toHaveLength(2);
    const newNode = graph.nodes.find((n) => n.source === "new-file.hda")!;
    const oldNode = graph.nodes.find((n) => n.source === "old-file.hda")!;
    expect(newNode.isNew).toBe(true);
    expect(oldNode.isNew).toBe(false);
  });

  it("detects shared attendee edges", async () => {
    const dir = await makeTempStorage();
    const indexContent =
      "# Meeting Index\n\n" +
      "- DateTime: 2026-01-01 10:00:00 | Title: A | Attendee: Alice, Bob | " +
      "Brief: First. | Source: s1.hda | Note: meetings/hotmem/202601/a.md\n" +
      "- DateTime: 2026-01-02 10:00:00 | Title: B | Attendee: Alice, Charlie | " +
      "Brief: Second. | Source: s2.hda | Note: meetings/hotmem/202601/b.md\n" +
      "- DateTime: 2026-01-03 10:00:00 | Title: C | Attendee: Dave | " +
      "Brief: Third. | Source: s3.hda | Note: meetings/hotmem/202601/c.md\n";
    await fs.writeFile(path.join(dir, "meetingindex.md"), indexContent, "utf8");

    const graph = await buildGalaxyData({ storageDir: dir });
    const attendeeEdges = graph.edges.filter((e) => e.type === "attendee");
    // Only A and B share Alice
    expect(attendeeEdges).toHaveLength(1);
    expect(attendeeEdges[0].weight).toBe(1); // 1 shared attendee (Alice)
    expect(
      [attendeeEdges[0].source, attendeeEdges[0].target].sort(),
    ).toEqual(["meetings/hotmem/202601/a.md", "meetings/hotmem/202601/b.md"]);
  });

  it("detects same-day edges", async () => {
    const dir = await makeTempStorage();
    const indexContent =
      "# Meeting Index\n\n" +
      "- DateTime: 2026-01-05 09:00:00 | Title: Morning | Attendee: Unknown | " +
      "Brief: Morning mtg. | Source: s1.hda | Note: meetings/hotmem/202601/morning.md\n" +
      "- DateTime: 2026-01-05 14:00:00 | Title: Afternoon | Attendee: Unknown | " +
      "Brief: Afternoon mtg. | Source: s2.hda | Note: meetings/hotmem/202601/afternoon.md\n" +
      "- DateTime: 2026-01-06 09:00:00 | Title: Next Day | Attendee: Unknown | " +
      "Brief: Different day. | Source: s3.hda | Note: meetings/hotmem/202601/nextday.md\n";
    await fs.writeFile(path.join(dir, "meetingindex.md"), indexContent, "utf8");

    const graph = await buildGalaxyData({ storageDir: dir });
    const sameDayEdges = graph.edges.filter((e) => e.type === "sameDay");
    // Only the two Jan-5 entries are same day
    expect(sameDayEdges).toHaveLength(1);
    expect(sameDayEdges[0].weight).toBe(1);
  });

  it("detects topic similarity edges above threshold", async () => {
    const dir = await makeTempStorage();
    // Two entries with very similar titles/briefs, one completely different
    const indexContent =
      "# Meeting Index\n\n" +
      "- DateTime: 2026-01-01 10:00:00 | Title: Bluetooth Microphone Setup | " +
      "Attendee: Unknown | Brief: Discussing bluetooth microphone setup testing. | " +
      "Source: s1.hda | Note: meetings/hotmem/202601/a.md\n" +
      "- DateTime: 2026-01-15 10:00:00 | Title: Bluetooth Microphone Testing | " +
      "Attendee: Unknown | Brief: Testing bluetooth microphone setup recording. | " +
      "Source: s2.hda | Note: meetings/hotmem/202601/b.md\n" +
      "- DateTime: 2026-01-20 10:00:00 | Title: Financial Review | " +
      "Attendee: Unknown | Brief: Quarterly financial targets and loan management. | " +
      "Source: s3.hda | Note: meetings/hotmem/202601/c.md\n";
    await fs.writeFile(path.join(dir, "meetingindex.md"), indexContent, "utf8");

    const graph = await buildGalaxyData({ storageDir: dir });
    const topicEdges = graph.edges.filter((e) => e.type === "topic");
    // The two bluetooth microphone entries should be linked
    expect(topicEdges.length).toBeGreaterThanOrEqual(1);
    const btEdge = topicEdges.find(
      (e) =>
        (e.source.includes("a.md") && e.target.includes("b.md")) ||
        (e.source.includes("b.md") && e.target.includes("a.md")),
    );
    expect(btEdge).toBeDefined();
    expect(btEdge!.weight).toBeGreaterThanOrEqual(0.3);

    // Financial review should NOT be linked to bluetooth entries
    const financialToBluetoothEdge = topicEdges.find(
      (e) =>
        (e.source.includes("c.md") && (e.target.includes("a.md") || e.target.includes("b.md"))) ||
        (e.target.includes("c.md") && (e.source.includes("a.md") || e.source.includes("b.md"))),
    );
    expect(financialToBluetoothEdge).toBeUndefined();
  });

  it("caps topic edges to max 3 per node", async () => {
    const dir = await makeTempStorage();
    // Create 6 nodes all with very similar titles — each pair should exceed
    // the threshold, but each node should have at most 3 topic edges.
    const lines = Array.from({ length: 6 }, (_, i) =>
      `- DateTime: 2026-0${i + 1}-01 10:00:00 | Title: Recording microphone bluetooth test session | ` +
      `Attendee: Unknown | Brief: Testing recording microphone bluetooth device. | ` +
      `Source: s${i}.hda | Note: meetings/hotmem/20260${i + 1}/node${i}.md`,
    ).join("\n");
    const indexContent = `# Meeting Index\n\n${lines}\n`;
    await fs.writeFile(path.join(dir, "meetingindex.md"), indexContent, "utf8");

    const graph = await buildGalaxyData({ storageDir: dir });
    const topicEdges = graph.edges.filter((e) => e.type === "topic");

    // Count edges per node
    const edgeCounts = new Map<string, number>();
    for (const e of topicEdges) {
      edgeCounts.set(e.source, (edgeCounts.get(e.source) ?? 0) + 1);
      edgeCounts.set(e.target, (edgeCounts.get(e.target) ?? 0) + 1);
    }

    for (const count of edgeCounts.values()) {
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  it("combines meeting and whisper entries in one graph", async () => {
    const dir = await makeTempStorage();
    const meetingContent =
      "# Meeting Index\n\n" +
      "- DateTime: 2026-01-01 10:00:00 | Title: Standup | Attendee: Alice | " +
      "Brief: Daily standup. | Source: m1.hda | Note: meetings/hotmem/202601/m.md\n";
    const whisperContent =
      "# Whisper Index\n\n" +
      "- DateTime: 2026-01-01 11:00:00 | Brief: Quick note after standup. | " +
      "Source: w1.hda | Note: whispers/hotmem/20260101-110000.md\n";
    await fs.writeFile(path.join(dir, "meetingindex.md"), meetingContent, "utf8");
    await fs.writeFile(path.join(dir, "whisperindex.md"), whisperContent, "utf8");

    const graph = await buildGalaxyData({ storageDir: dir });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.filter((n) => n.kind === "meeting")).toHaveLength(1);
    expect(graph.nodes.filter((n) => n.kind === "whisper")).toHaveLength(1);

    // Same day edge should exist between them
    const sameDayEdges = graph.edges.filter((e) => e.type === "sameDay");
    expect(sameDayEdges).toHaveLength(1);
  });
});
