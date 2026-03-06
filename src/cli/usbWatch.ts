import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  createHiDockConnectionMonitor,
  HiDockPlugInEvent,
} from "../nodeUsb.js";
import { parseArgs as parseMeetingsSyncArgs, runMeetingsSync } from "./meetingsSync.js";
import { SyncCoordinator } from "../syncCoordinator.js";

interface UsbWatchCliOptions {
  intervalMs: number;
  emitOnStartupIfConnected: boolean;
  slackTarget: string | null;
  slackThreadId: string | null;
  slackActivityTarget: string | null;
  slackActivityUserId: string | null;
  activeWindowMinutes: number;
  openClawBin: string;
  autoSync: boolean;
  syncDebounceMs: number;
  showHelp: boolean;
}

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_ACTIVE_WINDOW_MINUTES = 5;
const DEFAULT_OPENCLAW_BIN = "openclaw";
const DEFAULT_SYNC_DEBOUNCE_MS = 1500;
const execFileAsync = promisify(execFile);

interface OpenClawExecResult {
  stdout: string;
  stderr: string;
}

type OpenClawExec = (
  file: string,
  args: readonly string[],
) => Promise<OpenClawExecResult>;

const defaultOpenClawExec: OpenClawExec = async (
  file: string,
  args: readonly string[],
): Promise<OpenClawExecResult> => {
  const result = await execFileAsync(file, [...args]);
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
};

