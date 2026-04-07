import { execFileSync } from "node:child_process";
import { platform } from "node:os";

import { WebUSB, getDeviceList, findByIds } from "usb";

import { HiDockClient } from "./client.js";
import { HiDockTransportOptions, UsbDeviceLike } from "./transport.js";

export interface HiDockUsbFilter {
  vendorId: number;
  productId?: number;
}

/**
 * One HiDock device discovered by enumerating the live USB bus via the
 * underlying libusb-based `usb` package. Used by the multi-device picker
 * to pick a specific device when several HiDocks are plugged in.
 */
export interface HiDockBusDevice {
  vendorId: number;
  productId: number;
  /** Stable per-USB-port identifier on the host bus. */
  busNumber: number;
  deviceAddress: number;
  /** Human-readable label like "P1" / "H1E" / "H1" / "0x10d6:0xb00e". */
  shortLabel: string;
  /** Index of preference (lower = preferred). */
  preferenceRank: number;
}

/**
 * Preferred device order when multiple HiDock devices are connected.
 * P1 has the most recordings and is the user's primary device, so it's
 * picked first. H1E and H1 fall through afterwards.
 */
const PRODUCT_PREFERENCE: ReadonlyArray<{ productId: number; label: string }> = [
  { productId: 0xb00e, label: "P1" },
  { productId: 0xb00d, label: "H1E" },
  { productId: 0xb00c, label: "H1" },
];

const HIDOCK_VENDOR_ID = 0x10d6;

export interface NodeUsbDiscoveryOptions {
  filters?: readonly HiDockUsbFilter[];
}

export interface HiDockPlugInEvent {
  productName: string;
  prompt: string;
  device: UsbDeviceLike;
}

export interface HiDockConnectionMonitorOptions {
  intervalMs?: number;
  emitOnStartupIfConnected?: boolean;
  discoveryOptions?: NodeUsbDiscoveryOptions;
  findDevice?: (
    options?: NodeUsbDiscoveryOptions,
  ) => Promise<UsbDeviceLike>;
  formatPrompt?: (productName: string) => string;
  onPluggedIn?: (event: HiDockPlugInEvent) => void;
  onUnplugged?: () => void;
  log?: (message: string) => void;
}

export interface HiDockConnectionMonitor {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  pollNow(): Promise<void>;
}

// Product IDs verified against live ioreg readout 2026-04-07:
//   P1:  productId 0xb00e (45070), serial "ACTIONS-BOS-002"
//   H1E: productId 0xb00d (45069), serial "ACTIONS-BOS-001"
//   H1:  productId 0xb00c (legacy data interface)
// Prior code had labels swapped (0xb00d commented as "P1") which caused the
// watcher to silently sync from the H1E instead of the P1 when both were on the bus.
// Filter order matters: requestDevice() returns the first match per filter, so the
// most specific / preferred device must come first.
const DEFAULT_NODE_FILTERS: readonly HiDockUsbFilter[] = [
  { vendorId: 0x10d6, productId: 0xb00e }, // HiDock P1   (preferred)
  { vendorId: 0x10d6, productId: 0xb00d }, // HiDock H1E
  { vendorId: 0x10d6, productId: 0xb00c }, // HiDock H1   (legacy data interface)
  { vendorId: 0x10d6 },                   // fallback for future product IDs
];
const DEFAULT_MONITOR_INTERVAL_MS = 5000;

export function createNodeWebUsb(preferredProductId?: number): WebUSB {
  return new WebUSB({
    allowAllDevices: true,
    // When multiple HiDock devices are present, pick the one matching
    // `preferredProductId` first; otherwise fall back to first match.
    devicesFound: (devices) => {
      if (preferredProductId !== undefined) {
        const match = devices.find((d) => d.productId === preferredProductId);
        if (match) return match;
      }
      return devices[0];
    },
  });
}

