import { WebUSB } from "usb";
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
    findDevice?: (options?: NodeUsbDiscoveryOptions) => Promise<UsbDeviceLike>;
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
export declare function createNodeWebUsb(preferredProductId?: number): WebUSB;
/**
 * Enumerate every HiDock device currently on the USB bus using the underlying
 * libusb-based `usb` package. Unlike `webusb.getDevices()`, this never caches
 * stale handles — every call reflects the current bus state. Returns devices
 * in preference order (P1 → H1E → H1 → unknown).
 */
export declare function enumerateHiDockBusDevices(): HiDockBusDevice[];
/**
 * Pick the best HiDock device on the bus. Honors `HIDOCK_PREFERRED_PRODUCT_ID`
 * env var (decimal or hex with 0x prefix) when set; otherwise returns the
 * first device in `enumerateHiDockBusDevices()` preference order.
 */
export declare function selectPreferredHiDock(envOverride?: string): HiDockBusDevice | null;
export declare function findHiDockNodeDevice(options?: NodeUsbDiscoveryOptions): Promise<UsbDeviceLike>;
export declare function createNodeHiDockClient(transportOptions?: HiDockTransportOptions, discoveryOptions?: NodeUsbDiscoveryOptions): Promise<HiDockClient>;
export declare function formatHiDockPluggedInPrompt(productName: string): string;
/**
 * Fast OS-level USB presence check using ioreg (macOS) or lsusb (Linux).
 * Unlike WebUSB.getDevices(), this never caches or breaks after USB errors.
 * Returns the product name if found, or null if not connected.
 */
export declare function detectHiDockPresence(): string | null;
export declare function createHiDockConnectionMonitor(options?: HiDockConnectionMonitorOptions): HiDockConnectionMonitor;
//# sourceMappingURL=nodeUsb.d.ts.map