export declare function concatBytes(...parts: readonly Uint8Array[]): Uint8Array;
export declare function toHex(bytes: Uint8Array): string;
export declare function readU24BE(bytes: Uint8Array, offset: number): number;
export declare function writeU24BE(bytes: Uint8Array, offset: number, value: number): void;
export declare function readU32BE(bytes: Uint8Array, offset: number): number;
export declare function writeU32BE(bytes: Uint8Array, offset: number, value: number): void;
export declare function trimTrailingNul(value: string): string;
export declare function asArrayBuffer(bytes: Uint8Array): ArrayBuffer;
//# sourceMappingURL=bytes.d.ts.map