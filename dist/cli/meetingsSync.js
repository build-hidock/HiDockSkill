import path from "node:path";
import { pathToFileURL } from "node:url";
import { createNodeHiDockClient } from "../nodeUsb.js";
import { HiDockMeetingWorkflow, isWhisperRecording, parseHiDockRecordingDate, } from "../meetingWorkflow.js";
import { defaultSyncStatePath, SyncStateStore } from "../syncState.js";
import { createNotesStorageAdapter, parseNotesStorageBackend, } from "../notesStorage.js";
const WEIGHT_DOWNLOAD = 15;
const WEIGHT_TRANSCRIBE = 70;
const WEIGHT_SUMMARIZE = 15;
const PER_FILE_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes per file (supports 2h+ recordings)
function withTimeout(promise, ms, label) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timeout after ${ms / 1000}s: ${label}`)), ms);
        promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
    });
}
export async function runMeetingsSync(input) {
    const logger = input.logger ?? console;
    const { options } = input;
    const onProgress = input.onProgress ?? (() => { });
    if (options.whisperOnly && options.meetingsOnly) {
        throw new Error("Use only one of --whisper-only or --meetings-only.");
    }
    const stateStore = new SyncStateStore(options.stateFile);
    const client = await createNodeHiDockClient();
    try {
        const { files } = await client.withConnection(() => client.listFiles());
        const state = await stateStore.read();
        const filtered = files.filter((file) => stateStore.shouldProcessFile(file, state));
        let selected = selectFiles(filtered, options);
        logger.log(`[HiDock Sync] start at ${new Date().toISOString()} total=${files.length} candidate=${filtered.length} selected=${selected.length} backend=${options.storageBackend} lastSuccess=${state.lastSuccessfulSyncAt ?? "never"}`);
        if (selected.length === 0) {
            logger.log("[HiDock Sync] no new files to process");
            return { totalFiles: files.length, selectedFiles: 0, saved: 0, skipped: 0, failed: 0, savedSources: [] };
        }
        if (options.dryRun) {
            for (const [index, file] of selected.entries()) {
                logger.log(`${String(index + 1).padStart(3)} | ${file.fileName} | ${file.fileSize} B`);
            }
            return {
                totalFiles: files.length,
                selectedFiles: selected.length,
                saved: 0,
                skipped: 0,
                failed: 0,
                savedSources: [],
            };
        }
        await stateStore.markRunStarted(new Date());
        // Emit all files as pending so the UI shows the full queue
        for (const [index, file] of selected.entries()) {
            onProgress({ phase: "processing", total: selected.length, current: 0, fileName: file.fileName, status: "pending", progressPercent: 0 });
        }
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
            whisperModel: options.whisperModel,
            summaryModel: options.summaryModel,
            ollamaHost: options.ollamaHost,
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
        const savedSources = [];
        const processedForState = [];
        // Pipeline: downloads run continuously (never blocked by processing).
        // Processing is chained sequentially but decoupled from the download loop.
        let processingChain = Promise.resolve();
        for (const [index, file] of selected.entries()) {
            const tag = `[${index + 1}/${selected.length}]`;
            logger.log(`${tag} ${file.fileName}`);
            onProgress({ phase: "processing", total: selected.length, current: index + 1, fileName: file.fileName, status: "downloading", progressPercent: 0 });
            try {
                // Stage 1: Download from USB (sequential, never blocked by processing)
                let lastEmittedDownloadPct = -1;
                const downloaded = await withTimeout(workflow.downloadRecording(file, (received, total) => {
                    const downloadFraction = total > 0 ? received / total : 0;
                    const filePct = Math.round(downloadFraction * WEIGHT_DOWNLOAD);
                    if (filePct !== lastEmittedDownloadPct) {
                        lastEmittedDownloadPct = filePct;
                        onProgress({ phase: "processing", total: selected.length, current: index + 1, fileName: file.fileName, status: "downloading", progressPercent: filePct });
                    }
                    if (received === total) {
                        logger.log(`${tag} download complete (${total} bytes)`);
                    }
                }), PER_FILE_TIMEOUT_MS, `download ${file.fileName}`);
                if (downloaded.skipped) {
                    skipped += 1;
                    processedForState.push(file);
                    await stateStore.markFileProcessed(file);
                    logger.log(`${tag} skipped (already indexed in ${downloaded.indexPath})`);
                    onProgress({ phase: "processing", total: selected.length, current: index + 1, fileName: file.fileName, status: "skipped", progressPercent: 100 });
                    continue;
                }
                // Stage 2: Chain transcribe + summarize + save (sequential processing,
                // but never blocks the download loop — next download starts immediately)
                const capturedFile = file;
                const capturedIndex = index;
                const capturedTag = tag;
                processingChain = processingChain.then(async () => {
                    onProgress({ phase: "processing", total: selected.length, current: capturedIndex + 1, fileName: capturedFile.fileName, status: "transcribing", progressPercent: WEIGHT_DOWNLOAD });
                    try {
                        const result = await withTimeout(workflow.processDownloadedRecording(downloaded, (stage) => {
                            if (stage === "summarizing") {
                                onProgress({ phase: "processing", total: selected.length, current: capturedIndex + 1, fileName: capturedFile.fileName, status: "summarizing", progressPercent: WEIGHT_DOWNLOAD + WEIGHT_TRANSCRIBE });
                            }
                        }), PER_FILE_TIMEOUT_MS, `process ${capturedFile.fileName}`);
                        if (result.skipped) {
                            skipped += 1;
                            processedForState.push(capturedFile);
                            await stateStore.markFileProcessed(capturedFile);
                            logger.log(`${capturedTag} skipped (already indexed in ${result.indexPath})`);
                            onProgress({ phase: "processing", total: selected.length, current: capturedIndex + 1, fileName: capturedFile.fileName, status: "skipped", progressPercent: 100 });
                        }
                        else {
                            saved += 1;
                            savedSources.push(capturedFile.fileName);
                            processedForState.push(capturedFile);
                            await stateStore.markFileProcessed(capturedFile);
                            logger.log(`${capturedTag} saved -> ${result.notePath}`);
                            onProgress({ phase: "processing", total: selected.length, current: capturedIndex + 1, fileName: capturedFile.fileName, status: "saved", progressPercent: 100 });
                        }
                    }
                    catch (error) {
                        failed += 1;
                        // DO NOT mark failed files as processed — that causes them to be
                        // permanently skipped on subsequent syncs (state.processedFiles
                        // never expires). The 2026-03-12 lesson "save state incrementally
                        // per item" applies to SUCCESSES only; failures must remain
                        // un-marked so the next sync attempt retries them. The user's
                        // today recording was lost to this bug for hours.
                        logger.error(`${capturedTag} failed:`, error);
                        onProgress({ phase: "processing", total: selected.length, current: capturedIndex + 1, fileName: capturedFile.fileName, status: "failed", progressPercent: 100, error: String(error instanceof Error ? error.message : error) });
                    }
                });
            }
            catch (error) {
                failed += 1;
                // Same as inner catch: failures must NOT be marked processed.
                logger.error(`${tag} failed:`, error);
                onProgress({ phase: "processing", total: selected.length, current: index + 1, fileName: file.fileName, status: "failed", progressPercent: 100, error: String(error instanceof Error ? error.message : error) });
            }
        }
        // Wait for all processing to complete
        await processingChain;
        onProgress({ phase: "done", total: selected.length, current: selected.length, fileName: "", status: "saved", progressPercent: 100 });
        // Mark run completed (files already saved incrementally, this updates lastSuccessfulSyncAt)
        await stateStore.markRunCompleted({ completedAt: new Date(), processed: processedForState });
        logger.log(`[HiDock Sync] end at ${new Date().toISOString()} saved=${saved}, skipped=${skipped}, failed=${failed}, storage=${options.storageDir}, backend=${options.storageBackend}, state=${options.stateFile}`);
        return {
            totalFiles: files.length,
            selectedFiles: selected.length,
            saved,
            skipped,
            failed,
            savedSources,
        };
    }
    finally {
        await client.close();
    }
}
async function main() {
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
function selectFiles(files, options) {
    let selected = [...files].sort(compareByDateThenName);
    if (options.whisperOnly) {
        selected = selected.filter((file) => isWhisperRecording(file.fileName));
    }
    else if (options.meetingsOnly) {
        selected = selected.filter((file) => !isWhisperRecording(file.fileName));
    }
    if (typeof options.limit === "number" && options.limit > 0) {
        selected = selected.slice(0, options.limit);
    }
    return selected;
}
function compareByDateThenName(a, b) {
    const ta = parseHiDockRecordingDate(a.fileName)?.getTime() ?? 0;
    const tb = parseHiDockRecordingDate(b.fileName)?.getTime() ?? 0;
    if (ta !== tb) {
        return tb - ta; // newest first
    }
    return b.fileName.localeCompare(a.fileName);
}
const DEFAULT_STORAGE_DIR = "/Users/seansong/seanslab/Obsidian/OpenClawWorkspace/MeetingNotes";
export function parseArgs(argv, env = process.env) {
    const storageDir = path.resolve(process.cwd(), env.MEETING_STORAGE_DIR ?? DEFAULT_STORAGE_DIR);
    const options = {
        storageDir,
        storageBackend: parseNotesStorageBackend(env.HIDOCK_NOTES_BACKEND),
        memdockBaseUrl: env.MEMDOCK_BASE_URL || undefined,
        memdockApiKey: env.MEMDOCK_API_KEY || undefined,
        memdockApiPath: env.MEMDOCK_API_PATH || undefined,
        memdockWorkspace: env.MEMDOCK_WORKSPACE || undefined,
        memdockCollection: env.MEMDOCK_COLLECTION || undefined,
        memdockTimeoutMs: undefined,
        whisperModel: env.WHISPER_MODEL ?? "moonshine",
        summaryModel: env.SUMMARY_MODEL ?? "mlx-community/Qwen3.5-9B-4bit",
        ollamaHost: env.LLM_HOST ?? env.OLLAMA_HOST ?? "http://localhost:8080",
        language: (env.MOONSHINE_LANGUAGE ?? env.WHISPER_LANGUAGE) || undefined,
        prompt: env.WHISPER_PROMPT || undefined,
        temperature: undefined,
        limit: undefined,
        whisperOnly: false,
        meetingsOnly: false,
        dryRun: false,
        showHelp: false,
        stateFile: path.resolve(process.cwd(), env.HIDOCK_SYNC_STATE_FILE ?? defaultSyncStatePath(storageDir)),
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
                options.storageBackend = parseNotesStorageBackend(readValue(argv, ++index, arg));
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
            case "--ollama-host":
                options.ollamaHost = readValue(argv, ++index, arg);
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
function readValue(argv, index, flag) {
    const value = argv[index];
    if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${flag}`);
    }
    return value;
}
function printHelp() {
    console.log(`HiDock meetings sync CLI

Usage:
  npm run meetings:sync -- [options]

Options:
  --storage <dir>        Storage root directory (default: /Users/seansong/seanslab/Obsidian/OpenClawWorkspace/MeetingNotes)
  --state-file <path>    Sync state file path (default: <storage>/.hidock-sync-state.json)
  --storage-backend <id> Storage backend: local|memdock (default: local)
  --memdock-base-url <url>      Memdock API base URL (for memdock backend)
  --memdock-api-key <token>     Memdock bearer token (optional)
  --memdock-api-path <path>     Memdock notes API path prefix (default: /api/v1/notes)
  --memdock-workspace <name>    Memdock workspace header override (optional)
  --memdock-collection <name>   Memdock collection header override (optional)
  --memdock-timeout-ms <n>      Memdock request timeout in ms (default: 10000)
  --whisper-model <id>   Transcription model name (default: moonshine)
  --summary-model <id>   Summary model (default: qwen3.5:9b)
  --ollama-host <url>    Ollama API host (default: http://localhost:11434)
  --language <code>      Transcription language hint
  --prompt <text>        Whisper prompt (legacy, unused with moonshine)
  --temperature <n>      Whisper temperature (legacy, unused with moonshine)
  --limit <n>            Process only newest n files
  --whisper-only         Process only Whsp recordings
  --meetings-only        Process only non-Whsp recordings
  --dry-run              List selected files without transcribing
  -h, --help             Show this help

Optional env:
  OLLAMA_HOST            Ollama API host (default: http://localhost:11434)
  MOONSHINE_LANGUAGE     Transcription language hint (e.g. en)
  HIDOCK_NOTES_BACKEND   local|memdock (default: local)
  MEMDOCK_BASE_URL       Memdock API base URL (required for memdock backend)
  MEMDOCK_API_KEY        Memdock bearer token (optional)
  MEMDOCK_API_PATH       Memdock notes API path prefix (default: /api/v1/notes)
  MEMDOCK_WORKSPACE      Memdock workspace header override (optional)
  MEMDOCK_COLLECTION     Memdock collection header override (optional)
  MEMDOCK_TIMEOUT_MS     Memdock request timeout ms (default: 10000)
`);
}
function isDirectRun() {
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
//# sourceMappingURL=meetingsSync.js.map