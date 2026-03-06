export interface HiDockDeviceInfo {
    version: string;
    serialNumber: string;
    rawHex: string;
}
export interface HiDockDeviceTime {
    bcdDateTime: string | null;
    rawHex: string;
}
export declare function parseDeviceInfoBody(body: Uint8Array): HiDockDeviceInfo;
export declare function parseDeviceTimeBody(body: Uint8Array): HiDockDeviceTime;
export declare function parseFileCountBody(body: Uint8Array): number;
//# sourceMappingURL=parsers.d.ts.map