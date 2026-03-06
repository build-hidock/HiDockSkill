import { HiDockFrame } from "./protocol.js";
export type UsbTransferStatusLike = "ok" | "stall" | "babble";
export interface UsbInTransferResultLike {
    status: UsbTransferStatusLike;
    data?: DataView | null;
}
export interface UsbOutTransferResultLike {
    status: UsbTransferStatusLike;
    bytesWritten?: number;
}
export interface UsbDeviceLike {
    readonly configuration: object | null;
    open(): Promise<void>;
    close(): Promise<void>;
    selectConfiguration(configurationValue: number): Promise<void>;
    claimInterface(interfaceNumber: number): Promise<void>;
    releaseInterface(interfaceNumber: number): Promise<void>;
    transferIn(endpointNumber: number, length: number): Promise<UsbInTransferResultLike>;
    transferOut(endpointNumber: number, data: ArrayBuffer): Promise<UsbOutTransferResultLike>;
}
export interface HiDockTransportOptions {
    interfaceNumber?: number;
    outEndpointNumber?: number;
    inEndpointNumber?: number;
    readLength?: number;
    defaultResponseReadLimit?: number;
}
export declare class HiDockWebUsbTransport {
    readonly interfaceNumber: number;
    readonly outEndpointNumber: number;
    readonly inEndpointNumber: number;
    readonly readLength: number;
    readonly defaultResponseReadLimit: number;
    private readonly parser;
    private readonly device;
    constructor(device: UsbDeviceLike, options?: HiDockTransportOptions);
    open(): Promise<void>;
    close(): Promise<void>;
    resetParser(): void;
    sendCommand(commandId: number, messageId: number, body?: Uint8Array): Promise<void>;
    readFrames(): Promise<HiDockFrame[]>;
    requestResponseFrame(commandId: number, messageId: number, body?: Uint8Array, readLimit?: number): Promise<HiDockFrame>;
}
//# sourceMappingURL=transport.d.ts.map