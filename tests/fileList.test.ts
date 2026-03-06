import { describe, expect, it } from "vitest";

import {
  detectAudioContainer,
  parseHiDockFileListBody,
} from "../src/fileList.js";
import { concatBytes, writeU24BE, writeU32BE } from "../src/bytes.js";

const textEncoder = new TextEncoder();

describe("HiDock file list parser", () => {
  it("parses file entries and strips trailing NUL", () => {
    const entries = [
      buildEntry({
        version: 0x00,
        fileName: "20260221-095834-Rec43.hda\u0000",
        size: 64000,
        modifiedAt: Uint8Array.from([0x20, 0x26, 0x02, 0x21, 0x12, 0x14]),
        md5Seed: 1,
      }),
      buildEntry({
        version: 0x02,
        fileName: "20260221-100000-Whsp00.hda\u0000",
        size: 96044,
        modifiedAt: Uint8Array.from([0x20, 0x26, 0x02, 0x21, 0x12, 0x15]),
        md5Seed: 2,
      }),
    ];

    const header = new Uint8Array(6);
    header[0] = 0xff;
    header[1] = 0xff;
    writeU32BE(header, 2, entries.length);

    const body = concatBytes(header, ...entries);
    const parsed = parseHiDockFileListBody(body);

    expect(parsed.fileCount).toBe(2);
    expect(parsed.files[0]!.fileName).toBe("20260221-095834-Rec43.hda");
    expect(parsed.files[0]!.estimatedDurationSeconds).toBe(8);
    expect(parsed.files[1]!.audioProfile?.codec).toBe("wav");
    expect(parsed.files[1]!.estimatedDurationSeconds).toBe(1);
    expect(parsed.trailingBytes).toBe(0);
  });

  it("detects audio container from byte signatures", () => {
    const wav = Uint8Array.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    const mp3 = Uint8Array.from([0xff, 0xf3, 0x88]);

    expect(detectAudioContainer(wav)).toBe("wav");
    expect(detectAudioContainer(mp3)).toBe("mp3");
  });
});

function buildEntry(args: {
  version: number;
  fileName: string;
  size: number;
  modifiedAt: Uint8Array;
  md5Seed: number;
}): Uint8Array {
  const fileNameBytes = textEncoder.encode(args.fileName);
  const row = new Uint8Array(1 + 3 + fileNameBytes.length + 4 + 6 + 16);
  let cursor = 0;
  row[cursor] = args.version;
  cursor += 1;

  writeU24BE(row, cursor, fileNameBytes.length);
  cursor += 3;

  row.set(fileNameBytes, cursor);
  cursor += fileNameBytes.length;

  writeU32BE(row, cursor, args.size);
  cursor += 4;

  row.set(args.modifiedAt, cursor);
  cursor += 6;

  row.set(buildMd5(args.md5Seed), cursor);
  return row;
}

function buildMd5(seed: number): Uint8Array {
  const value = new Uint8Array(16);
  for (let index = 0; index < value.length; index += 1) {
    value[index] = (seed + index * 13) & 0xff;
  }
  return value;
}
