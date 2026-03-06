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
  log?: (message: string) => void;
}

export interface HiDockConnectionMonitor {
  start(): void;
  stop(): void;
  isRunning(): boolean;
  pollNow(): Promise<void>;
}

const DEFAULT_NODE_FILTERS: readonly HiDockUsbFilter[] = [
  { vendorId: 0x10d6, productId: 0xb00d },
  { vendorId: 0x10d6 }, // fallback for future product IDs
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
  const webusb = createNodeWebUsb();
  const devices = await webusb.getDevices();

  const matched = devices.find((device) =>
    filters.some((filter) => {
      const productMatches =
        typeof filter.productId === "number"
          ? device.productId === filter.productId
          : true;
      return device.vendorId === filter.vendorId && productMatches;
    }),
  );

  if (matched) {
    return matched as unknown as UsbDeviceLike;
  }

  const byName = devices.find((device) =>
    `${device.productName ?? ""} ${device.manufacturerName ?? ""}`
      .toLowerCase()
      .includes("hidock"),
  );
  if (byName) {
    return byName as unknown as UsbDeviceLike;
  }

  throw new Error("No HiDock USB device found.");
}

export async function createNodeHiDockClient(
  transportOptions: HiDockTransportOptions = {},
  discoveryOptions: NodeUsbDiscoveryOptions = {},
): Promise<HiDockClient> {
  const device = await findHiDockNodeDevice(discoveryOptions);
  return HiDockClient.fromUsbDevice(device, transportOptions);
}

export function formatHiDockPluggedInPrompt(productName: string): string {
  const safeName = productName.trim() || "Unknown Device";
  const message = `HiDock ${safeName} plugged in, auto sync your latest recordings now...`;
  const border = "=".repeat(message.length + 4);
  return `${border}\n| ${message} |\n${border}`;
}

export function createHiDockConnectionMonitor(
  options: HiDockConnectionMonitorOptions = {},
): HiDockConnectionMonitor {
  const intervalMs = options.intervalMs ?? DEFAULT_MONITOR_INTERVAL_MS;
  const emitOnStartupIfConnected = options.emitOnStartupIfConnected ?? true;
  const findDevice = options.findDevice ?? findHiDockNodeDevice;
  const discoveryOptions = options.discoveryOptions ?? {};
  const formatPrompt = options.formatPrompt ?? formatHiDockPluggedInPrompt;
  const log = options.log ?? ((message: string) => console.log(message));
  const onPluggedIn = options.onPluggedIn ?? ((event: HiDockPlugInEvent) => log(event.prompt));

  let timer: NodeJS.Timeout | null = null;
  let isPolling = false;
  let hasObservedState = false;
  let wasConnected = false;

  async function pollNow(): Promise<void> {
    if (isPolling) {
      return;
    }

    isPolling = true;
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
        log(
          `[HiDock USB Watch] unable to access HiDock USB (${reason}). If HiNotes Web is open, it may be occupying the USB connection.`,
        );
      }
      wasConnected = false;
      hasObservedState = true;
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
