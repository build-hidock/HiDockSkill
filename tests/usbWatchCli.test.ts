import { describe, expect, it, vi } from "vitest";

import {
  createOpenClawSlackForwarder,
  createUsbWatchPlugInHandler,
  parseUsbWatchArgs,
} from "../src/cli/usbWatch.js";

describe("usb watch CLI args", () => {
  it("uses startup emission by default", () => {
    const options = parseUsbWatchArgs([], {});
    expect(options.emitOnStartupIfConnected).toBe(true);
    expect(options.intervalMs).toBe(5000);
    expect(options.slackTarget).toBeNull();
    expect(options.slackThreadId).toBeNull();
    expect(options.slackActivityTarget).toBeNull();
    expect(options.slackActivityUserId).toBeNull();
    expect(options.activeWindowMinutes).toBe(5);
    expect(options.openClawBin).toBe("openclaw");
    expect(options.autoSync).toBe(true);
    expect(options.syncDebounceMs).toBe(1500);
    expect(options.showHelp).toBe(false);
  });

  it("supports disabling startup emission", () => {
    const options = parseUsbWatchArgs(["--no-emit-on-startup"], {});
    expect(options.emitOnStartupIfConnected).toBe(false);
  });

  it("supports custom interval", () => {
    const options = parseUsbWatchArgs(["--interval-ms", "2000"], {});
    expect(options.intervalMs).toBe(2000);
  });

  it("rejects invalid interval", () => {
    expect(() => parseUsbWatchArgs(["--interval-ms", "0"], {})).toThrow(
      "Invalid value for --interval-ms (must be positive integer)",
    );
  });

  it("uses Slack routing config from env", () => {
    const options = parseUsbWatchArgs([], {
      HIDOCK_USB_WATCH_SLACK_TARGET: "U123456",
      HIDOCK_USB_WATCH_SLACK_THREAD_ID: "174124.99",
      HIDOCK_USB_WATCH_SLACK_ACTIVITY_TARGET: "D111",
      HIDOCK_USB_WATCH_SLACK_ACTIVITY_USER_ID: "U999",
      HIDOCK_USB_WATCH_ACTIVE_WINDOW_MINUTES: "8",
      HIDOCK_USB_WATCH_OPENCLAW_BIN: "/usr/local/bin/openclaw",
      HIDOCK_USB_WATCH_AUTO_SYNC: "0",
      HIDOCK_USB_WATCH_SYNC_DEBOUNCE_MS: "2200",
    });
    expect(options.slackTarget).toBe("U123456");
    expect(options.slackThreadId).toBe("174124.99");
    expect(options.slackActivityTarget).toBe("D111");
    expect(options.slackActivityUserId).toBe("U999");
    expect(options.activeWindowMinutes).toBe(8);
    expect(options.openClawBin).toBe("/usr/local/bin/openclaw");
    expect(options.autoSync).toBe(false);
    expect(options.syncDebounceMs).toBe(2200);
  });

  it("allows flags to override env config", () => {
    const options = parseUsbWatchArgs(
      [
        "--slack-target",
        "U999999",
        "--slack-thread-id",
        "thread.1",
        "--slack-activity-target",
        "D222",
        "--slack-activity-user-id",
        "U2",
        "--active-window-minutes",
        "3",
        "--openclaw-bin",
        "/custom/openclaw",
        "--no-auto-sync",
        "--sync-debounce-ms",
        "900",
      ],
      {
        HIDOCK_USB_WATCH_SLACK_TARGET: "U123456",
        HIDOCK_USB_WATCH_OPENCLAW_BIN: "/usr/local/bin/openclaw",
      },
    );
    expect(options.slackTarget).toBe("U999999");
    expect(options.slackThreadId).toBe("thread.1");
    expect(options.slackActivityTarget).toBe("D222");
    expect(options.slackActivityUserId).toBe("U2");
    expect(options.activeWindowMinutes).toBe(3);
    expect(options.openClawBin).toBe("/custom/openclaw");
    expect(options.autoSync).toBe(false);
    expect(options.syncDebounceMs).toBe(900);
  });

  it("supports explicit no-slack-forward even when env target exists", () => {
    const options = parseUsbWatchArgs(["--no-slack-forward"], {
      HIDOCK_USB_WATCH_SLACK_TARGET: "U123456",
      HIDOCK_USB_WATCH_SLACK_THREAD_ID: "thread.1",
    });
    expect(options.slackTarget).toBeNull();
    expect(options.slackThreadId).toBeNull();
  });
});

