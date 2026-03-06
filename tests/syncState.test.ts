import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { defaultSyncStatePath, SyncStateStore } from "../src/syncState.js";

describe("SyncStateStore", () => {
  it("uses empty default when file missing and persists completion", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sync-state-"));
    const statePath = defaultSyncStatePath(dir);
    const store = new SyncStateStore(statePath);

    const initial = await store.read();
    expect(initial.lastSuccessfulSyncAt).toBeNull();
    expect(Object.keys(initial.processedFiles)).toHaveLength(0);

    const completedAt = new Date("2026-03-06T00:00:00.000Z");
    await store.markRunCompleted({
      completedAt,
      processed: [{ fileName: "2026Feb06-010203-Rec01.hda", fileSize: 12 } as never],
    });

    const saved = await store.read();
    expect(saved.lastSuccessfulSyncAt).toBe(completedAt.toISOString());
    expect(saved.processedFiles["2026Feb06-010203-Rec01.hda"]?.fileSize).toBe(12);

    const raw = await readFile(statePath, "utf8");
    expect(raw).toContain("lastSuccessfulSyncAt");
  });

  it("marks only unseen or changed-size files as processable", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "sync-state-"));
    const store = new SyncStateStore(defaultSyncStatePath(dir));

    await store.markRunCompleted({
      completedAt: new Date(),
      processed: [{ fileName: "a.hda", fileSize: 100 } as never],
    });

    const state = await store.read();
    expect(store.shouldProcessFile({ fileName: "a.hda", fileSize: 100 } as never, state)).toBe(
      false,
    );
    expect(store.shouldProcessFile({ fileName: "a.hda", fileSize: 120 } as never, state)).toBe(
      true,
    );
    expect(store.shouldProcessFile({ fileName: "b.hda", fileSize: 100 } as never, state)).toBe(
      true,
    );
  });
});
