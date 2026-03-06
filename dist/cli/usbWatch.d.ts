import { HiDockPlugInEvent } from "../nodeUsb.js";
interface UsbWatchCliOptions {
    intervalMs: number;
    emitOnStartupIfConnected: boolean;
    slackTarget: string | null;
    slackThreadId: string | null;
    slackActivityTarget: string | null;
    slackActivityUserId: string | null;
    activeWindowMinutes: number;
    openClawBin: string;
    autoSync: boolean;
    syncDebounceMs: number;
    showHelp: boolean;
}
interface OpenClawExecResult {
    stdout: string;
    stderr: string;
}
type OpenClawExec = (file: string, args: readonly string[]) => Promise<OpenClawExecResult>;
export declare function parseUsbWatchArgs(argv: string[], env?: NodeJS.ProcessEnv): UsbWatchCliOptions;
export declare function createOpenClawSlackForwarder(options: {
    target: string;
    threadId?: string | null;
    activityTarget?: string | null;
    activityUserId?: string | null;
    activeWindowMinutes?: number;
    openClawBin?: string;
    exec?: OpenClawExec;
    nowMs?: () => number;
}): (message: string) => Promise<void>;
export declare function createUsbWatchPlugInHandler(options: {
    log: (message: string) => void;
    sendSlackMessage?: (message: string) => Promise<void>;
    onAutoSync?: () => void;
}): (event: HiDockPlugInEvent) => void;
export {};
//# sourceMappingURL=usbWatch.d.ts.map