describe("usb watch Slack forwarders", () => {
  it("builds OpenClaw Slack send command with configured target", async () => {
    const exec = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const sender = createOpenClawSlackForwarder({
      target: "U123456",
      openClawBin: "/usr/local/bin/openclaw",
      exec,
    });

    await sender("HiDock P1 plugged in, auto sync your latest recordings now...");

    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("/usr/local/bin/openclaw", [
      "message",
      "send",
      "--channel",
      "slack",
      "--target",
      "U123456",
      "--message",
      "HiDock P1 plugged in, auto sync your latest recordings now...",
    ]);
  });

  it("routes to thread when recent user activity is present", async () => {
    const nowMs = () => 1_700_000_000_000;
    const activeTsSeconds = (nowMs() - 2 * 60 * 1000) / 1000;
    const exec = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify({
          messages: [
            {
              threadId: "thread.1",
              authorId: "U999",
              ts: String(activeTsSeconds),
            },
          ],
        }),
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    const sender = createOpenClawSlackForwarder({
      target: "D111",
      threadId: "thread.1",
      activityUserId: "U999",
      activeWindowMinutes: 5,
      openClawBin: "openclaw",
      exec,
      nowMs,
    });

    await sender("plugged");

    expect(exec).toHaveBeenNthCalledWith(1, "openclaw", [
      "message",
      "read",
      "--channel",
      "slack",
      "--target",
      "D111",
      "--limit",
      "50",
      "--json",
    ]);

    expect(exec).toHaveBeenNthCalledWith(2, "openclaw", [
      "message",
      "send",
      "--channel",
      "slack",
      "--target",
      "D111",
      "--message",
      "plugged",
      "--reply-to",
      "thread.1",
    ]);
  });

  it("falls back to non-thread send when no recent activity", async () => {
    const nowMs = () => 1_700_000_000_000;
    const staleTsSeconds = (nowMs() - 10 * 60 * 1000) / 1000;
    const exec = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          { thread_id: "thread.1", user_id: "U999", ts: String(staleTsSeconds) },
        ]),
        stderr: "",
      })
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    const sender = createOpenClawSlackForwarder({
      target: "D111",
      threadId: "thread.1",
      activityUserId: "U999",
      activeWindowMinutes: 5,
      exec,
      nowMs,
    });

    await sender("plugged");

    expect(exec).toHaveBeenNthCalledWith(2, "openclaw", [
      "message",
      "send",
      "--channel",
      "slack",
      "--target",
      "D111",
      "--message",
      "plugged",
    ]);
  });

  it("falls back to non-thread send when activity check fails", async () => {
    const exec = vi
      .fn()
      .mockRejectedValueOnce(new Error("read failed"))
      .mockResolvedValueOnce({ stdout: "", stderr: "" });

    const sender = createOpenClawSlackForwarder({
      target: "D111",
      threadId: "thread.1",
      exec,
    });

    await sender("plugged");

    expect(exec).toHaveBeenNthCalledWith(2, "openclaw", [
      "message",
      "send",
      "--channel",
      "slack",
      "--target",
      "D111",
      "--message",
      "plugged",
    ]);
  });

  it("logs prompt and forwards when sender is configured", async () => {
    const log = vi.fn();
    const sendSlackMessage = vi.fn(async () => {});
    const onAutoSync = vi.fn();
    const onPluggedIn = createUsbWatchPlugInHandler({ log, sendSlackMessage, onAutoSync });

    onPluggedIn({ prompt: "plugged", productName: "P1", device: {} as never });
    await flushAsyncWork();

    // 1 prompt log + 2 notification logs ([notify] sending, [notify] using)
    expect(log).toHaveBeenCalledTimes(3);
    expect(log.mock.calls[0]?.[0]).toBe("plugged");
    expect(onAutoSync).toHaveBeenCalledTimes(1);
    expect(sendSlackMessage).toHaveBeenCalledTimes(1);
    expect(sendSlackMessage).toHaveBeenCalledWith("plugged");
  });

  it("keeps watcher alive by logging sender failures", async () => {
    const log = vi.fn();
    const sendSlackMessage = vi.fn(async () => {
      throw new Error("openclaw failed");
    });
    const onPluggedIn = createUsbWatchPlugInHandler({ log, sendSlackMessage });

    onPluggedIn({ prompt: "plugged", productName: "P1", device: {} as never });
    await flushAsyncWork();

    // 1 prompt log + 2 notification logs ([notify] sending, [notify] using) + 1 Slack error
    expect(log).toHaveBeenCalledTimes(4);
    expect(log.mock.calls[0]?.[0]).toBe("plugged");
    expect(log.mock.calls[3]?.[0]).toContain(
      "Slack forward failed: openclaw failed",
    );
  });
});

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
