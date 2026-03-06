import { promises as fs } from "node:fs";
import path from "node:path";

import { HiDockFileEntry } from "./fileList.js";

export interface ProcessedFileState {
  fileName: string;
  fileSize: number;
  processedAt: string;
}

export interface SyncState {
  version: 1;
  lastSuccessfulSyncAt: string | null;
  lastRunStartedAt: string | null;
  processedFiles: Record<string, ProcessedFileState>;
}

const DEFAULT_STATE: SyncState = {
  version: 1,
  lastSuccessfulSyncAt: null,
  lastRunStartedAt: null,
  processedFiles: {},
};

export class SyncStateStore {
  constructor(private readonly filePath: string) {}

  get path(): string {
    return this.filePath;
  }

  async read(): Promise<SyncState> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SyncState>;
      return {
        version: 1,
        lastSuccessfulSyncAt:
          typeof parsed.lastSuccessfulSyncAt === "string"
            ? parsed.lastSuccessfulSyncAt
            : null,
        lastRunStartedAt:
          typeof parsed.lastRunStartedAt === "string" ? parsed.lastRunStartedAt : null,
        processedFiles: normalizeProcessed(parsed.processedFiles),
      };
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  async markRunStarted(startedAt: Date): Promise<SyncState> {
    const state = await this.read();
    state.lastRunStartedAt = startedAt.toISOString();
    await this.write(state);
    return state;
  }

  async markRunCompleted(options: {
    completedAt: Date;
    processed: HiDockFileEntry[];
  }): Promise<SyncState> {
    const state = await this.read();
    for (const file of options.processed) {
      state.processedFiles[file.fileName] = {
        fileName: file.fileName,
        fileSize: file.fileSize,
        processedAt: options.completedAt.toISOString(),
      };
    }
    state.lastSuccessfulSyncAt = options.completedAt.toISOString();
    await this.write(state);
    return state;
  }

  shouldProcessFile(file: HiDockFileEntry, state: SyncState): boolean {
    const existing = state.processedFiles[file.fileName];
    if (!existing) {
      return true;
    }
    return existing.fileSize !== file.fileSize;
  }

  private async write(state: SyncState): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

export function defaultSyncStatePath(storageDir: string): string {
  return path.join(storageDir, ".hidock-sync-state.json");
}

function normalizeProcessed(
  input: unknown,
): Record<string, ProcessedFileState> {
  if (!input || typeof input !== "object") {
    return {};
  }

  const output: Record<string, ProcessedFileState> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const row = value as Partial<ProcessedFileState>;
    if (
      typeof row.fileName === "string" &&
      typeof row.fileSize === "number" &&
      Number.isFinite(row.fileSize) &&
      typeof row.processedAt === "string"
    ) {
      output[key] = {
        fileName: row.fileName,
        fileSize: row.fileSize,
        processedAt: row.processedAt,
      };
    }
  }
  return output;
}
