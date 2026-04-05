import { asArrayBuffer } from "./bytes.js";
import { HiDockFrameStreamParser, encodeHiDockFrame, } from "./protocol.js";
const DEFAULT_INTERFACE_NUMBER = 0;
const DEFAULT_OUT_ENDPOINT = 1;
const DEFAULT_IN_ENDPOINT = 2;
const DEFAULT_READ_LENGTH = 8192;
const DEFAULT_RESPONSE_READ_LIMIT = 64;
export class HiDockWebUsbTransport {
    interfaceNumber;
    outEndpointNumber;
    inEndpointNumber;
    readLength;
    defaultResponseReadLimit;
    parser = new HiDockFrameStreamParser();
    device;
    constructor(device, options = {}) {
        this.device = device;
        this.interfaceNumber = options.interfaceNumber ?? DEFAULT_INTERFACE_NUMBER;
        this.outEndpointNumber = options.outEndpointNumber ?? DEFAULT_OUT_ENDPOINT;
        this.inEndpointNumber = options.inEndpointNumber ?? DEFAULT_IN_ENDPOINT;
        this.readLength = options.readLength ?? DEFAULT_READ_LENGTH;
        this.defaultResponseReadLimit =
            options.defaultResponseReadLimit ?? DEFAULT_RESPONSE_READ_LIMIT;
    }
    async open() {
        const timeout = (p, ms, label) => new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms);
            p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
        });
        await timeout(this.device.open(), 10_000, "device.open");
        if (!this.device.configuration) {
            await timeout(this.device.selectConfiguration(1), 10_000, "selectConfiguration");
        }
        await timeout(this.device.claimInterface(this.interfaceNumber), 10_000, "claimInterface");
    }
    async close() {
        try {
            await this.device.releaseInterface(this.interfaceNumber);
        }
        finally {
            await this.device.close();
            this.parser.reset();
        }
    }
    resetParser() {
        this.parser.reset();
    }
    async sendCommand(commandId, messageId, body = new Uint8Array(0)) {
        const frame = encodeHiDockFrame(commandId, messageId, body);
        const result = await this.device.transferOut(this.outEndpointNumber, asArrayBuffer(frame));
        if (result.status !== "ok") {
            throw new Error(`transferOut failed: status=${result.status}, command=0x${commandId.toString(16)}`);
        }
    }
    async readFrames() {
        const result = await this.device.transferIn(this.inEndpointNumber, this.readLength);
        if (result.status !== "ok") {
            return [];
        }
        if (!result.data || result.data.byteLength === 0) {
            return [];
        }
        const bytes = new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
        return this.parser.feed(bytes);
    }
    async requestResponseFrame(commandId, messageId, body = new Uint8Array(0), readLimit = this.defaultResponseReadLimit) {
        await this.sendCommand(commandId, messageId, body);
        for (let reads = 0; reads < readLimit; reads += 1) {
            const frames = await this.readFrames();
            for (const frame of frames) {
                if (frame.commandId === commandId && frame.messageId === messageId) {
                    return frame;
                }
            }
        }
        throw new Error(`No response for command=0x${commandId.toString(16)} messageId=${messageId}`);
    }
}
//# sourceMappingURL=transport.js.map