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
export declare function createNodeWebUsb(): WebUSB;
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