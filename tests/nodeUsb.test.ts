import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHiDockConnectionMonitor,
  enumerateHiDockBusDevices,
  formatHiDockPluggedInPrompt,
  selectPreferredHiDock,
} from "../src/nodeUsb.js";
import type { HiDockBusDevice } from "../src/nodeUsb.js";
import { UsbDeviceLike } from "../src/transport.js";

// ---------------------------------------------------------------------------
// Mock the underlying `usb` package's getDeviceList so we can simulate any
// HiDock combination on the bus without needing real hardware.
// ---------------------------------------------------------------------------
vi.mock("usb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("usb")>();
  return {
    ...actual,
    getDeviceList: () => mockedDeviceList,
  };
});

interface MockNativeDevice {
  busNumber: number;
  deviceAddress: number;
  deviceDescriptor: { idVendor: number; idProduct: number };
}

let mockedDeviceList: MockNativeDevice[] = [];

function mkDevice(
  vendorId: number,
  productId: number,
  busNumber = 1,
  deviceAddress = 1,
): MockNativeDevice {
  return {
    busNumber,
    deviceAddress,
    deviceDescriptor: { idVendor: vendorId, idProduct: productId },
  };
}

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

// ---------------------------------------------------------------------------
// Multi-device picker tests — verify that enumeration filters out non-HiDock
// vendors and that selection honors product preference order + env override.
// ---------------------------------------------------------------------------
describe("HiDock multi-device picker", () => {
  afterEach(() => {
    mockedDeviceList = [];
  });

  it("enumerateHiDockBusDevices excludes non-HiDock vendors", () => {
    mockedDeviceList = [
      mkDevice(0x05ac, 0x1234), // Apple
      mkDevice(0x10d6, 0xb00e), // P1
      mkDevice(0x1395, 0x005c), // oddball "HiDock H1E" with wrong vendor
    ];

    const found = enumerateHiDockBusDevices();
    expect(found).toHaveLength(1);
    expect(found[0]?.shortLabel).toBe("P1");
    expect(found[0]?.productId).toBe(0xb00e);
  });

  it("enumerateHiDockBusDevices sorts by preference (P1 before H1E before H1)", () => {
    mockedDeviceList = [
      mkDevice(0x10d6, 0xb00d, 1, 5), // H1E
      mkDevice(0x10d6, 0xb00c, 1, 3), // H1
      mkDevice(0x10d6, 0xb00e, 1, 9), // P1
    ];

    const found = enumerateHiDockBusDevices();
    expect(found.map((d) => d.shortLabel)).toEqual(["P1", "H1E", "H1"]);
  });

  it("enumerateHiDockBusDevices labels unknown product IDs as vendor:product hex", () => {
    mockedDeviceList = [mkDevice(0x10d6, 0xb0ff)];

    const found = enumerateHiDockBusDevices();
    expect(found).toHaveLength(1);
    expect(found[0]?.shortLabel).toBe("0x10d6:0xb0ff");
    expect(found[0]?.preferenceRank).toBe(999);
  });

  it("selectPreferredHiDock returns null when no HiDock devices present", () => {
    mockedDeviceList = [mkDevice(0x05ac, 0x1234)];
    expect(selectPreferredHiDock()).toBeNull();
  });

  it("selectPreferredHiDock prefers P1 when both P1 and H1E are connected", () => {
    mockedDeviceList = [
      mkDevice(0x10d6, 0xb00d), // H1E
      mkDevice(0x10d6, 0xb00e), // P1
    ];

    const picked = selectPreferredHiDock();
    expect(picked?.shortLabel).toBe("P1");
  });

  it("selectPreferredHiDock honors env override (hex)", () => {
    mockedDeviceList = [
      mkDevice(0x10d6, 0xb00d), // H1E
      mkDevice(0x10d6, 0xb00e), // P1
    ];

    const picked = selectPreferredHiDock("0xb00d");
    expect(picked?.shortLabel).toBe("H1E");
  });

  it("selectPreferredHiDock honors env override (decimal)", () => {
    mockedDeviceList = [
      mkDevice(0x10d6, 0xb00d), // H1E
      mkDevice(0x10d6, 0xb00e), // P1
    ];

    const picked = selectPreferredHiDock("45070"); // 0xb00e
    expect(picked?.shortLabel).toBe("P1");
  });

  it("selectPreferredHiDock falls back to preference order when env override doesn't match", () => {
    mockedDeviceList = [
      mkDevice(0x10d6, 0xb00d), // H1E
      mkDevice(0x10d6, 0xb00e), // P1
    ];

    // Override requests a productId that isn't connected
    const picked = selectPreferredHiDock("0xdead");
    expect(picked?.shortLabel).toBe("P1"); // falls back to preference order
  });

  it("selectPreferredHiDock ignores invalid env override strings", () => {
    mockedDeviceList = [mkDevice(0x10d6, 0xb00e)];

    const picked = selectPreferredHiDock("not-a-number");
    expect(picked?.shortLabel).toBe("P1");
  });

  it("HiDockBusDevice type carries the labeled metadata", () => {
    mockedDeviceList = [mkDevice(0x10d6, 0xb00e, 2, 7)];

    const found = enumerateHiDockBusDevices();
    const dev: HiDockBusDevice | undefined = found[0];
    expect(dev?.vendorId).toBe(0x10d6);
    expect(dev?.productId).toBe(0xb00e);
    expect(dev?.busNumber).toBe(2);
    expect(dev?.deviceAddress).toBe(7);
    expect(dev?.preferenceRank).toBe(0);
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
