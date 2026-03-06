import { describe, expect, it, vi } from "vitest";

import { SyncCoordinator } from "../src/syncCoordinator.js";

describe("SyncCoordinator", () => {
  it("debounces trigger bursts and prevents overlap", async () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const coordinator = new SyncCoordinator({ debounceMs: 10 });

    coordinator.trigger(async () => {
      calls.push(Date.now());
      await Promise.resolve();
    });
    coordinator.trigger(async () => {
      calls.push(Date.now());
      await Promise.resolve();
    });

    await vi.advanceTimersByTimeAsync(15);
    expect(calls).toHaveLength(1);
    vi.useRealTimers();
  });
});
