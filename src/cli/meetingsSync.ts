import path from "node:path";
import { pathToFileURL } from "node:url";

import { createNodeHiDockClient } from "../nodeUsb.js";
import {
  HiDockMeetingWorkflow,
  isWhisperRecording,
  parseHiDockRecordingDate,
} from "../meetingWorkflow.js";
import { HiDockFileEntry } from "../fileList.js";
import { defaultSyncStatePath, SyncStateStore } from "../syncState.js";
import {
  createNotesStorageAdapter,
  NotesStorageBackend,
  parseNotesStorageBackend,
} from "../notesStorage.js";

export interface CliOptions {
  storageDir: string;
  storageBackend: NotesStorageBackend;
  memdockBaseUrl?: string | undefined;
  memdockApiKey?: string | undefined;
  memdockApiPath?: string | undefined;
  memdockWorkspace?: string | undefined;
  memdockCollection?: string | undefined;
  memdockTimeoutMs?: number | undefined;
  whisperModel: string;
  summaryModel: string;
  language?: string | undefined;
  prompt?: string | undefined;
  temperature?: number | undefined;
  limit?: number | undefined;
  whisperOnly: boolean;
  meetingsOnly: boolean;
  dryRun: boolean;
  showHelp: boolean;
  stateFile: string;
}

export interface SyncRunResult {
  totalFiles: number;
  selectedFiles: number;
  saved: number;
  skipped: number;
  failed: number;
}

interface RunMeetingsSyncOptions {
  options: CliOptions;
  logger?: Pick<typeof console, "log" | "error">;
}

