export declare const HIDOCK_FRAME_HEADER = 4660;
export declare const HIDOCK_FRAME_HEADER_HI = 18;
export declare const HIDOCK_FRAME_HEADER_LO = 52;
export declare const HIDOCK_FRAME_HEADER_BYTES = 12;
export interface HiDockFrame {
    commandId: number;
    messageId: number;
    bodyLength: number;
    body: Uint8Array;
}
export declare function encodeHiDockFrame(commandId: number, messageId: number, body?: Uint8Array): Uint8Array;
export declare function decodeHiDockFrame(frameBytes: Uint8Array): HiDockFrame;
export declare class HiDockFrameStreamParser {
    private buffer;
    feed(chunk: Uint8Array): HiDockFrame[];
    reset(): void;
    private findHeaderOffset;
}
//# sourceMappingURL=protocol.d.ts.map