async function main(): Promise<void> {
  const options = parseUsbWatchArgs(process.argv.slice(2));
  if (options.showHelp) {
    printHelp();
    return;
  }

  const log = (message: string): void => {
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

  const runAutoSync = options.autoSync
    ? async () => {
      try {
        const syncOptions = parseMeetingsSyncArgs([]);
        await runMeetingsSync({ options: syncOptions, logger: console });
      } catch (error) {
        log(`[sync] failed: ${toErrorMessage(error)}`);
      }
    }
    : undefined;

  console.log(
    `[HiDock USB Watch] starting (intervalMs=${options.intervalMs}, emitOnStartupIfConnected=${options.emitOnStartupIfConnected}, slackForward=${sendSlackMessage ? "enabled" : "disabled"}, threadRouting=${options.slackThreadId ? "enabled" : "disabled"}, autoSync=${options.autoSync ? "enabled" : "disabled"}, syncDebounceMs=${options.syncDebounceMs}, activeWindowMinutes=${options.activeWindowMinutes})`,
  );
  const handlerOptions: {
    log: (message: string) => void;
    sendSlackMessage?: (message: string) => Promise<void>;
    onAutoSync?: () => void;
  } = { log };
  if (sendSlackMessage) {
    handlerOptions.sendSlackMessage = sendSlackMessage;
  }
  if (runAutoSync) {
    handlerOptions.onAutoSync = () => syncCoordinator.trigger(runAutoSync);
  }

  const onPluggedIn = createUsbWatchPlugInHandler(handlerOptions);

  const monitor = createHiDockConnectionMonitor({
    intervalMs: options.intervalMs,
    emitOnStartupIfConnected: options.emitOnStartupIfConnected,
    onPluggedIn,
    log,
  });
  monitor.start();

  const shutdown = (signal: string): void => {
    console.log(`[HiDock USB Watch] stopping (${signal})`);
    monitor.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

export function parseUsbWatchArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): UsbWatchCliOptions {
  const options: UsbWatchCliOptions = {
    intervalMs: DEFAULT_INTERVAL_MS,
    emitOnStartupIfConnected: true,
    slackTarget: readNonEmptyString(env.HIDOCK_USB_WATCH_SLACK_TARGET),
    slackThreadId: readNonEmptyString(env.HIDOCK_USB_WATCH_SLACK_THREAD_ID),
    slackActivityTarget: readNonEmptyString(
      env.HIDOCK_USB_WATCH_SLACK_ACTIVITY_TARGET,
    ),
    slackActivityUserId: readNonEmptyString(
      env.HIDOCK_USB_WATCH_SLACK_ACTIVITY_USER_ID,
    ),
    activeWindowMinutes:
      readPositiveInt(env.HIDOCK_USB_WATCH_ACTIVE_WINDOW_MINUTES) ??
      DEFAULT_ACTIVE_WINDOW_MINUTES,
    openClawBin:
      readNonEmptyString(env.HIDOCK_USB_WATCH_OPENCLAW_BIN) ??
      DEFAULT_OPENCLAW_BIN,
    autoSync: env.HIDOCK_USB_WATCH_AUTO_SYNC?.trim() !== "0",
    syncDebounceMs:
      readPositiveInt(env.HIDOCK_USB_WATCH_SYNC_DEBOUNCE_MS) ??
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
          throw new Error(
            "Invalid value for --slack-activity-target (must be non-empty)",
          );
        }
        options.slackActivityTarget = parsed;
        break;
      }
      case "--slack-activity-user-id": {
        const raw = readValue(argv, ++index, arg);
        const parsed = readNonEmptyString(raw);
        if (!parsed) {
          throw new Error(
            "Invalid value for --slack-activity-user-id (must be non-empty)",
          );
        }
        options.slackActivityUserId = parsed;
        break;
      }
      case "--active-window-minutes": {
        const raw = readValue(argv, ++index, arg);
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error(
            "Invalid value for --active-window-minutes (must be positive integer)",
          );
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
          throw new Error(
            "Invalid value for --sync-debounce-ms (must be positive integer)",
          );
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

export function createOpenClawSlackForwarder(options: {
  target: string;
  threadId?: string | null;
  activityTarget?: string | null;
  activityUserId?: string | null;
  activeWindowMinutes?: number;
  openClawBin?: string;
  exec?: OpenClawExec;
  nowMs?: () => number;
}): (message: string) => Promise<void> {
  const exec = options.exec ?? defaultOpenClawExec;
  const nowMs = options.nowMs ?? (() => Date.now());
  const openClawBin =
    readNonEmptyString(options.openClawBin) ?? DEFAULT_OPENCLAW_BIN;
  const target = options.target.trim();
  const threadId = readNonEmptyString(options.threadId ?? undefined);
  const activityTarget =
    readNonEmptyString(options.activityTarget ?? undefined) ?? target;
  const activityUserId = readNonEmptyString(options.activityUserId ?? undefined);
  const activeWindowMinutes =
    options.activeWindowMinutes && options.activeWindowMinutes > 0
      ? options.activeWindowMinutes
      : DEFAULT_ACTIVE_WINDOW_MINUTES;

  return async (message: string): Promise<void> => {
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

async function isSlackThreadActive(options: {
  exec: OpenClawExec;
  openClawBin: string;
  threadId: string;
  activityTarget: string;
  activityUserId: string | null;
  activeWindowMinutes: number;
  nowMs: () => number;
}): Promise<boolean> {
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
    const cutoffMs =
      options.nowMs() - options.activeWindowMinutes * 60 * 1000;

    return messages.some((message) => {
      if (!matchesThread(message, options.threadId)) {
        return false;
      }
      if (
        options.activityUserId &&
        message.authorId &&
        message.authorId !== options.activityUserId
      ) {
        return false;
      }
      if (options.activityUserId && !message.authorId) {
        return false;
      }
      return message.timestampMs >= cutoffMs;
    });
  } catch {
    return false;
  }
}

interface SlackMessageRecord {
  threadId: string | null;
  authorId: string | null;
  timestampMs: number;
}

function parseSlackMessages(raw: string): SlackMessageRecord[] {
  if (!raw.trim()) {
    return [];
  }

  const parsed = JSON.parse(raw) as unknown;
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { messages?: unknown }).messages)
      ? (parsed as { messages: unknown[] }).messages
      : [];

  return rows
    .map((item) => {
      const record = item as Record<string, unknown>;
      return {
        threadId: readUnknownString(
          record.threadId ?? record.thread_id ?? record.threadTs ?? record.thread_ts,
        ),
        authorId: readUnknownString(
          record.authorId ??
            record.author_id ??
            record.userId ??
            record.user_id ??
            record.senderId ??
            record.sender_id,
        ),
        timestampMs: toTimestampMs(record),
      };
    })
    .filter((item) => Number.isFinite(item.timestampMs));
}

function matchesThread(message: SlackMessageRecord, threadId: string): boolean {
  return message.threadId === threadId;
}

function toTimestampMs(record: Record<string, unknown>): number {
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

function parseTimestampMs(value: unknown): number {
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

function readUnknownString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function createUsbWatchPlugInHandler(options: {
  log: (message: string) => void;
  sendSlackMessage?: (message: string) => Promise<void>;
  onAutoSync?: () => void;
}): (event: HiDockPlugInEvent) => void {
  return (event: HiDockPlugInEvent): void => {
    options.log(event.prompt);
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

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function readPositiveInt(value: string | undefined): number | null {
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

function readNonEmptyString(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
}

function printHelp(): void {
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
