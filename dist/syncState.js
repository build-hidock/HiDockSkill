import { promises as fs } from "node:fs";
import path from "node:path";
const DEFAULT_STATE = {
    version: 1,
    lastSuccessfulSyncAt: null,
    lastRunStartedAt: null,
    processedFiles: {},
};
export class SyncStateStore {
    filePath;
    constructor(filePath) {
        this.filePath = filePath;
    }
    get path() {
        return this.filePath;
    }
    async read() {
        try {
            const raw = await fs.readFile(this.filePath, "utf8");
            const parsed = JSON.parse(raw);
            return {
                version: 1,
                lastSuccessfulSyncAt: typeof parsed.lastSuccessfulSyncAt === "string"
                    ? parsed.lastSuccessfulSyncAt
                    : null,
                lastRunStartedAt: typeof parsed.lastRunStartedAt === "string" ? parsed.lastRunStartedAt : null,
                processedFiles: normalizeProcessed(parsed.processedFiles),
            };
        }
        catch {
            return { ...DEFAULT_STATE };
        }
    }
    async markRunStarted(startedAt) {
        const state = await this.read();
        state.lastRunStartedAt = startedAt.toISOString();
        await this.write(state);
        return state;
    }
    async markRunCompleted(options) {
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
    shouldProcessFile(file, state) {
        const existing = state.processedFiles[file.fileName];
        if (!existing) {
            return true;
        }
        return existing.fileSize !== file.fileSize;
    }
    async write(state) {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        await fs.writeFile(this.filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    }
}
export function defaultSyncStatePath(storageDir) {
    return path.join(storageDir, ".hidock-sync-state.json");
}
function normalizeProcessed(input) {
    if (!input || typeof input !== "object") {
        return {};
    }
    const output = {};
    for (const [key, value] of Object.entries(input)) {
        if (!value || typeof value !== "object") {
            continue;
        }
        const row = value;
        if (typeof row.fileName === "string" &&
            typeof row.fileSize === "number" &&
            Number.isFinite(row.fileSize) &&
            typeof row.processedAt === "string") {
            output[key] = {
                fileName: row.fileName,
                fileSize: row.fileSize,
                processedAt: row.processedAt,
            };
        }
    }
    return output;
}
//# sourceMappingURL=syncState.js.map