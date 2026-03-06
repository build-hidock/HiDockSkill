export declare const HiDockCommand: {
    readonly QUERY_DEVICE_INFO: 1;
    readonly QUERY_DEVICE_TIME: 2;
    readonly QUERY_FILE_LIST: 4;
    readonly TRANSFER_FILE: 5;
    readonly QUERY_FILE_COUNT: 6;
    readonly TRANSFER_FILE_HEAD: 13;
    readonly TRANSFER_FILE_RANGE: 21;
};
export type HiDockCommandCode = (typeof HiDockCommand)[keyof typeof HiDockCommand];
//# sourceMappingURL=commands.d.ts.map