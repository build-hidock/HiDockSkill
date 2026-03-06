export interface SyncCoordinatorOptions {
  debounceMs?: number;
  log?: (message: string) => void;
}

export class SyncCoordinator {
  private running = false;
  private rerunRequested = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly debounceMs: number;
  private readonly log: (message: string) => void;

  constructor(options: SyncCoordinatorOptions = {}) {
    this.debounceMs = options.debounceMs ?? 1000;
    this.log = options.log ?? (() => undefined);
  }

  trigger(run: () => Promise<void>): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.execute(run);
    }, this.debounceMs);
  }

  private async execute(run: () => Promise<void>): Promise<void> {
    if (this.running) {
      this.rerunRequested = true;
      this.log("sync already running; queued one follow-up run");
      return;
    }

    this.running = true;
    try {
      await run();
    } finally {
      this.running = false;
      if (this.rerunRequested) {
        this.rerunRequested = false;
        this.log("running queued follow-up sync");
        void this.execute(run);
      }
    }
  }
}