/**
 * Enumerate every HiDock device currently on the USB bus using the underlying
 * libusb-based `usb` package. Unlike `webusb.getDevices()`, this never caches
 * stale handles — every call reflects the current bus state. Returns devices
 * in preference order (P1 → H1E → H1 → unknown).
 */
export function enumerateHiDockBusDevices(): HiDockBusDevice[] {
  let nativeDevices: ReturnType<typeof getDeviceList>;
  try {
    nativeDevices = getDeviceList();
  } catch {
    return [];
  }

  const found: HiDockBusDevice[] = [];
  for (const native of nativeDevices) {
    const desc = native.deviceDescriptor;
    if (!desc || desc.idVendor !== HIDOCK_VENDOR_ID) continue;
    const productId = desc.idProduct;

    const prefIndex = PRODUCT_PREFERENCE.findIndex((p) => p.productId === productId);
    const label =
      prefIndex >= 0
        ? (PRODUCT_PREFERENCE[prefIndex]?.label ?? "?")
        : `0x${HIDOCK_VENDOR_ID.toString(16)}:0x${productId.toString(16)}`;

    found.push({
      vendorId: HIDOCK_VENDOR_ID,
      productId,
      busNumber: native.busNumber,
      deviceAddress: native.deviceAddress,
      shortLabel: label,
      // Unknown product IDs go to the end via large rank.
      preferenceRank: prefIndex >= 0 ? prefIndex : 999,
    });
  }

  // Sort by preference (P1 first), then by busNumber/deviceAddress for determinism.
  found.sort((a, b) => {
    if (a.preferenceRank !== b.preferenceRank) return a.preferenceRank - b.preferenceRank;
    if (a.busNumber !== b.busNumber) return a.busNumber - b.busNumber;
    return a.deviceAddress - b.deviceAddress;
  });

  return found;
}

/**
 * Pick the best HiDock device on the bus. Honors `HIDOCK_PREFERRED_PRODUCT_ID`
 * env var (decimal or hex with 0x prefix) when set; otherwise returns the
 * first device in `enumerateHiDockBusDevices()` preference order.
 */
export function selectPreferredHiDock(
  envOverride?: string,
): HiDockBusDevice | null {
  const all = enumerateHiDockBusDevices();
  if (all.length === 0) return null;

  if (envOverride) {
    const trimmed = envOverride.trim();
    const requested = /^0x/i.test(trimmed)
      ? Number.parseInt(trimmed.slice(2), 16)
      : Number.parseInt(trimmed, 10);
    if (Number.isInteger(requested)) {
      const match = all.find((d) => d.productId === requested);
      if (match) return match;
    }
  }

  return all[0] ?? null;
}

/**
 * Force a libusb-level device reset before claiming. The HiDock H1E in
 * particular gets into a state where webusb.open() hangs forever after
 * a stalled USB transfer (observed in production 2026-04-07 after the
 * morning sync's "Incomplete transfer" error left the device wedged).
 * A low-level reset clears the kernel/driver state in ~100ms, after
 * which webusb.open() succeeds normally.
 *
 * Must be awaited before passing the device to webusb — racing the
 * reset against the webusb claim crashes the libusb context (SIGSEGV).
 * This is a no-op if the reset fails (e.g. permission denied).
 */
async function resetDeviceBeforeClaim(vendorId: number, productId: number): Promise<void> {
  let nativeDevice: ReturnType<typeof findByIds> | undefined;
  try {
    nativeDevice = findByIds(vendorId, productId);
    if (!nativeDevice) return;
    nativeDevice.open();
    await new Promise<void>((resolve) => {
      try {
        nativeDevice!.reset(() => {
          // Close inside the callback so the close happens on the same
          // libusb event loop tick as the reset completion.
          try {
            nativeDevice!.close();
          } catch {
            /* device handle may already be invalidated by reset */
          }
          resolve();
        });
      } catch {
        // Reset call itself threw — try to close and resolve anyway
        try {
          nativeDevice!.close();
        } catch {
          /* swallow */
        }
        resolve();
      }
    });
  } catch {
    // findByIds or open() failed — proceed without reset.
  }
}

