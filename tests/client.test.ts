import { describe, expect, it, vi } from "vitest";

import { HiDockClient, HiDockTransportLike } from "../src/client.js";
import { HiDockCommand } from "../src/commands.js";
import { HiDockFileEntry } from "../src/fileList.js";
import { HiDockFrame } from "../src/protocol.js";

describe("HiDockClient", () => {
  it("downloads file data across multiple frames", async () => {
    const fileEntry: HiDockFileEntry = {
      fileVersion: 0,
      fileName: "test.hda",
      rawFileNameBytes: Uint8Array.from([0x74, 0x65, 0x73, 0x74, 0x00]),
      fileSize: 10,
      modifiedAtRaw: new Uint8Array(6),
      modifiedAtBcd: null,
      md5Hex: "00".repeat(16),
      audioProfile: null,
      estimatedDurationSeconds: null,
    };

    const sentCommands: Array<{
      commandId: number;
      messageId: number;
      body: Uint8Array;
    }> = [];

    const readQueue: HiDockFrame[][] = [
      [frame(0xffff, 1, Uint8Array.from([0xaa]))],
      [frame(HiDockCommand.TRANSFER_FILE, 1, Uint8Array.from([1, 2, 3, 4]))],
      [frame(HiDockCommand.TRANSFER_FILE, 1, Uint8Array.from([5, 6, 7, 8, 9, 10]))],
    ];

    const transport = createMockTransport({
      sendCommand: async (commandId, messageId, body = new Uint8Array(0)) => {
        sentCommands.push({ commandId, messageId, body });
      },
      readFrames: async () => readQueue.shift() ?? [],
      requestResponseFrame: async () => {
        throw new Error("not used");
      },
    });

    const client = new HiDockClient(transport);
    const progress = vi.fn();
    const bytes = await client.downloadFile(fileEntry, {
      onProgress: progress,
      readLimit: 10,
    });

    expect(sentCommands).toHaveLength(1);
    expect(sentCommands[0]!.commandId).toBe(HiDockCommand.TRANSFER_FILE);
    expect(sentCommands[0]!.messageId).toBe(1);
    expect(Array.from(sentCommands[0]!.body)).toEqual([0x74, 0x65, 0x73, 0x74, 0x00]);
    expect(Array.from(bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(progress).toHaveBeenLastCalledWith(10, 10);
  });

  it("parses device info response", async () => {
    const transport = createMockTransport({
      requestResponseFrame: async (commandId, messageId) => {
        expect(commandId).toBe(HiDockCommand.QUERY_DEVICE_INFO);
        expect(messageId).toBe(1);
        return frame(
          HiDockCommand.QUERY_DEVICE_INFO,
          1,
          Uint8Array.from([
            0x00, 0x06, 0x00, 0x0e, 0x48, 0x44, 0x31, 0x45, 0x30, 0x30, 0x31,
            0x00,
          ]),
        );
      },
    });

    const client = new HiDockClient(transport);
    const info = await client.getDeviceInfo();
    expect(info.version).toBe("0.6.0.14");
    expect(info.serialNumber).toBe("HD1E001");
  });
});

function frame(commandId: number, messageId: number, body: Uint8Array): HiDockFrame {
  return { commandId, messageId, bodyLength: body.length, body };
}

function createMockTransport(overrides: Partial<HiDockTransportLike>): HiDockTransportLike {
  return {
    open: overrides.open ?? (async () => {}),
    close: overrides.close ?? (async () => {}),
    sendCommand: overrides.sendCommand ?? (async () => {}),
    readFrames: overrides.readFrames ?? (async () => []),
    requestResponseFrame:
      overrides.requestResponseFrame ??
      (async () => {
        throw new Error("requestResponseFrame mock not implemented");
      }),
  };
}
