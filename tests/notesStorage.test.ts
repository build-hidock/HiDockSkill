import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  MemdockNotesStorageAdapter,
  parseNotesStorageBackend,
} from "../src/notesStorage.js";
import type { MeetingDocumentInput } from "../src/meetingStorage.js";

const SAMPLE_INPUT: MeetingDocumentInput = {
  timestamp: new Date("2026-03-06T08:00:00.000Z"),
  sourceFileName: "2026Mar06-160000-Rec01.hda",
  title: "Sprint Planning",
  attendee: "Alex, Sam",
  brief: "Reviewed sprint goals and prioritized API work",
  summary: "Team agreed on sprint scope and dependency order.",
  transcript: "We discussed sprint scope and task ownership.",
};

describe("notesStorage memdock adapter", () => {
  it("posts save request using configured endpoint, headers, and API path", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "hinotes-memdock-"));
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          notePath: "/vault/meetings/202603/sprint-planning.md",
          indexPath: "/vault/meetingindex.md",
          relativeNotePath: "meetings/202603/sprint-planning.md",
          skipped: false,
        }),
        { status: 200 },
      );
    });

    try {
      const adapter = new MemdockNotesStorageAdapter({
        rootDir,
        baseUrl: "http://memdock.local:7788",
        apiKey: "secret-token",
        apiPath: "/bridge/notes",
        workspace: "team-a",
        collection: "hinotes",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      const saved = await adapter.saveMeeting(SAMPLE_INPUT);

      expect(saved.notePath).toBe("/vault/meetings/202603/sprint-planning.md");
      expect(saved.indexPath).toBe("/vault/meetingindex.md");
      expect(fetchImpl).toHaveBeenCalledTimes(1);

      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("http://memdock.local:7788/bridge/notes/save");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        "content-type": "application/json",
        authorization: "Bearer secret-token",
        "x-memdock-workspace": "team-a",
        "x-memdock-collection": "hinotes",
      });
      expect(JSON.parse(String(init.body))).toMatchObject({
        kind: "meeting",
        sourceFileName: SAMPLE_INPUT.sourceFileName,
        document: {
          sourceFileName: SAMPLE_INPUT.sourceFileName,
          title: SAMPLE_INPUT.title,
        },
      });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("falls back to local markdown save when memdock save fails", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "hinotes-memdock-"));
    const fetchImpl = vi.fn(async () => {
      throw new Error("memdock unavailable");
    });
    const logs: string[] = [];

    try {
      const adapter = new MemdockNotesStorageAdapter({
        rootDir,
        baseUrl: "http://memdock.local:7788",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        log: (message) => logs.push(message),
      });

      const saved = await adapter.saveMeeting(SAMPLE_INPUT);
      const indexPath = path.join(rootDir, "meetingindex.md");
      const index = await fs.readFile(indexPath, "utf8");

      expect(saved.notePath.startsWith(rootDir)).toBe(true);
      expect(saved.indexPath).toBe(indexPath);
      expect(index).toContain(`Source: ${SAMPLE_INPUT.sourceFileName}`);
      expect(logs.some((line) => line.includes("fallback local"))).toBe(true);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });

  it("falls back to local index lookup when memdock index check fails", async () => {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "hinotes-memdock-"));
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("save down"))
      .mockRejectedValueOnce(new Error("index down"));

    try {
      const adapter = new MemdockNotesStorageAdapter({
        rootDir,
        baseUrl: "http://memdock.local:7788",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });

      await adapter.saveMeeting(SAMPLE_INPUT);
      const indexed = await adapter.isIndexed(SAMPLE_INPUT.sourceFileName, "meeting");

      expect(indexed).toBe(true);
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  });
});

describe("parseNotesStorageBackend", () => {
  it("parses local and memdock values", () => {
    expect(parseNotesStorageBackend(undefined)).toBe("local");
    expect(parseNotesStorageBackend("local")).toBe("local");
    expect(parseNotesStorageBackend("memdock")).toBe("memdock");
  });

  it("rejects invalid values", () => {
    expect(() => parseNotesStorageBackend("remote")).toThrow(
      "Invalid value for storage backend",
    );
  });
});
