export class SyncCoordinator {
    running = false;
    rerunRequested = false;
    timer = null;
    debounceMs;
    log;
    constructor(options = {}) {
        this.debounceMs = options.debounceMs ?? 1000;
        this.log = options.log ?? (() => undefined);
    }
    trigger(run) {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.timer = setTimeout(() => {
            this.timer = null;
            void this.execute(run);
        }, this.debounceMs);
    }
    async execute(run) {
        if (this.running) {
            this.rerunRequested = true;
            this.log("sync already running; queued one follow-up run");
            return;
        }
        this.running = true;
        try {
            await run();
        }
        finally {
            this.running = false;
            if (this.rerunRequested) {
                this.rerunRequested = false;
                this.log("running queued follow-up sync");
                void this.execute(run);
            }
        }
    }
}
//# sourceMappingURL=syncCoordinator.js.map