export async function findHiDockNodeDevice(
  options: NodeUsbDiscoveryOptions = {},
): Promise<UsbDeviceLike> {
  // Multi-device aware selection: enumerate the live bus, pick the preferred
  // device by env override or product preference order, then ask webusb for
  // the matching wrapped instance.
  const envOverride = process.env.HIDOCK_PREFERRED_PRODUCT_ID;
  const picked = selectPreferredHiDock(envOverride);
  if (picked) {
    // Recover the device from any wedged state before handing it off to
    // webusb. See resetDeviceBeforeClaim() docs for the rationale.
    // MUST be awaited — racing webusb against the reset crashes libusb.
    await resetDeviceBeforeClaim(picked.vendorId, picked.productId);

    const webusb = createNodeWebUsb(picked.productId);
    try {
      const device = await webusb.requestDevice({
        filters: [{ vendorId: picked.vendorId, productId: picked.productId }],
      });
      if (device) {
        return device as unknown as UsbDeviceLike;
      }
    } catch {
      // Fall through to legacy filter loop below
    }
  }

  // Legacy fallback: iterate filter list (used when enumeration returns no
  // HiDock-vendor devices, e.g. when injected filters override the default).
  const filters = options.filters ?? DEFAULT_NODE_FILTERS;
  const webusb = createNodeWebUsb();
  for (const filter of filters) {
    try {
      const device = await webusb.requestDevice({ filters: [filter] });
      if (device) {
        return device as unknown as UsbDeviceLike;
      }
    } catch {
      // Filter didn't match — try next
    }
  }

  throw new Error("No HiDock USB device found.");
}

const USB_CONNECT_TIMEOUT_MS = 5_000;
const USB_CONNECT_RETRIES = 5;
const USB_RETRY_DELAY_MS = 2_000;

function withUsbTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export async function createNodeHiDockClient(
  transportOptions: HiDockTransportOptions = {},
  discoveryOptions: NodeUsbDiscoveryOptions = {},
): Promise<HiDockClient> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < USB_CONNECT_RETRIES; attempt++) {
    try {
      const device = await withUsbTimeout(
        findHiDockNodeDevice(discoveryOptions),
        USB_CONNECT_TIMEOUT_MS,
        "USB device discovery",
      );
      return HiDockClient.fromUsbDevice(device, transportOptions);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < USB_CONNECT_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, USB_RETRY_DELAY_MS));
      }
    }
  }
  throw lastError ?? new Error("Failed to connect to HiDock device");
}

export function formatHiDockPluggedInPrompt(productName: string): string {
  const safeName = productName.trim() || "Unknown Device";
  const message = `HiDock ${safeName} plugged in, auto sync your latest recordings now...`;
  const border = "=".repeat(message.length + 4);
  return `${border}\n| ${message} |\n${border}`;
}

/**
 * Fast OS-level USB presence check using ioreg (macOS) or lsusb (Linux).
 * Unlike WebUSB.getDevices(), this never caches or breaks after USB errors.
 * Returns the product name if found, or null if not connected.
 */
export function detectHiDockPresence(): string | null {
  try {
    if (platform() === "darwin") {
      const output = execFileSync("/usr/sbin/ioreg", ["-p", "IOUSB", "-l"], {
        encoding: "utf-8",
        timeout: 3000,
      });
      const match = output.match(/"USB Product Name"\s*=\s*"([^"]*[Hh]i[Dd]ock[^"]*)"/i);
      return match ? (match[1] ?? "HiDock") : null;
    }
    if (platform() === "linux") {
      const output = execFileSync("lsusb", { encoding: "utf-8", timeout: 3000 });
      const match = output.match(/hidock/i);
      return match ? "HiDock" : null;
    }
  } catch {
    // Command failed — treat as not connected
  }
  return null;
}

