import { execFileSync } from "node:child_process";
import { platform } from "node:os";

import { WebUSB } from "usb";

import { HiDockClient } from "./client.js";
import { HiDockTransportOptions, UsbDeviceLike } from "./transport.js";

export interface HiDockUsbFilter {
  vendorId: number;
  productId?: number;
}

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

const DEFAULT_NODE_FILTERS: readonly HiDockUsbFilter[] = [
  { vendorId: 0x10d6, productId: 0xb00c }, // HiDock H1 data interface
  { vendorId: 0x10d6, productId: 0xb00d }, // HiDock P1
  { vendorId: 0x10d6 },                   // fallback for future product IDs
];
const DEFAULT_MONITOR_INTERVAL_MS = 5000;

export function createNodeWebUsb(): WebUSB {
  return new WebUSB({
    allowAllDevices: true,
    devicesFound: (devices) => devices[0],
  });
}

export async function findHiDockNodeDevice(
  options: NodeUsbDiscoveryOptions = {},
): Promise<UsbDeviceLike> {
  const filters = options.filters ?? DEFAULT_NODE_FILTERS;

  // Always use requestDevice() for a fresh USB enumeration.
  // getDevices() caches stale handles that break after unplug/replug.
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
