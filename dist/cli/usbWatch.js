import { execFile } from "node:child_process";
import { platform } from "node:os";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createHiDockConnectionMonitor, createNodeHiDockClient, detectHiDockPresence, } from "../nodeUsb.js";
import { parseArgs as parseMeetingsSyncArgs, runMeetingsSync } from "./meetingsSync.js";
import { SyncStateStore } from "../syncState.js";
import { SyncCoordinator } from "../syncCoordinator.js";
import { buildGalaxyData } from "../galaxyData.js";
import { compileWiki } from "../wikiCompiler.js";
import { buildSearchIndex } from "../wikiSearch.js";
import path from "node:path";
import { startGalaxyServer } from "../galaxyServer.js";
const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_FILE_POLL_MS = 15_000; // check for new recordings every 15s
const DEFAULT_ACTIVE_WINDOW_MINUTES = 5;
const DEFAULT_OPENCLAW_BIN = "openclaw";
const DEFAULT_SYNC_DEBOUNCE_MS = 1500;
const execFileAsync = promisify(execFile);
const defaultOpenClawExec = async (file, args) => {
    const result = await execFileAsync(file, [...args]);
    return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
    };
};
async function main() {
    const options = parseUsbWatchArgs(process.argv.slice(2));
    if (options.showHelp) {
        printHelp();
        return;
    }
    const log = (message) => {
        console.log(`[HiDock USB Watch] ${message}`);
    };
    const sendSlackMessage = options.slackTarget
        ? createOpenClawSlackForwarder({
            target: options.slackTarget,
            threadId: options.slackThreadId,
            activityTarget: options.slackActivityTarget,
            activityUserId: options.slackActivityUserId,
            activeWindowMinutes: options.activeWindowMinutes,
            openClawBin: options.openClawBin,
        })
        : undefined;
    const syncCoordinator = new SyncCoordinator({
        debounceMs: options.syncDebounceMs,
        log: (message) => log(`[sync] ${message}`),
    });
    const syncProgressItems = [];
    function handleSyncProgress(event) {
        if (event.phase === "processing") {
            // Find or create item
            let item = syncProgressItems.find((i) => i.fileName === event.fileName);
            if (!item) {
                item = { fileName: event.fileName, status: event.status, progressPercent: 0 };
                syncProgressItems.push(item);
            }
            item.status = event.status;
            item.progressPercent = Math.max(item.progressPercent, event.progressPercent);
            if (event.error)
                item.error = event.error;
        }
        if (galaxyServerHandle) {
            galaxyServerHandle.updateProgress({
                phase: event.phase,
                total: event.total,
                current: event.current,
                items: [...syncProgressItems],
            });
        }
    }
    const AUTO_SYNC_RETRIES = 3;
    const AUTO_SYNC_RETRY_DELAY_MS = 5_000;
    const runAutoSync = options.autoSync
        ? async () => {
            syncProgressItems.length = 0;
            for (let attempt = 0; attempt < AUTO_SYNC_RETRIES; attempt++) {
                try {
                    const syncOptions = parseMeetingsSyncArgs([]);
                    const result = await runMeetingsSync({ options: syncOptions, logger: console, onProgress: handleSyncProgress });
                    const saved = result?.saved ?? 0;
                    const failed = result?.failed ?? 0;
                    if (saved > 0 || failed > 0) {
                        const parts = [];
                        if (saved > 0)
                            parts.push(`${saved} synced`);
                        if (failed > 0)
                            parts.push(`${failed} failed`);
                        log(`[sync] complete: ${parts.join(", ")}`);
                    }
                    else {
                        log(`[sync] complete: all recordings up to date`);
                    }
                    await updateGalaxyWithData({
                        storageDir: syncOptions.storageDir,
                        newSources: result?.savedSources ?? [],
                        log,
                    });
                    // Wiki compilation for newly synced notes
                    const savedSources = result?.savedSources ?? [];
                    if (savedSources.length > 0) {
                        try {
                            log(`[wiki] compiling ${savedSources.length} note(s)`);
                            const wikiResult = await compileWiki({
                                storageDir: syncOptions.storageDir,
                                llmHost: syncOptions.ollamaHost,
                                llmModel: syncOptions.summaryModel,
                                log: (msg) => log(`[wiki] ${msg}`),
                            }, savedSources);
                            log(`[wiki] done: ${wikiResult.pagesWritten} written, ${wikiResult.pagesUpdated} updated`);
                            // Rebuild search index
                            const wikiDir = path.join(syncOptions.storageDir, "wiki");
                            const searchIndex = await buildSearchIndex(wikiDir);
                            if (galaxyServerHandle) {
                                galaxyServerHandle.updateWikiIndex(searchIndex);
                            }
                        }
                        catch (wikiError) {
                            log(`[wiki] compilation failed: ${toErrorMessage(wikiError)}`);
                        }
                    }
                    return; // success — exit retry loop
                }
                catch (error) {
                    const msg = toErrorMessage(error);
                    if (attempt < AUTO_SYNC_RETRIES - 1 && detectHiDockPresence()) {
                        log(`[sync] failed (attempt ${attempt + 1}/${AUTO_SYNC_RETRIES}): ${msg} — retrying in ${AUTO_SYNC_RETRY_DELAY_MS / 1000}s`);
                        await new Promise((r) => setTimeout(r, AUTO_SYNC_RETRY_DELAY_MS));
                    }
                    else {
                        log(`[sync] failed: ${msg}`);
                        try {
                            const syncOptions = parseMeetingsSyncArgs([]);
                            await updateGalaxyWithData({ storageDir: syncOptions.storageDir, newSources: [], log });
                        }
                        catch { /* ignore */ }
                    }
                }
            }
        }
        : undefined;
    console.log(`[HiDock USB Watch] starting (intervalMs=${options.intervalMs}, emitOnStartupIfConnected=${options.emitOnStartupIfConnected}, slackForward=${sendSlackMessage ? "enabled" : "disabled"}, threadRouting=${options.slackThreadId ? "enabled" : "disabled"}, autoSync=${options.autoSync ? "enabled" : "disabled"}, syncDebounceMs=${options.syncDebounceMs}, activeWindowMinutes=${options.activeWindowMinutes})`);
    const handlerOptions = { log };
    if (sendSlackMessage) {
        handlerOptions.sendSlackMessage = sendSlackMessage;
    }
    if (runAutoSync) {
        handlerOptions.onAutoSync = () => syncCoordinator.trigger(runAutoSync);
    }
    const onPluggedIn = createUsbWatchPlugInHandler(handlerOptions);
    const onUnplugged = () => {
        log("HiDock device disconnected");
        sendDesktopNotification("HiDock P1", "Device disconnected.", log);
    };
    const monitor = createHiDockConnectionMonitor({
        intervalMs: options.intervalMs,
        emitOnStartupIfConnected: options.emitOnStartupIfConnected,
        onPluggedIn,
        onUnplugged,
        log,
    });
    monitor.start();
    // Start galaxy server immediately with existing data (don't wait for device plug-in)
    if (!galaxyServerHandle) {
        (async () => {
            try {
                let initialData;
                try {
                    const syncOptions = parseMeetingsSyncArgs([]);
                    initialData = await buildGalaxyData({ storageDir: syncOptions.storageDir });
                    if (initialData.nodes.length === 0)
                        initialData = undefined;
                }
                catch { /* no existing data */ }
                galaxyServerHandle = await startGalaxyServer({
                    port: DEFAULT_GALAXY_PORT,
                    ...(initialData ? { graphData: initialData } : {}),
                    log: (message) => log(`[galaxy] ${message}`),
                });
                if (initialData) {
                    log(`[galaxy] started with ${initialData.nodes.length} existing notes`);
                }
                // Pre-load wiki search index
                try {
                    const syncOptions = parseMeetingsSyncArgs([]);
                    const wikiDir = path.join(syncOptions.storageDir, "wiki");
                    const wikiSearchIdx = await buildSearchIndex(wikiDir);
                    if (wikiSearchIdx.documents.length > 0) {
                        galaxyServerHandle.updateWikiIndex(wikiSearchIdx);
                        log(`[galaxy] wiki search index: ${wikiSearchIdx.documents.length} documents`);
                    }
                }
                catch { /* no wiki yet */ }
            }
            catch (error) {
                const msg = toErrorMessage(error);
                if (!msg.includes("EADDRINUSE")) {
                    log(`[galaxy] failed to start server: ${msg}`);
                }
            }
        })();
    }
    // Periodic file-list poll: lists files on the connected device every 15s for
    // two purposes (independent — both run regardless of --no-auto-sync):
    //   1. Push the file list to the galaxy server so the list view can show
    //      pending recordings labeled with the recorder name (P1/H1E/H1).
    //   2. If autoSync is enabled, trigger a sync when new files appear since
    //      the last baseline.
    // The USB monitor only fires on connect/disconnect transitions; this catches
    // recordings made while the device stays plugged in.
    let filePollTimer = null;
    let filePollBusy = false;
    const syncOptions = parseMeetingsSyncArgs([]);
    const stateStore = new SyncStateStore(syncOptions.stateFile);
    let lastKnownFileCount = -1;
    filePollTimer = setInterval(() => {
        if (filePollBusy)
            return;
        if (syncCoordinator.isBusy())
            return; // sync in progress — skip poll
        if (!detectHiDockPresence())
            return; // device not connected
        filePollBusy = true;
        (async () => {
            try {
                const client = await createNodeHiDockClient();
                try {
                    const { files } = await client.withConnection(() => client.listFiles());
                    const state = await stateStore.read();
                    const newFiles = files.filter((f) => stateStore.shouldProcessFile(f, state));
                    // Push the device file list to the galaxy server so the list view
                    // can show pending recordings labeled with the recorder name.
                    if (galaxyServerHandle) {
                        const deviceName = detectHiDockPresence() ?? "Unknown HiDock";
                        const rawEntries = files.map((f) => ({
                            fileName: f.fileName,
                            fileSize: f.fileSize,
                            modifiedAt: parseHiDockFileNameToIso(f.fileName),
                            deviceName,
                        }));
                        galaxyServerHandle.setDeviceFiles(rawEntries);
                    }
                    if (runAutoSync) {
                        if (lastKnownFileCount < 0) {
                            // First poll — just record baseline, don't trigger sync
                            lastKnownFileCount = files.length;
                        }
                        else if (newFiles.length > 0) {
                            log(`[file-poll] ${newFiles.length} new recording(s) detected, triggering sync`);
                            lastKnownFileCount = files.length;
                            syncCoordinator.trigger(runAutoSync);
                        }
                    }
                }
                finally {
                    await client.close();
                }
            }
            catch (error) {
                // Device busy / not ready / libusb claim failure — log so the user can see
                // why no auto-sync is happening. Common causes: LIBUSB_ERROR_BUSY (another
                // process holding device), LIBUSB_ERROR_NO_DEVICE (multi-device confusion),
                // LIBUSB_ERROR_ACCESS (permissions), or no HiDock currently enumerated.
                const reason = toErrorMessage(error);
                // Only log unexpected errors — silently skip when device is genuinely absent.
                if (!reason.includes("No HiDock USB device found")) {
                    log(`[file-poll] skipped: ${reason}`);
                }
            }
        })().finally(() => { filePollBusy = false; });
    }, DEFAULT_FILE_POLL_MS);
    const shutdown = (signal) => {
        console.log(`[HiDock USB Watch] stopping (${signal})`);
        monitor.stop();
        if (filePollTimer)
            clearInterval(filePollTimer);
        process.exit(0);
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}
export function parseUsbWatchArgs(argv, env = process.env) {
    const options = {
        intervalMs: DEFAULT_INTERVAL_MS,
        emitOnStartupIfConnected: true,
        slackTarget: readNonEmptyString(env.HIDOCK_USB_WATCH_SLACK_TARGET),
        slackThreadId: readNonEmptyString(env.HIDOCK_USB_WATCH_SLACK_THREAD_ID),
        slackActivityTarget: readNonEmptyString(env.HIDOCK_USB_WATCH_SLACK_ACTIVITY_TARGET),
        slackActivityUserId: readNonEmptyString(env.HIDOCK_USB_WATCH_SLACK_ACTIVITY_USER_ID),
        activeWindowMinutes: readPositiveInt(env.HIDOCK_USB_WATCH_ACTIVE_WINDOW_MINUTES) ??
            DEFAULT_ACTIVE_WINDOW_MINUTES,
        openClawBin: readNonEmptyString(env.HIDOCK_USB_WATCH_OPENCLAW_BIN) ??
            DEFAULT_OPENCLAW_BIN,
        autoSync: env.HIDOCK_USB_WATCH_AUTO_SYNC?.trim() !== "0",
        syncDebounceMs: readPositiveInt(env.HIDOCK_USB_WATCH_SYNC_DEBOUNCE_MS) ??
            DEFAULT_SYNC_DEBOUNCE_MS,
        showHelp: false,
    };
    let index = 0;
    while (index < argv.length) {
        const arg = argv[index];
        switch (arg) {
            case "--help":
            case "-h":
                options.showHelp = true;
                break;
            case "--interval-ms": {
                const raw = readValue(argv, ++index, arg);
                const parsed = Number.parseInt(raw, 10);
                if (!Number.isInteger(parsed) || parsed <= 0) {
                    throw new Error("Invalid value for --interval-ms (must be positive integer)");
                }
                options.intervalMs = parsed;
                break;
            }
            case "--emit-on-startup":
                options.emitOnStartupIfConnected = true;
                break;
            case "--no-emit-on-startup":
                options.emitOnStartupIfConnected = false;
                break;
            case "--slack-target": {
                const raw = readValue(argv, ++index, arg);
                const parsed = readNonEmptyString(raw);
                if (!parsed) {
                    throw new Error("Invalid value for --slack-target (must be non-empty)");
                }
                options.slackTarget = parsed;
                break;
            }
            case "--slack-thread-id": {
                const raw = readValue(argv, ++index, arg);
                const parsed = readNonEmptyString(raw);
                if (!parsed) {
                    throw new Error("Invalid value for --slack-thread-id (must be non-empty)");
                }
                options.slackThreadId = parsed;
                break;
            }
            case "--slack-activity-target": {
                const raw = readValue(argv, ++index, arg);
                const parsed = readNonEmptyString(raw);
                if (!parsed) {
                    throw new Error("Invalid value for --slack-activity-target (must be non-empty)");
                }
                options.slackActivityTarget = parsed;
                break;
            }
            case "--slack-activity-user-id": {
                const raw = readValue(argv, ++index, arg);
                const parsed = readNonEmptyString(raw);
                if (!parsed) {
                    throw new Error("Invalid value for --slack-activity-user-id (must be non-empty)");
                }
                options.slackActivityUserId = parsed;
                break;
            }
            case "--active-window-minutes": {
                const raw = readValue(argv, ++index, arg);
                const parsed = Number.parseInt(raw, 10);
                if (!Number.isInteger(parsed) || parsed <= 0) {
                    throw new Error("Invalid value for --active-window-minutes (must be positive integer)");
                }
                options.activeWindowMinutes = parsed;
                break;
            }
            case "--no-slack-forward":
                options.slackTarget = null;
                options.slackThreadId = null;
                break;
            case "--openclaw-bin": {
                const raw = readValue(argv, ++index, arg);
                const parsed = readNonEmptyString(raw);
                if (!parsed) {
                    throw new Error("Invalid value for --openclaw-bin (must be non-empty)");
                }
                options.openClawBin = parsed;
                break;
            }
            case "--auto-sync":
                options.autoSync = true;
                break;
            case "--no-auto-sync":
                options.autoSync = false;
                break;
            case "--sync-debounce-ms": {
                const raw = readValue(argv, ++index, arg);
                const parsed = Number.parseInt(raw, 10);
                if (!Number.isInteger(parsed) || parsed <= 0) {
                    throw new Error("Invalid value for --sync-debounce-ms (must be positive integer)");
                }
                options.syncDebounceMs = parsed;
                break;
            }
            default:
                throw new Error(`Unknown argument: ${arg}`);
        }
        index += 1;
    }
    return options;
}
export function createOpenClawSlackForwarder(options) {
    const exec = options.exec ?? defaultOpenClawExec;
    const nowMs = options.nowMs ?? (() => Date.now());
    const openClawBin = readNonEmptyString(options.openClawBin) ?? DEFAULT_OPENCLAW_BIN;
    const target = options.target.trim();
    const threadId = readNonEmptyString(options.threadId ?? undefined);
    const activityTarget = readNonEmptyString(options.activityTarget ?? undefined) ?? target;
    const activityUserId = readNonEmptyString(options.activityUserId ?? undefined);
    const activeWindowMinutes = options.activeWindowMinutes && options.activeWindowMinutes > 0
        ? options.activeWindowMinutes
        : DEFAULT_ACTIVE_WINDOW_MINUTES;
    return async (message) => {
        const sendArgs = [
            "message",
            "send",
            "--channel",
            "slack",
            "--target",
            target,
            "--message",
            message,
        ];
        const shouldRouteToThread = threadId
            ? await isSlackThreadActive({
                exec,
                openClawBin,
                threadId,
                activityTarget,
                activityUserId,
                activeWindowMinutes,
                nowMs,
            })
            : false;
        if (shouldRouteToThread && threadId) {
            sendArgs.push("--reply-to", threadId);
        }
        await exec(openClawBin, sendArgs);
    };
}
async function isSlackThreadActive(options) {
    try {
        const { stdout } = await options.exec(options.openClawBin, [
            "message",
            "read",
            "--channel",
            "slack",
            "--target",
            options.activityTarget,
            "--limit",
            "50",
            "--json",
        ]);
        const messages = parseSlackMessages(stdout);
        const cutoffMs = options.nowMs() - options.activeWindowMinutes * 60 * 1000;
        return messages.some((message) => {
            if (!matchesThread(message, options.threadId)) {
                return false;
            }
            if (options.activityUserId &&
                message.authorId &&
                message.authorId !== options.activityUserId) {
                return false;
            }
            if (options.activityUserId && !message.authorId) {
                return false;
            }
            return message.timestampMs >= cutoffMs;
        });
    }
    catch {
        return false;
    }
}
function parseSlackMessages(raw) {
    if (!raw.trim()) {
        return [];
    }
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed.messages)
            ? parsed.messages
            : [];
    return rows
        .map((item) => {
        const record = item;
        return {
            threadId: readUnknownString(record.threadId ?? record.thread_id ?? record.threadTs ?? record.thread_ts),
            authorId: readUnknownString(record.authorId ??
                record.author_id ??
                record.userId ??
                record.user_id ??
                record.senderId ??
                record.sender_id),
            timestampMs: toTimestampMs(record),
        };
    })
        .filter((item) => Number.isFinite(item.timestampMs));
}
function matchesThread(message, threadId) {
    return message.threadId === threadId;
}
function toTimestampMs(record) {
    const candidates = [
        record.timestamp,
        record.ts,
        record.createdAt,
        record.created_at,
        record.date,
    ];
    for (const value of candidates) {
        const asMs = parseTimestampMs(value);
        if (Number.isFinite(asMs)) {
            return asMs;
        }
    }
    return Number.NaN;
}
function parseTimestampMs(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        return value > 1_000_000_000_000 ? value : value * 1000;
    }
    if (typeof value === "string") {
        const normalized = value.trim();
        if (!normalized) {
            return Number.NaN;
        }
        const numeric = Number.parseFloat(normalized);
        if (Number.isFinite(numeric)) {
            return numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
        }
        const parsedDate = Date.parse(normalized);
        if (Number.isFinite(parsedDate)) {
            return parsedDate;
        }
    }
    return Number.NaN;
}
function readUnknownString(value) {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}
const DEFAULT_GALAXY_PORT = 18180;
let galaxyServerHandle = null;
/**
 * Start the galaxy server in syncing mode (no data) and open the browser.
 * The page shows a pulsing "Syncing HiDock device" animation.
 */
