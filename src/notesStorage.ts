import {
  DocumentKind,
  MeetingDocumentInput,
  MeetingStorage,
  MeetingStorageOptions,
  SavedMeetingDocument,
} from "./meetingStorage.js";

export interface NotesStorageAdapter {
  saveMeeting(input: MeetingDocumentInput): Promise<SavedMeetingDocument>;
  saveWhisper(input: MeetingDocumentInput): Promise<SavedMeetingDocument>;
  isIndexed(sourceFileName: string, kind: DocumentKind): Promise<boolean>;
  getIndexPath(kind: DocumentKind): string;
}

export type NotesStorageBackend = "local" | "memdock";

export function parseNotesStorageBackend(
  value: string | undefined,
): NotesStorageBackend {
  const normalized = value?.trim().toLowerCase() ?? "local";
  if (normalized === "local" || normalized.length === 0) {
    return "local";
  }
  if (normalized === "memdock") {
    return "memdock";
  }
  throw new Error(
    `Invalid value for storage backend: ${value ?? "(empty)"} (expected local|memdock)`,
  );
}

export class LocalMeetingStorageAdapter implements NotesStorageAdapter {
  private readonly storage: MeetingStorage;

  constructor(options: MeetingStorageOptions) {
    this.storage = new MeetingStorage(options);
  }

  saveMeeting(input: MeetingDocumentInput): Promise<SavedMeetingDocument> {
    return this.storage.saveMeeting(input);
  }

  saveWhisper(input: MeetingDocumentInput): Promise<SavedMeetingDocument> {
    return this.storage.saveWhisper(input);
  }

  isIndexed(sourceFileName: string, kind: DocumentKind): Promise<boolean> {
    return this.storage.isIndexed(sourceFileName, kind);
  }

  getIndexPath(kind: DocumentKind): string {
    return this.storage.getIndexPath(kind);
  }
}

export interface MemdockNotesStorageOptions extends MeetingStorageOptions {
  baseUrl?: string;
  apiKey?: string;
  apiPath?: string;
  workspace?: string;
  collection?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

interface MemdockIsIndexedResponse {
  indexed?: boolean;
  data?: {
    indexed?: boolean;
  };
}

interface MemdockSaveResponse {
  notePath?: string;
  indexPath?: string;
  relativeNotePath?: string;
  skipped?: boolean;
  data?: {
    notePath?: string;
    indexPath?: string;
    relativeNotePath?: string;
    skipped?: boolean;
  };
}

const DEFAULT_MEMDOCK_TIMEOUT_MS = 10000;

export class MemdockNotesStorageAdapter implements NotesStorageAdapter {
  private readonly fallback: LocalMeetingStorageAdapter;
  private readonly baseUrl: string | null;
  private readonly apiKey: string | null;
  private readonly apiPath: string;
  private readonly workspace: string | null;
  private readonly collection: string | null;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly log: (message: string) => void;
  private warnedMissingBaseUrl = false;

  constructor(options: MemdockNotesStorageOptions) {
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

  async saveMeeting(input: MeetingDocumentInput): Promise<SavedMeetingDocument> {
    const saved = await this.trySave("meeting", input);
    if (saved) {
      return saved;
    }
    return this.fallback.saveMeeting(input);
  }

  async saveWhisper(input: MeetingDocumentInput): Promise<SavedMeetingDocument> {
    const saved = await this.trySave("whisper", input);
    if (saved) {
      return saved;
    }
    return this.fallback.saveWhisper(input);
  }

  async isIndexed(sourceFileName: string, kind: DocumentKind): Promise<boolean> {
    const indexed = await this.tryIsIndexed(sourceFileName, kind);
    if (typeof indexed === "boolean") {
      return indexed;
    }
    return this.fallback.isIndexed(sourceFileName, kind);
  }

  getIndexPath(kind: DocumentKind): string {
    if (!this.baseUrl) {
      return this.fallback.getIndexPath(kind);
    }
    const workspace = this.workspace ?? "default";
    const collection = this.collection ?? "notes";
    const indexName = kind === "meeting" ? "meetingindex.md" : "whisperindex.md";
    return `memdock://${workspace}/${collection}/${indexName}`;
  }

  private async trySave(
    kind: DocumentKind,
    input: MeetingDocumentInput,
  ): Promise<SavedMeetingDocument | null> {
    if (!this.baseUrl) {
      this.warnBaseUrlMissing();
      return null;
    }

    try {
      const response = await this.requestJson<MemdockSaveResponse>(
        `${this.apiPath}/save`,
        {
          kind,
          document: serializeMeetingDocument(input),
          sourceFileName: input.sourceFileName,
        },
      );
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
        relativeNotePath:
          payload.relativeNotePath ??
          toSafeRelativePath(payload.notePath ?? "", payload.indexPath),
        skipped: payload.skipped ?? false,
      };
    } catch (error) {
      this.log(
        `[notes] memdock save failed for ${kind}; fallback local (${toErrorMessage(error)})`,
      );
      return null;
    }
  }

