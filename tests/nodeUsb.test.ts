import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHiDockConnectionMonitor,
  formatHiDockPluggedInPrompt,
} from "../src/nodeUsb.js";
import { UsbDeviceLike } from "../src/transport.js";

describe("HiDock USB connection monitor", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("polls at the default 5000ms interval", async () => {
    vi.useFakeTimers();
    const findDevice = vi.fn(async () => {
      throw new Error("No HiDock USB device found.");
    });

    const monitor = createHiDockConnectionMonitor({
      findDevice,
      log: vi.fn(),
    });

    monitor.start();
    await flushAsyncWork();
    expect(findDevice).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4999);
    await flushAsyncWork();
    expect(findDevice).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await flushAsyncWork();
    expect(findDevice).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(5000);
    await flushAsyncWork();
    expect(findDevice).toHaveBeenCalledTimes(3);

    monitor.stop();
  });

  it("emits once on startup when already connected by default", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const findDevice = vi.fn(async () => createDevice("P1"));

    const monitor = createHiDockConnectionMonitor({ findDevice, log });
    monitor.start();
    await flushAsyncWork();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("HiDock P1 plugged in, auto sync your latest recordings now...");

    await vi.advanceTimersByTimeAsync(15000);
    await flushAsyncWork();
    expect(log).toHaveBeenCalledTimes(1);

    monitor.stop();
  });

  it("does not emit on startup when emitOnStartupIfConnected is false", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const states: Array<UsbDeviceLike | "disconnect"> = [
      createDevice("P1"),
      createDevice("P1"),
      "disconnect",
      createDevice("P1"),
    ];
    const findDevice = vi.fn(async () => {
      const next = states.shift();
      if (!next || next === "disconnect") {
        throw new Error("No HiDock USB device found.");
      }
      return next;
    });

    const monitor = createHiDockConnectionMonitor({
      findDevice,
      log,
      emitOnStartupIfConnected: false,
    });
    monitor.start();
    await flushAsyncWork();
    expect(log).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(5000);
    await flushAsyncWork();
    expect(log).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(5000);
    await flushAsyncWork();
    expect(log).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(5000);
    await flushAsyncWork();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("HiDock P1 plugged in, auto sync your latest recordings now...");

    monitor.stop();
  });

  it("prints prompt only when state changes from disconnected to connected", async () => {
    vi.useFakeTimers();
    const log = vi.fn();

    const states: Array<UsbDeviceLike | "disconnect"> = [
      "disconnect",
      createDevice("P1"),
      createDevice("P1"),
      "disconnect",
      createDevice("P1"),
    ];
    const findDevice = vi.fn(async () => {
      const next = states.shift();
      if (!next || next === "disconnect") {
        throw new Error("No HiDock USB device found.");
      }
      return next;
    });

    const monitor = createHiDockConnectionMonitor({ findDevice, log });
    monitor.start();
    await flushAsyncWork();

    for (let i = 0; i < 4; i += 1) {
      await vi.advanceTimersByTimeAsync(5000);
      await flushAsyncWork();
    }

    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]?.[0]).toContain("HiDock P1 plugged in, auto sync your latest recordings now...");
    expect(log.mock.calls[1]?.[0]).toContain("HiDock P1 plugged in, auto sync your latest recordings now...");

    monitor.stop();
  });

  it("logs a helpful warning when USB is present but busy", async () => {
    vi.useFakeTimers();
    const log = vi.fn();
    const findDevice = vi.fn(async () => {
      throw new Error("LIBUSB_ERROR_BUSY");
    });

    const monitor = createHiDockConnectionMonitor({ findDevice, log });
    monitor.start();
    await flushAsyncWork();

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain("If HiNotes Web is open, it may be occupying the USB connection.");

    monitor.stop();
  });

  it("formats a popup-style prompt with fallback product name", () => {
    const prompt = formatHiDockPluggedInPrompt("");
    expect(prompt).toContain("HiDock Unknown Device plugged in, auto sync your latest recordings now...");
    expect(prompt).toMatch(/^=+\n\| /);
  });
});

function createDevice(productName: string): UsbDeviceLike {
  return {
    configuration: {},
    productName,
    open: async () => {},
    close: async () => {},
    selectConfiguration: async () => {},
    claimInterface: async () => {},
    releaseInterface: async () => {},
    transferIn: async () => ({ status: "ok", data: null }),
    transferOut: async () => ({ status: "ok", bytesWritten: 0 }),
  } as UsbDeviceLike;
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