async function openGalaxySyncing(log) {
    const galaxyUrl = `http://127.0.0.1:${DEFAULT_GALAXY_PORT}`;
    // If the server already has graph data, keep it — the browser will show
    // existing notes immediately and the sync popup handles progress.
    // Only show the syncing overlay on first launch (no data yet).
    if (galaxyServerHandle) {
        galaxyServerHandle.resetProgress();
        log(`[galaxy] server already running, keeping existing data`);
    }
    else {
        try {
            // Try to load existing notes so the browser shows them immediately
            let initialData;
            try {
                const syncOptions = parseMeetingsSyncArgs([]);
                initialData = await buildGalaxyData({ storageDir: syncOptions.storageDir });
                if (initialData.nodes.length > 0) {
                    log(`[galaxy] pre-loaded ${initialData.nodes.length} existing notes`);
                }
                else {
                    initialData = undefined;
                }
            }
            catch { /* no existing data */ }
            galaxyServerHandle = await startGalaxyServer({
                port: DEFAULT_GALAXY_PORT,
                ...(initialData ? { graphData: initialData } : {}),
                log: (message) => log(`[galaxy] ${message}`),
            });
            // Pre-load wiki search index if wiki exists
            try {
                const syncOptions = parseMeetingsSyncArgs([]);
                const wikiDir = path.join(syncOptions.storageDir, "wiki");
                const wikiSearchIdx = await buildSearchIndex(wikiDir);
                if (wikiSearchIdx.documents.length > 0) {
                    galaxyServerHandle.updateWikiIndex(wikiSearchIdx);
                    log(`[galaxy] pre-loaded wiki search index: ${wikiSearchIdx.documents.length} documents`);
                }
            }
            catch { /* no wiki yet */ }
            log(`[galaxy] syncing page at ${galaxyServerHandle.url}`);
        }
        catch (error) {
            const msg = toErrorMessage(error);
            if (msg.includes("EADDRINUSE")) {
                // Server already running from another process — reuse it
                log(`[galaxy] server already running on port ${DEFAULT_GALAXY_PORT}`);
            }
            else {
                log(`[galaxy] failed to start server: ${msg}`);
                return;
            }
        }
    }
    if (platform() === "darwin") {
        execFile("open", [galaxyUrl], (err) => {
            if (err)
                log(`[galaxy] failed to open browser: ${toErrorMessage(err)}`);
        });
    }
}
/**
 * Build galaxy data and push it to the running server.
 * The browser page polls /data.json and transitions from syncing to graph automatically.
 */