  private async tryIsIndexed(
    sourceFileName: string,
    kind: DocumentKind,
  ): Promise<boolean | null> {
    if (!this.baseUrl) {
      this.warnBaseUrlMissing();
      return null;
    }

    try {
      const response = await this.requestJson<MemdockIsIndexedResponse>(
        `${this.apiPath}/is-indexed`,
        { sourceFileName, kind },
      );
      const indexed = response.data?.indexed ?? response.indexed;
      if (typeof indexed !== "boolean") {
        throw new Error("missing indexed boolean in memdock response");
      }
      return indexed;
    } catch (error) {
      this.log(
        `[notes] memdock index lookup failed; fallback local (${toErrorMessage(error)})`,
      );
      return null;
    }
  }

  private async requestJson<T>(relativePath: string, body: unknown): Promise<T> {
    const baseUrl = this.baseUrl;
    if (!baseUrl) {
      throw new Error("MEMDOCK_BASE_URL is required");
    }

    const endpoint = new URL(relativePath, `${baseUrl}/`).toString();
    const headers: Record<string, string> = {
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
      return (await response.json()) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private warnBaseUrlMissing(): void {
    if (this.warnedMissingBaseUrl) {
      return;
    }
    this.warnedMissingBaseUrl = true;
    this.log(
      "[notes] memdock selected but MEMDOCK_BASE_URL is empty; using local storage fallback",
    );
  }
}

export interface NotesStorageAdapterFactoryOptions extends MeetingStorageOptions {
  backend?: NotesStorageBackend;
  memdockBaseUrl?: string;
  memdockApiKey?: string;
  memdockApiPath?: string;
  memdockWorkspace?: string;
  memdockCollection?: string;
  memdockTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}

export function createNotesStorageAdapter(
  options: NotesStorageAdapterFactoryOptions,
): NotesStorageAdapter {
  const localOptions = toMeetingStorageOptions(options);
  if (options.backend === "memdock") {
    const memdockOptions: MemdockNotesStorageOptions = { ...localOptions };
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

function normalizeNonEmptyString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeMemdockApiPath(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "/api/v1/notes";
  }
  const prefixed = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return prefixed.replace(/\/+$/, "");
}

function toMeetingStorageOptions(options: MeetingStorageOptions): MeetingStorageOptions {
  const normalized: MeetingStorageOptions = { rootDir: options.rootDir };
  if (options.meetingsDirName) {
    normalized.meetingsDirName = options.meetingsDirName;
  }
  if (options.whispersDirName) {
    normalized.whispersDirName = options.whispersDirName;
  }
  if (typeof options.tierHotMaxAgeDays === "number") {
    normalized.tierHotMaxAgeDays = options.tierHotMaxAgeDays;
  }
  if (typeof options.tierWarmMaxAgeDays === "number") {
    normalized.tierWarmMaxAgeDays = options.tierWarmMaxAgeDays;
  }
  if (options.now) {
    normalized.now = options.now;
  }
  return normalized;
}

function serializeMeetingDocument(input: MeetingDocumentInput): {
  timestamp: string;
  sourceFileName: string;
  title: string;
  attendee: string;
  brief: string;
  summary: string;
  transcript: string;
} {
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

function toSafeRelativePath(notePath: string, indexPath: string): string {
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}