export async function runMeetingsSync(input: RunMeetingsSyncOptions): Promise<SyncRunResult> {
  const logger = input.logger ?? console;
  const { options } = input;

  if (options.whisperOnly && options.meetingsOnly) {
    throw new Error("Use only one of --whisper-only or --meetings-only.");
  }

  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!options.dryRun && !apiKey) {
    throw new Error(
      "OPENAI_API_KEY is required. Export it before running meetings:sync.",
    );
  }

  const stateStore = new SyncStateStore(options.stateFile);

  const client = await createNodeHiDockClient();
  try {
    const { files } = await client.withConnection(() => client.listFiles());
    const state = await stateStore.read();
    const filtered = files.filter((file) => stateStore.shouldProcessFile(file, state));
    let selected = selectFiles(filtered, options);

    logger.log(
      `[HiDock Sync] start at ${new Date().toISOString()} total=${files.length} candidate=${filtered.length} selected=${selected.length} backend=${options.storageBackend} lastSuccess=${state.lastSuccessfulSyncAt ?? "never"}`,
    );

    if (selected.length === 0) {
      logger.log("[HiDock Sync] no new files to process");
      return { totalFiles: files.length, selectedFiles: 0, saved: 0, skipped: 0, failed: 0 };
    }

    if (options.dryRun) {
      for (const [index, file] of selected.entries()) {
        logger.log(
          `${String(index + 1).padStart(3)} | ${file.fileName} | ${file.fileSize} B`,
        );
      }
      return {
        totalFiles: files.length,
        selectedFiles: selected.length,
        saved: 0,
        skipped: 0,
        failed: 0,
      };
    }

    await stateStore.markRunStarted(new Date());

    const storageAdapter = createNotesStorageAdapter({
      rootDir: options.storageDir,
      backend: options.storageBackend,
      ...(options.memdockBaseUrl ? { memdockBaseUrl: options.memdockBaseUrl } : {}),
      ...(options.memdockApiKey ? { memdockApiKey: options.memdockApiKey } : {}),
      ...(options.memdockApiPath ? { memdockApiPath: options.memdockApiPath } : {}),
      ...(options.memdockWorkspace ? { memdockWorkspace: options.memdockWorkspace } : {}),
      ...(options.memdockCollection ? { memdockCollection: options.memdockCollection } : {}),
      ...(typeof options.memdockTimeoutMs === "number"
        ? { memdockTimeoutMs: options.memdockTimeoutMs }
        : {}),
      log: (message) => logger.log(message),
    });

    const workflow = new HiDockMeetingWorkflow(client, {
      apiKey,
      whisperModel: options.whisperModel,
      summaryModel: options.summaryModel,
      storageRootDir: options.storageDir,
      storageAdapter,
      ...(options.language ? { language: options.language } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(typeof options.temperature === "number"
        ? { temperature: options.temperature }
        : {}),
    });

    let saved = 0;
    let skipped = 0;
    let failed = 0;
    const processedForState: HiDockFileEntry[] = [];

    for (const [index, file] of selected.entries()) {
      const tag = `[${index + 1}/${selected.length}]`;
      logger.log(`${tag} ${file.fileName}`);
      try {
        const result = await workflow.processRecording(file, (received, total) => {
          if (received === total) {
            logger.log(`${tag} download complete (${total} bytes)`);
          }
        });

        if (result.skipped) {
          skipped += 1;
          processedForState.push(file);
          logger.log(`${tag} skipped (already indexed in ${result.indexPath})`);
        } else {
          saved += 1;
          processedForState.push(file);
          logger.log(`${tag} saved -> ${result.notePath}`);
        }
      } catch (error) {
        failed += 1;
        logger.error(`${tag} failed:`, error);
      }
    }

    if (failed === 0) {
      await stateStore.markRunCompleted({ completedAt: new Date(), processed: processedForState });
    }

    logger.log(
      `[HiDock Sync] end at ${new Date().toISOString()} saved=${saved}, skipped=${skipped}, failed=${failed}, storage=${options.storageDir}, backend=${options.storageBackend}, state=${options.stateFile}`,
    );

    return {
      totalFiles: files.length,
      selectedFiles: selected.length,
      saved,
      skipped,
      failed,
    };
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.showHelp) {
    printHelp();
    return;
  }

  const result = await runMeetingsSync({ options });
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

function selectFiles(files: HiDockFileEntry[], options: CliOptions): HiDockFileEntry[] {
  let selected = [...files].sort(compareByDateThenName);

  if (options.whisperOnly) {
    selected = selected.filter((file) => isWhisperRecording(file.fileName));
  } else if (options.meetingsOnly) {
    selected = selected.filter((file) => !isWhisperRecording(file.fileName));
  }

  if (typeof options.limit === "number" && options.limit > 0) {
    selected = selected.slice(-options.limit);
  }

  return selected;
}

function compareByDateThenName(a: HiDockFileEntry, b: HiDockFileEntry): number {
  const ta = parseHiDockRecordingDate(a.fileName)?.getTime() ?? 0;
  const tb = parseHiDockRecordingDate(b.fileName)?.getTime() ?? 0;
  if (ta !== tb) {
    return ta - tb;
  }
  return a.fileName.localeCompare(b.fileName);
}

export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): CliOptions {
  const storageDir = path.resolve(
    process.cwd(),
    env.MEETING_STORAGE_DIR ?? "./meeting-storage",
  );
  const options: CliOptions = {
    storageDir,
    storageBackend: parseNotesStorageBackend(env.HIDOCK_NOTES_BACKEND),
    memdockBaseUrl: env.MEMDOCK_BASE_URL || undefined,
    memdockApiKey: env.MEMDOCK_API_KEY || undefined,
    memdockApiPath: env.MEMDOCK_API_PATH || undefined,
    memdockWorkspace: env.MEMDOCK_WORKSPACE || undefined,
    memdockCollection: env.MEMDOCK_COLLECTION || undefined,
    memdockTimeoutMs: undefined,
    whisperModel: env.WHISPER_MODEL ?? "whisper-1",
    summaryModel: env.SUMMARY_MODEL ?? "gpt-4o-mini",
    language: env.WHISPER_LANGUAGE || undefined,
    prompt: env.WHISPER_PROMPT || undefined,
    temperature: undefined,
    limit: undefined,
    whisperOnly: false,
    meetingsOnly: false,
    dryRun: false,
    showHelp: false,
    stateFile: path.resolve(
      process.cwd(),
      env.HIDOCK_SYNC_STATE_FILE ?? defaultSyncStatePath(storageDir),
    ),
  };
  if (env.MEMDOCK_TIMEOUT_MS) {
    const parsed = Number.parseInt(env.MEMDOCK_TIMEOUT_MS, 10);
    if (Number.isInteger(parsed) && parsed > 0) {
      options.memdockTimeoutMs = parsed;
    }
  }

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    switch (arg) {
      case "--help":
      case "-h":
        options.showHelp = true;
        break;
      case "--storage": {
        options.storageDir = path.resolve(process.cwd(), readValue(argv, ++index, arg));
        if (!env.HIDOCK_SYNC_STATE_FILE) {
          options.stateFile = defaultSyncStatePath(options.storageDir);
        }
        break;
      }
      case "--state-file":
        options.stateFile = path.resolve(process.cwd(), readValue(argv, ++index, arg));
        break;
      case "--storage-backend":
        options.storageBackend = parseNotesStorageBackend(
          readValue(argv, ++index, arg),
        );
        break;
      case "--memdock-base-url":
        options.memdockBaseUrl = readValue(argv, ++index, arg);
        break;
      case "--memdock-api-key":
        options.memdockApiKey = readValue(argv, ++index, arg);
        break;
      case "--memdock-api-path":
        options.memdockApiPath = readValue(argv, ++index, arg);
        break;
      case "--memdock-workspace":
        options.memdockWorkspace = readValue(argv, ++index, arg);
        break;
      case "--memdock-collection":
        options.memdockCollection = readValue(argv, ++index, arg);
        break;
      case "--memdock-timeout-ms":
        options.memdockTimeoutMs = Number.parseInt(readValue(argv, ++index, arg), 10);
        if (!Number.isInteger(options.memdockTimeoutMs) || options.memdockTimeoutMs <= 0) {
          throw new Error("Invalid value for --memdock-timeout-ms (must be positive integer)");
        }
        break;
      case "--whisper-model":
        options.whisperModel = readValue(argv, ++index, arg);
        break;
      case "--summary-model":
        options.summaryModel = readValue(argv, ++index, arg);
        break;
      case "--language":
        options.language = readValue(argv, ++index, arg);
        break;
      case "--prompt":
        options.prompt = readValue(argv, ++index, arg);
        break;
      case "--temperature":
        options.temperature = Number.parseFloat(readValue(argv, ++index, arg));
        if (Number.isNaN(options.temperature)) {
          throw new Error("Invalid number for --temperature");
        }
        break;
      case "--limit":
        options.limit = Number.parseInt(readValue(argv, ++index, arg), 10);
        if (!Number.isInteger(options.limit) || options.limit <= 0) {
          throw new Error("Invalid value for --limit (must be positive integer)");
        }
        break;
      case "--whisper-only":
        options.whisperOnly = true;
        break;
      case "--meetings-only":
        options.meetingsOnly = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
    index += 1;
  }

  return options;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp(): void {
  console.log(`HiDock meetings sync CLI

Usage:
  npm run meetings:sync -- [options]

Options:
  --storage <dir>        Storage root directory (default: ./meeting-storage)
  --state-file <path>    Sync state file path (default: <storage>/.hidock-sync-state.json)
  --storage-backend <id> Storage backend: local|memdock (default: local)
  --memdock-base-url <url>      Memdock API base URL (for memdock backend)
  --memdock-api-key <token>     Memdock bearer token (optional)
  --memdock-api-path <path>     Memdock notes API path prefix (default: /api/v1/notes)
  --memdock-workspace <name>    Memdock workspace header override (optional)
  --memdock-collection <name>   Memdock collection header override (optional)
  --memdock-timeout-ms <n>      Memdock request timeout in ms (default: 10000)
  --whisper-model <id>   Whisper model (default: whisper-1)
  --summary-model <id>   Summary model (default: gpt-4o-mini)
  --language <code>      Whisper language hint
  --prompt <text>        Whisper prompt
  --temperature <n>      Whisper temperature
  --limit <n>            Process only newest n files
  --whisper-only         Process only Whsp recordings
  --meetings-only        Process only non-Whsp recordings
  --dry-run              List selected files without transcribing
  -h, --help             Show this help

Required env:
  OPENAI_API_KEY         Needed unless --dry-run

Optional env:
  HIDOCK_NOTES_BACKEND   local|memdock (default: local)
  MEMDOCK_BASE_URL       Memdock API base URL (required for memdock backend)
  MEMDOCK_API_KEY        Memdock bearer token (optional)
  MEMDOCK_API_PATH       Memdock notes API path prefix (default: /api/v1/notes)
  MEMDOCK_WORKSPACE      Memdock workspace header override (optional)
  MEMDOCK_COLLECTION     Memdock collection header override (optional)
  MEMDOCK_TIMEOUT_MS     Memdock request timeout ms (default: 10000)
`);
}

function isDirectRun(): boolean {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return false;
  }
  return pathToFileURL(scriptPath).href === import.meta.url;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
