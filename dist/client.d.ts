import { HiDockFileEntry, HiDockFileList } from "./fileList.js";
import { HiDockDeviceInfo, HiDockDeviceTime } from "./parsers.js";
import { HiDockFrame } from "./protocol.js";
import { HiDockTransportOptions, UsbDeviceLike } from "./transport.js";
export interface DownloadFileOptions {
    expectedSize?: number;
    readLimit?: number;
    readTimeoutMs?: number;
    onProgress?: (receivedBytes: number, expectedBytes: number) => void;
}
export interface HiDockTransportLike {
    open(): Promise<void>;
    close(): Promise<void>;
    sendCommand(commandId: number, messageId: number, body?: Uint8Array): Promise<void>;
    readFrames(): Promise<HiDockFrame[]>;
    requestResponseFrame(commandId: number, messageId: number, body?: Uint8Array, readLimit?: number): Promise<HiDockFrame>;
}
export declare class HiDockClient {
    private readonly transport;
    private messageId;
    private connected;
    constructor(transport: HiDockTransportLike);
    static fromUsbDevice(device: UsbDeviceLike, options?: HiDockTransportOptions): HiDockClient;
    open(): Promise<void>;
    close(): Promise<void>;
    withConnection<T>(run: () => Promise<T>): Promise<T>;
    getDeviceInfo(): Promise<HiDockDeviceInfo>;
    getDeviceTime(): Promise<HiDockDeviceTime>;
    getFileCount(): Promise<number>;
    listFiles(): Promise<HiDockFileList>;
    readFileHead(file: Pick<HiDockFileEntry, "rawFileNameBytes"> | string, byteLength: number): Promise<Uint8Array>;
    downloadFile(file: HiDockFileEntry | string, options?: DownloadFileOptions): Promise<Uint8Array>;
    private collectCommandBytes;
    private resolveFileTarget;
    private getFileNameBytes;
    private requestSingle;
    private nextMessageId;
}
//# sourceMappingURL=client.d.ts.map