export function createHiDockConnectionMonitor(
  options: HiDockConnectionMonitorOptions = {},
): HiDockConnectionMonitor {
  const intervalMs = options.intervalMs ?? DEFAULT_MONITOR_INTERVAL_MS;
  const emitOnStartupIfConnected = options.emitOnStartupIfConnected ?? true;
  const useInjectedFindDevice = !!options.findDevice;
  const findDevice = options.findDevice ?? findHiDockNodeDevice;
  const discoveryOptions = options.discoveryOptions ?? {};
  const formatPrompt = options.formatPrompt ?? formatHiDockPluggedInPrompt;
  const log = options.log ?? ((message: string) => console.log(message));
  const onPluggedIn = options.onPluggedIn ?? ((event: HiDockPlugInEvent) => log(event.prompt));
  const onUnplugged = options.onUnplugged;

  let timer: NodeJS.Timeout | null = null;
  let isPolling = false;
  let hasObservedState = false;
  let wasConnected = false;

  async function pollViaFindDevice(): Promise<void> {
    try {
      const device = await findDevice(discoveryOptions);
      const productName = getProductName(device);

      const shouldEmit = hasObservedState
        ? !wasConnected
        : emitOnStartupIfConnected;

      if (shouldEmit) {
        onPluggedIn({
          productName,
          prompt: formatPrompt(productName),
          device,
        });
      }

      wasConnected = true;
      hasObservedState = true;
    } catch (error) {
      const reason = toErrorMessage(error);
      if (!isNoDeviceFoundError(reason)) {
        if (reason.includes("LIBUSB_ERROR_BUSY")) {
          log(`${reason} — If HiNotes Web is open, it may be occupying the USB connection.`);
        } else {
          log(reason);
        }
      }
      const justDisconnected = hasObservedState && wasConnected;
      wasConnected = false;
      hasObservedState = true;
      if (justDisconnected && onUnplugged) onUnplugged();
    }
  }

  async function pollViaOsDetection(): Promise<void> {
    try {
      const detectedName = detectHiDockPresence();
      const isConnected = detectedName !== null;

      const shouldEmit = hasObservedState
        ? isConnected && !wasConnected
        : isConnected && emitOnStartupIfConnected;

      if (shouldEmit) {
        const productName = detectedName!;
        onPluggedIn({
          productName,
          prompt: formatPrompt(productName),
          device: {} as UsbDeviceLike,
        });
      }

      const justDisconnected = hasObservedState && wasConnected && !isConnected;
      wasConnected = isConnected;
      hasObservedState = true;
      if (justDisconnected && onUnplugged) onUnplugged();
    } catch (error) {
      const reason = toErrorMessage(error);
      log(`[HiDock USB Watch] poll error: ${reason}`);
      wasConnected = false;
      hasObservedState = true;
    }
  }

  async function pollNow(): Promise<void> {
    if (isPolling) {
      return;
    }

    isPolling = true;
    try {
      if (useInjectedFindDevice) {
        await pollViaFindDevice();
      } else {
        await pollViaOsDetection();
      }
    } finally {
      isPolling = false;
    }
  }

  return {
    start(): void {
      if (timer) {
        return;
      }
      void pollNow();
      timer = setInterval(() => {
        void pollNow();
      }, intervalMs);
    },
    stop(): void {
      if (!timer) {
        return;
      }
      clearInterval(timer);
      timer = null;
    },
    isRunning(): boolean {
      return timer !== null;
    },
    pollNow,
  };
}

function getProductName(device: UsbDeviceLike): string {
  const maybeNamed = device as UsbDeviceLike & { productName?: string | null };
  const productName = typeof maybeNamed.productName === "string"
    ? maybeNamed.productName.trim()
    : "";
  return productName || "Unknown Device";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown USB error";
}

function isNoDeviceFoundError(message: string): boolean {
  return message.includes("No HiDock USB device found");
}
