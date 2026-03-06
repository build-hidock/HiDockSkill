import { MeetingStorage, } from "./meetingStorage.js";
export function parseNotesStorageBackend(value) {
    const normalized = value?.trim().toLowerCase() ?? "local";
    if (normalized === "local" || normalized.length === 0) {
        return "local";
    }
    if (normalized === "memdock") {
        return "memdock";
    }
    throw new Error(`Invalid value for storage backend: ${value ?? "(empty)"} (expected local|memdock)`);
}
export class LocalMeetingStorageAdapter {
    storage;
    constructor(options) {
        this.storage = new MeetingStorage(options);
    }
    saveMeeting(input) {
        return this.storage.saveMeeting(input);
    }
    saveWhisper(input) {
        return this.storage.saveWhisper(input);
    }
    isIndexed(sourceFileName, kind) {
        return this.storage.isIndexed(sourceFileName, kind);
    }
    getIndexPath(kind) {
        return this.storage.getIndexPath(kind);
    }
}
const DEFAULT_MEMDOCK_TIMEOUT_MS = 10000;
export class MemdockNotesStorageAdapter {
    fallback;
    baseUrl;
    apiKey;
    apiPath;
    workspace;
    collection;
    timeoutMs;
    fetchImpl;
    log;
    warnedMissingBaseUrl = false;
    constructor(options) {
        this.fallback = new LocalMeetingStorageAdapter(toMeetingStorageOptions(options));
        this.baseUrl = normalizeNonEmptyString(options.baseUrl);
        this.apiKey = normalizeNonEmptyString(options.apiKey);
        this.apiPath = normalizeMemdockApiPath(options.apiPath);
        this.workspace = normalizeNonEmptyString(options.workspace);
        this.collection = normalizeNonEmptyString(options.collection);
        this.timeoutMs =
            options.timeoutMs && options.timeoutMs > 0
                ? options.timeoutMs
                : DEFAULT_MEMDOCK_TIMEOUT_MS;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.log = options.log ?? (() => undefined);
    }
    async saveMeeting(input) {
        const saved = await this.trySave("meeting", input);
        if (saved) {
            return saved;
        }
        return this.fallback.saveMeeting(input);
    }
    async saveWhisper(input) {
        const saved = await this.trySave("whisper", input);
        if (saved) {
            return saved;
        }
        return this.fallback.saveWhisper(input);
    }
    async isIndexed(sourceFileName, kind) {
        const indexed = await this.tryIsIndexed(sourceFileName, kind);
        if (typeof indexed === "boolean") {
            return indexed;
        }
        return this.fallback.isIndexed(sourceFileName, kind);
    }
    getIndexPath(kind) {
        if (!this.baseUrl) {
            return this.fallback.getIndexPath(kind);
        }
        const workspace = this.workspace ?? "default";
        const collection = this.collection ?? "notes";
        const indexName = kind === "meeting" ? "meetingindex.md" : "whisperindex.md";
        return `memdock://${workspace}/${collection}/${indexName}`;
    }
    async trySave(kind, input) {
        if (!this.baseUrl) {
            this.warnBaseUrlMissing();
            return null;
        }
        try {
            const response = await this.requestJson(`${this.apiPath}/save`, {
                kind,
                document: serializeMeetingDocument(input),
                sourceFileName: input.sourceFileName,
            });
            const payload = response.data ?? response;
            if (!payload.indexPath) {
                throw new Error("missing indexPath in memdock response");
            }
            if (!payload.skipped && !payload.notePath) {
                throw new Error("missing notePath in memdock response");
            }
            return {
                notePath: payload.notePath ?? "",
                indexPath: payload.indexPath,
                relativeNotePath: payload.relativeNotePath ??
                    toSafeRelativePath(payload.notePath ?? "", payload.indexPath),
                skipped: payload.skipped ?? false,
            };
        }
        catch (error) {
            this.log(`[notes] memdock save failed for ${kind}; fallback local (${toErrorMessage(error)})`);
            return null;
        }
    }
    async tryIsIndexed(sourceFileName, kind) {
        if (!this.baseUrl) {
            this.warnBaseUrlMissing();
            return null;
        }
        try {
            const response = await this.requestJson(`${this.apiPath}/is-indexed`, { sourceFileName, kind });
            const indexed = response.data?.indexed ?? response.indexed;
            if (typeof indexed !== "boolean") {
                throw new Error("missing indexed boolean in memdock response");
            }
            return indexed;
        }
        catch (error) {
            this.log(`[notes] memdock index lookup failed; fallback local (${toErrorMessage(error)})`);
            return null;
        }
    }
    async requestJson(relativePath, body) {
        const baseUrl = this.baseUrl;
        if (!baseUrl) {
            throw new Error("MEMDOCK_BASE_URL is required");
        }
        const endpoint = new URL(relativePath, `${baseUrl}/`).toString();
        const headers = {
            "content-type": "application/json",
        };
        if (this.apiKey) {
            headers.authorization = `Bearer ${this.apiKey}`;
        }
        if (this.workspace) {
            headers["x-memdock-workspace"] = this.workspace;
        }
        if (this.collection) {
            headers["x-memdock-collection"] = this.collection;
        }
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), this.timeoutMs);
        try {
            const response = await this.fetchImpl(endpoint, {
                method: "POST",
                headers,
                body: JSON.stringify(body),
                signal: abort.signal,
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            return (await response.json());
        }
        finally {
            clearTimeout(timeout);
        }
    }
    warnBaseUrlMissing() {
        if (this.warnedMissingBaseUrl) {
            return;
        }
        this.warnedMissingBaseUrl = true;
        this.log("[notes] memdock selected but MEMDOCK_BASE_URL is empty; using local storage fallback");
    }
}
export function createNotesStorageAdapter(options) {
    const localOptions = toMeetingStorageOptions(options);
    if (options.backend === "memdock") {
        const memdockOptions = { ...localOptions };
        if (options.memdockBaseUrl) {
            memdockOptions.baseUrl = options.memdockBaseUrl;
        }
        if (options.memdockApiKey) {
            memdockOptions.apiKey = options.memdockApiKey;
        }
        if (options.memdockApiPath) {
            memdockOptions.apiPath = options.memdockApiPath;
        }
        if (options.memdockWorkspace) {
            memdockOptions.workspace = options.memdockWorkspace;
        }
        if (options.memdockCollection) {
            memdockOptions.collection = options.memdockCollection;
        }
        if (typeof options.memdockTimeoutMs === "number") {
            memdockOptions.timeoutMs = options.memdockTimeoutMs;
        }
        if (options.fetchImpl) {
            memdockOptions.fetchImpl = options.fetchImpl;
        }
        if (options.log) {
            memdockOptions.log = options.log;
        }
        return new MemdockNotesStorageAdapter(memdockOptions);
    }
    return new LocalMeetingStorageAdapter(localOptions);
}
function normalizeNonEmptyString(value) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}
function normalizeMemdockApiPath(value) {
    const trimmed = value?.trim();
    if (!trimmed) {
        return "/api/v1/notes";
    }
    const prefixed = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    return prefixed.replace(/\/+$/, "");
}
function toMeetingStorageOptions(options) {
    const normalized = { rootDir: options.rootDir };
    if (options.meetingsDirName) {
        normalized.meetingsDirName = options.meetingsDirName;
    }
    if (options.whispersDirName) {
        normalized.whispersDirName = options.whispersDirName;
    }
    return normalized;
}
function serializeMeetingDocument(input) {
    return {
        timestamp: input.timestamp.toISOString(),
        sourceFileName: input.sourceFileName,
        title: input.title,
        attendee: input.attendee,
        brief: input.brief,
        summary: input.summary,
        transcript: input.transcript,
    };
}
function toSafeRelativePath(notePath, indexPath) {
    if (!notePath) {
        return "";
    }
    const indexDir = indexPath.replace(/[/\\][^/\\]+$/, "");
    if (!indexDir || !notePath.startsWith(indexDir)) {
        return notePath;
    }
    const trimmed = notePath.slice(indexDir.length).replace(/^[/\\]+/, "");
    return trimmed || notePath;
}
function toErrorMessage(error) {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return String(error);
}
//# sourceMappingURL=notesStorage.js.map