async function updateGalaxyWithData(options) {
    const { storageDir, newSources, log } = options;
    if (!galaxyServerHandle) {
        log(`[galaxy] no server running, skipping data update`);
        return;
    }
    try {
        log(`[galaxy] building graph from ${storageDir}`);
        const buildOptions = { storageDir };
        if (newSources.length > 0) {
            buildOptions.newlySyncedSources = newSources;
        }
        const graphData = await buildGalaxyData(buildOptions);
        galaxyServerHandle.updateData(graphData);
    }
    catch (error) {
        log(`[galaxy] failed to build data: ${toErrorMessage(error)}`);
    }
}
const HIDOCK_NOTIFIER_BIN = new URL("../../HiDockNotifier.app/Contents/MacOS/terminal-notifier", import.meta.url);
const HIDOCK_ICON = new URL("../../assets/hidock-icon.png", import.meta.url);
function sendDesktopNotification(title, message, log) {
    if (platform() !== "darwin") {
        return;
    }
    if (log) {
        log(`[notify] sending: "${title}" — "${message}"`);
    }
    const notifierPath = HIDOCK_NOTIFIER_BIN.pathname;
    const iconPath = HIDOCK_ICON.pathname;
    execFile(notifierPath, ["-title", title, "-message", message, "-appIcon", iconPath, "-timeout", "5"], { timeout: 8000 }, (error) => {
        if (error && log) {
            log(`[notify] error: ${toErrorMessage(error)}`);
        }
        else if (log) {
            log(`[notify] delivered`);
        }
    });
}
export function createUsbWatchPlugInHandler(options) {
    return (event) => {
        options.log(event.prompt);
        sendDesktopNotification("HiDock P1", "Device connected. Syncing recordings...", options.log);
        // Open galaxy page immediately in syncing mode (before sync starts)
        void openGalaxySyncing(options.log);
        if (options.onAutoSync) {
            options.onAutoSync();
        }
        if (!options.sendSlackMessage) {
            return;
        }
        void options.sendSlackMessage(event.prompt).catch((error) => {
            options.log(`Slack forward failed: ${toErrorMessage(error)}`);
        });
    };
}
function readValue(argv, index, flag) {
    const value = argv[index];
    if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${flag}`);
    }
    return value;
}
function readPositiveInt(value) {
    const normalized = readNonEmptyString(value);
    if (!normalized) {
        return null;
    }
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        return null;
    }
    return parsed;
}
function readNonEmptyString(value) {
    if (!value) {
        return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}
function toErrorMessage(error) {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return String(error);
}
const HIDOCK_MONTHS = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};
/**
 * Parse a HiDock device filename to ISO 8601, e.g.
 *   "2026Apr05-080746-Rec03.hda" -> "2026-04-05T08:07:46"
 * Returns null if the name doesn't match the expected pattern.
 */
function parseHiDockFileNameToIso(fileName) {
    const match = /^(\d{4})([A-Z][a-z]{2})(\d{2})-(\d{2})(\d{2})(\d{2})/.exec(fileName);
    if (!match)
        return null;
    const [, yyyy, monthAbbr, dd, hh, mm, ss] = match;
    const monthNum = HIDOCK_MONTHS[monthAbbr ?? ""];
    if (!monthNum)
        return null;
    const monthStr = monthNum < 10 ? `0${monthNum}` : `${monthNum}`;
    return `${yyyy}-${monthStr}-${dd}T${hh}:${mm}:${ss}`;
}
function printHelp() {
    console.log(`HiDock USB watch CLI

Usage:
  npm run usb:watch -- [options]

Options:
  --interval-ms <n>      Poll interval in milliseconds (default: 5000)
  --emit-on-startup      Emit notification if device already connected on first poll (default)
  --no-emit-on-startup   Suppress first-poll notification when already connected
  --slack-target <dest>          Forward plug-in prompts to Slack DM target via OpenClaw
  --slack-thread-id <id>         Slack thread root message id (reply-to) for active routing
  --slack-activity-target <dest> Slack target/channel to inspect for thread activity (default: --slack-target)
  --slack-activity-user-id <id>  Only count activity from this user id when checking thread recency
  --active-window-minutes <n>    Active routing window in minutes (default: 5)
  --no-slack-forward             Disable Slack forwarding even if env is set
  --openclaw-bin <path>          OpenClaw CLI binary path (default: openclaw)
  --auto-sync                    Run meetings sync automatically on plug-in (default)
  --no-auto-sync                 Disable auto sync on plug-in
  --sync-debounce-ms <n>         Debounce window before running auto-sync (default: 1500)
  -h, --help             Show this help

Environment:
  HIDOCK_USB_WATCH_SLACK_TARGET          Slack target for forwarding (optional)
  HIDOCK_USB_WATCH_SLACK_THREAD_ID       Slack thread root message id for active routing (optional)
  HIDOCK_USB_WATCH_SLACK_ACTIVITY_TARGET Slack target/channel to inspect for activity (optional)
  HIDOCK_USB_WATCH_SLACK_ACTIVITY_USER_ID Slack user id to treat as active chatter (optional)
  HIDOCK_USB_WATCH_ACTIVE_WINDOW_MINUTES Active routing window minutes (default: 5)
  HIDOCK_USB_WATCH_OPENCLAW_BIN          OpenClaw CLI path override (optional)
  HIDOCK_USB_WATCH_AUTO_SYNC             Set 0 to disable auto-sync (optional)
  HIDOCK_USB_WATCH_SYNC_DEBOUNCE_MS      Debounce window before sync run (default: 1500)
  HIDOCK_NOTES_BACKEND                   local|memdock for auto-sync storage backend (optional)
  MEMDOCK_BASE_URL                       Memdock API base URL for auto-sync when backend=memdock
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
//# sourceMappingURL=usbWatch.js.map