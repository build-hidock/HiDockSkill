import { concatBytes, trimTrailingNul, writeU32BE } from "./bytes.js";
import { HiDockCommand } from "./commands.js";
import { parseHiDockFileListBody, } from "./fileList.js";
import { parseDeviceInfoBody, parseDeviceTimeBody, parseFileCountBody, } from "./parsers.js";
import { HiDockWebUsbTransport } from "./transport.js";
const textEncoder = new TextEncoder();
const DEFAULT_READ_TIMEOUT_MS = 30_000; // 30s stale-read timeout
export class HiDockClient {
    transport;
    messageId = 0;
    connected = false;
    constructor(transport) {
        this.transport = transport;
    }
    static fromUsbDevice(device, options = {}) {
        return new HiDockClient(new HiDockWebUsbTransport(device, options));
    }
    async open() {
        if (this.connected) {
            return;
        }
        await this.transport.open();
        this.connected = true;
    }
    async close() {
        if (!this.connected) {
            return;
        }
        try {
            await this.transport.close();
        }
        finally {
            this.connected = false;
        }
    }
    async withConnection(run) {
        await this.open();
        try {
            return await run();
        }
        finally {
            await this.close();
        }
    }
    async getDeviceInfo() {
        const frame = await this.requestSingle(HiDockCommand.QUERY_DEVICE_INFO);
        return parseDeviceInfoBody(frame.body);
    }
    async getDeviceTime() {
        const frame = await this.requestSingle(HiDockCommand.QUERY_DEVICE_TIME);
        return parseDeviceTimeBody(frame.body);
    }
    async getFileCount() {
        const frame = await this.requestSingle(HiDockCommand.QUERY_FILE_COUNT);
        return parseFileCountBody(frame.body);
    }
    async listFiles() {
        const frame = await this.requestSingle(HiDockCommand.QUERY_FILE_LIST, undefined, 256);
        return parseHiDockFileListBody(frame.body);
    }
    async readFileHead(file, byteLength) {
        const body = new Uint8Array(4 + this.getFileNameBytes(file).length);
        writeU32BE(body, 0, byteLength);
        body.set(this.getFileNameBytes(file), 4);
        const messageId = this.nextMessageId();
        await this.transport.sendCommand(HiDockCommand.TRANSFER_FILE_HEAD, messageId, body);
        return this.collectCommandBytes(HiDockCommand.TRANSFER_FILE_HEAD, messageId, byteLength, 64);
    }
    async downloadFile(file, options = {}) {
        const target = await this.resolveFileTarget(file, options.expectedSize);
        const expectedSize = options.expectedSize ?? target.fileSize;
        if (expectedSize <= 0) {
            throw new Error("Expected file size is unknown. Pass expectedSize or download from a listed file entry.");
        }
        const readLimit = options.readLimit ?? 4096;
        const messageId = this.nextMessageId();
        await this.transport.sendCommand(HiDockCommand.TRANSFER_FILE, messageId, target.rawFileNameBytes);
        return this.collectCommandBytes(HiDockCommand.TRANSFER_FILE, messageId, expectedSize, readLimit, options.onProgress, options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS);
    }
    async collectCommandBytes(commandId, messageId, expectedSize, readLimit, onProgress, readTimeoutMs = DEFAULT_READ_TIMEOUT_MS) {
        const chunks = [];
        let received = 0;
        for (let reads = 0; reads < readLimit && received < expectedSize; reads += 1) {
            const frames = await Promise.race([
                this.transport.readFrames(),
                new Promise((_, reject) => setTimeout(() => reject(new Error(`USB read timeout after ${readTimeoutMs / 1000}s (received ${received}/${expectedSize} bytes)`)), readTimeoutMs)),
            ]);
            for (const frame of frames) {
                if (frame.commandId !== commandId) {
                    continue;
                }
                // H1 firmware streams TRANSFER_FILE chunks with auto-incremented messageId
                // (startId, startId+1, ...), while older devices may reuse the same id.
                // Accept both patterns for file transfer commands.
                if (commandId !== HiDockCommand.TRANSFER_FILE &&
                    frame.messageId !== messageId) {
                    continue;
                }
                if (commandId === HiDockCommand.TRANSFER_FILE &&
                    frame.messageId < messageId) {
                    continue;
                }
                if (frame.body.length === 0) {
                    continue;
                }
                chunks.push(frame.body);
                received += frame.body.length;
                if (onProgress) {
                    onProgress(Math.min(received, expectedSize), expectedSize);
                }
                if (received >= expectedSize) {
                    break;
                }
            }
        }
        if (received < expectedSize) {
            throw new Error(`Incomplete transfer for command=0x${commandId.toString(16)}: expected ${expectedSize}, got ${received}`);
        }
        const all = concatBytes(...chunks);
        return all.length === expectedSize ? all : all.subarray(0, expectedSize);
    }
    async resolveFileTarget(file, expectedSize) {
        if (typeof file !== "string") {
            return { fileSize: file.fileSize, rawFileNameBytes: file.rawFileNameBytes };
        }
        const fileName = trimTrailingNul(file);
        const list = await this.listFiles();
        const matched = list.files.find((entry) => entry.fileName === fileName);
        if (!matched) {
            if (!expectedSize || expectedSize <= 0) {
                throw new Error(`File "${fileName}" not found in device list. Provide expectedSize to download by name.`);
            }
            return {
                fileSize: expectedSize,
                rawFileNameBytes: ensureTrailingNul(textEncoder.encode(fileName)),
            };
        }
        return { fileSize: matched.fileSize, rawFileNameBytes: matched.rawFileNameBytes };
    }
    getFileNameBytes(file) {
        if (typeof file === "string") {
            return ensureTrailingNul(textEncoder.encode(trimTrailingNul(file)));
        }
        return file.rawFileNameBytes;
    }
    async requestSingle(commandId, body, readLimit) {
        return this.transport.requestResponseFrame(commandId, this.nextMessageId(), body, readLimit);
    }
    nextMessageId() {
        this.messageId = (this.messageId + 1) >>> 0;
        return this.messageId;
    }
}
function ensureTrailingNul(bytes) {
    if (bytes.length > 0 && bytes[bytes.length - 1] === 0x00) {
        return bytes;
    }
    const value = new Uint8Array(bytes.length + 1);
    value.set(bytes, 0);
    value[value.length - 1] = 0x00;
    return value;
}
//# sourceMappingURL=client.js.map