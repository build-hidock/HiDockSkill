import { describe, expect, it } from "vitest";

import {
  HiDockFrameStreamParser,
  decodeHiDockFrame,
  encodeHiDockFrame,
} from "../src/protocol.js";

describe("HiDock protocol framing", () => {
  it("encodes and decodes a frame roundtrip", () => {
    const body = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    const encoded = encodeHiDockFrame(0x0006, 15, body);
    const decoded = decodeHiDockFrame(encoded);

    expect(decoded.commandId).toBe(0x0006);
    expect(decoded.messageId).toBe(15);
    expect(Array.from(decoded.body)).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("reassembles split frames from streamed chunks", () => {
    const parser = new HiDockFrameStreamParser();
    const a = encodeHiDockFrame(0x0001, 1);
    const b = encodeHiDockFrame(0x0002, 2, new Uint8Array([0x20, 0x26, 0x02]));

    const joined = new Uint8Array(a.length + b.length);
    joined.set(a, 0);
    joined.set(b, a.length);

    const chunks = [
      joined.subarray(0, 5),
      joined.subarray(5, 16),
      joined.subarray(16),
    ];

    const frames = chunks.flatMap((chunk) => parser.feed(chunk));
    expect(frames).toHaveLength(2);
    expect(frames[0]!.commandId).toBe(0x0001);
    expect(frames[1]!.commandId).toBe(0x0002);
    expect(Array.from(frames[1]!.body)).toEqual([0x20, 0x26, 0x02]);
  });
});
