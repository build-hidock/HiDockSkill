export interface SyncCoordinatorOptions {
    debounceMs?: number;
    log?: (message: string) => void;
}
export declare class SyncCoordinator {
    private running;
    private rerunRequested;
    private timer;
    private readonly debounceMs;
    private readonly log;
    constructor(options?: SyncCoordinatorOptions);
    isBusy(): boolean;
    trigger(run: () => Promise<void>): void;
    private execute;
}
//# sourceMappingURL=syncCoordinator.d.ts.map