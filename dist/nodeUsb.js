import { WebUSB } from "usb";
import { HiDockClient } from "./client.js";
const DEFAULT_NODE_FILTERS = [
    { vendorId: 0x10d6, productId: 0xb00d },
    { vendorId: 0x10d6 }, // fallback for future product IDs
];
const DEFAULT_MONITOR_INTERVAL_MS = 5000;
export function createNodeWebUsb() {
    return new WebUSB({
        allowAllDevices: true,
        devicesFound: (devices) => devices[0],
    });
}
export async function findHiDockNodeDevice(options = {}) {
    const filters = options.filters ?? DEFAULT_NODE_FILTERS;
    const webusb = createNodeWebUsb();
    const devices = await webusb.getDevices();
    const matched = devices.find((device) => filters.some((filter) => {
        const productMatches = typeof filter.productId === "number"
            ? device.productId === filter.productId
            : true;
        return device.vendorId === filter.vendorId && productMatches;
    }));
    if (matched) {
        return matched;
    }
    const byName = devices.find((device) => `${device.productName ?? ""} ${device.manufacturerName ?? ""}`
        .toLowerCase()
        .includes("hidock"));
    if (byName) {
        return byName;
    }
    throw new Error("No HiDock USB device found.");
}
export async function createNodeHiDockClient(transportOptions = {}, discoveryOptions = {}) {
    const device = await findHiDockNodeDevice(discoveryOptions);
    return HiDockClient.fromUsbDevice(device, transportOptions);
}
export function formatHiDockPluggedInPrompt(productName) {
    const safeName = productName.trim() || "Unknown Device";
    const message = `HiDock ${safeName} plugged in, auto sync your latest recordings now...`;
    const border = "=".repeat(message.length + 4);
    return `${border}\n| ${message} |\n${border}`;
}
export function createHiDockConnectionMonitor(options = {}) {
    const intervalMs = options.intervalMs ?? DEFAULT_MONITOR_INTERVAL_MS;
    const emitOnStartupIfConnected = options.emitOnStartupIfConnected ?? true;
    const findDevice = options.findDevice ?? findHiDockNodeDevice;
    const discoveryOptions = options.discoveryOptions ?? {};
    const formatPrompt = options.formatPrompt ?? formatHiDockPluggedInPrompt;
    const log = options.log ?? ((message) => console.log(message));
    const onPluggedIn = options.onPluggedIn ?? ((event) => log(event.prompt));
    let timer = null;
    let isPolling = false;
    let hasObservedState = false;
    let wasConnected = false;
    async function pollNow() {
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
        }
        catch {
            wasConnected = false;
            hasObservedState = true;
        }
        finally {
            isPolling = false;
        }
    }
    return {
        start() {
            if (timer) {
                return;
            }
            void pollNow();
            timer = setInterval(() => {
                void pollNow();
            }, intervalMs);
        },
        stop() {
            if (!timer) {
                return;
            }
            clearInterval(timer);
            timer = null;
        },
        isRunning() {
            return timer !== null;
        },
        pollNow,
    };
}
function getProductName(device) {
    const maybeNamed = device;
    const productName = typeof maybeNamed.productName === "string"
        ? maybeNamed.productName.trim()
        : "";
    return productName || "Unknown Device";
}
//# sourceMappingURL=nodeUsb.js.map