import assert from "node:assert/strict";

const HIDOCK_HEADER_HI = 0x12;
const HIDOCK_HEADER_LO = 0x34;
const FRAME_HEADER_BYTES = 12;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const AUDIO_PROFILES = {
  0x00: { codec: "mp3", sampleRateHz: 16000, channels: 1, bitrateBps: 64000 },
  0x01: { codec: "mp3", sampleRateHz: 16000, channels: 1, bitrateBps: 32000 },
  0x02: { codec: "wav", sampleRateHz: 48000, channels: 1, bitsPerSample: 16, headerBytes: 44 },
  0x03: { codec: "wav", sampleRateHz: 48000, channels: 2, bitsPerSample: 16, headerBytes: 44 },
  0x04: { codec: "mp3", sampleRateHz: 48000, channels: 1, bitrateBps: 64000 },
  0x05: { codec: "mp3", sampleRateHz: 48000, channels: 1, bitrateBps: 96000 },
  0x06: { codec: "mp3", sampleRateHz: 16000, channels: 2, bitrateBps: 128000 },
  0x07: { codec: "mp3", sampleRateHz: 16000, channels: 2, bitrateBps: 80000 },
};

function concatBytes(...parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function toHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(" ");
}

function writeU24BE(target, offset, value) {
  if (value < 0 || value > 0xFFFFFF) {
    throw new RangeError(`u24 out of range: ${value}`);
  }
  target[offset] = (value >>> 16) & 0xFF;
  target[offset + 1] = (value >>> 8) & 0xFF;
  target[offset + 2] = value & 0xFF;
}

function readU24BE(source, offset) {
  return (source[offset] << 16) | (source[offset + 1] << 8) | source[offset + 2];
}

function encodeFrame(commandId, messageId, body = new Uint8Array(0)) {
  const frame = new Uint8Array(FRAME_HEADER_BYTES + body.length);
  frame[0] = HIDOCK_HEADER_HI;
  frame[1] = HIDOCK_HEADER_LO;
  frame[2] = (commandId >>> 8) & 0xFF;
  frame[3] = commandId & 0xFF;
  frame[4] = (messageId >>> 24) & 0xFF;
  frame[5] = (messageId >>> 16) & 0xFF;
  frame[6] = (messageId >>> 8) & 0xFF;
  frame[7] = messageId & 0xFF;
  frame[8] = (body.length >>> 24) & 0xFF;
  frame[9] = (body.length >>> 16) & 0xFF;
  frame[10] = (body.length >>> 8) & 0xFF;
  frame[11] = body.length & 0xFF;
  frame.set(body, FRAME_HEADER_BYTES);
  return frame;
}

function decodeFrame(frameBytes) {
  if (frameBytes.length < FRAME_HEADER_BYTES) {
    throw new Error(`Frame too short: ${frameBytes.length}`);
  }
  if (frameBytes[0] !== HIDOCK_HEADER_HI || frameBytes[1] !== HIDOCK_HEADER_LO) {
    throw new Error(`Invalid frame header: ${toHex(frameBytes.subarray(0, 2))}`);
  }

  const commandId = (frameBytes[2] << 8) | frameBytes[3];
  const messageId =
    frameBytes[4] * 0x1000000 +
    (frameBytes[5] << 16) +
    (frameBytes[6] << 8) +
    frameBytes[7];
  const bodyLength =
    frameBytes[8] * 0x1000000 +
    (frameBytes[9] << 16) +
    (frameBytes[10] << 8) +
    frameBytes[11];
  const expectedLength = FRAME_HEADER_BYTES + bodyLength;

  if (frameBytes.length !== expectedLength) {
    throw new Error(`Frame length mismatch: got ${frameBytes.length}, expected ${expectedLength}`);
  }

  return {
    commandId,
    messageId,
    bodyLength,
    body: frameBytes.subarray(FRAME_HEADER_BYTES),
  };
}

class HidockFrameStreamParser {
  constructor() {
    this.buffer = new Uint8Array(0);
  }

  feed(chunk) {
    this.buffer = concatBytes(this.buffer, chunk);
    const frames = [];

    while (this.buffer.length >= FRAME_HEADER_BYTES) {
      if (this.buffer[0] !== HIDOCK_HEADER_HI || this.buffer[1] !== HIDOCK_HEADER_LO) {
        const headerOffset = this.findHeaderOffset();
        if (headerOffset < 0) {
          this.buffer = new Uint8Array(0);
          break;
        }
        this.buffer = this.buffer.subarray(headerOffset);
        if (this.buffer.length < FRAME_HEADER_BYTES) {
          break;
        }
      }

      const bodyLength =
        this.buffer[8] * 0x1000000 +
        (this.buffer[9] << 16) +
        (this.buffer[10] << 8) +
        this.buffer[11];
      const frameLength = FRAME_HEADER_BYTES + bodyLength;
      if (this.buffer.length < frameLength) {
        break;
      }

      const fullFrame = this.buffer.subarray(0, frameLength);
      frames.push(decodeFrame(fullFrame));
      this.buffer = this.buffer.subarray(frameLength);
    }

    return frames;
  }

  findHeaderOffset() {
    for (let i = 0; i < this.buffer.length - 1; i += 1) {
      if (this.buffer[i] === HIDOCK_HEADER_HI && this.buffer[i + 1] === HIDOCK_HEADER_LO) {
        return i;
      }
    }
    return -1;
  }
}

function decodeBcdTimestamp(bytes) {
  const allNibblesAreDecimal = bytes.every((byte) => (byte >> 4) <= 9 && (byte & 0x0F) <= 9);
  if (!allNibblesAreDecimal) {
    return null;
  }

  const digits = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (!/^\d{12}$/.test(digits)) {
    return null;
  }

  return {
    compact: digits,
    isoLike: `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)} ${digits.slice(8, 10)}:${digits.slice(10, 12)}`,
  };
}

function estimateDurationSeconds(fileVersion, fileSizeBytes) {
  const profile = AUDIO_PROFILES[fileVersion];
  if (!profile) {
    return null;
  }
  if (profile.codec === "mp3") {
    return fileSizeBytes / (profile.bitrateBps / 8);
  }
  if (profile.codec === "wav") {
    const payloadBytes = Math.max(0, fileSizeBytes - profile.headerBytes);
    const bytesPerSample = profile.bitsPerSample / 8;
    return payloadBytes / (profile.sampleRateHz * bytesPerSample * profile.channels);
  }
  return null;
}

function parseFileListBody(body) {
  if (body.length < 6) {
    throw new Error(`File list body too short: ${body.length}`);
  }
  if (body[0] !== 0xFF || body[1] !== 0xFF) {
    throw new Error(`Unexpected file list marker: ${toHex(body.subarray(0, 2))}`);
  }

  const count = body[2] * 0x1000000 + (body[3] << 16) + (body[4] << 8) + body[5];
  const files = [];
  let cursor = 6;

  for (let i = 0; i < count; i += 1) {
    if (cursor + 1 + 3 + 4 + 6 + 16 > body.length) {
      throw new Error(`Entry ${i} is truncated`);
    }
    const fileVersion = body[cursor];
    cursor += 1;

    const fileNameLength = readU24BE(body, cursor);
    cursor += 3;
    if (cursor + fileNameLength + 4 + 6 + 16 > body.length) {
      throw new Error(`Entry ${i} has invalid filename length ${fileNameLength}`);
    }

    const fileNameBytes = body.subarray(cursor, cursor + fileNameLength);
    cursor += fileNameLength;
    const fileSize = body[cursor] * 0x1000000 + (body[cursor + 1] << 16) + (body[cursor + 2] << 8) + body[cursor + 3];
    cursor += 4;

    const modifiedAtBytes = body.subarray(cursor, cursor + 6);
    cursor += 6;

    const md5Bytes = body.subarray(cursor, cursor + 16);
    cursor += 16;

    files.push({
      fileVersion,
      fileNameLength,
      fileName: textDecoder.decode(fileNameBytes),
      fileSize,
      modifiedAtRawHex: toHex(modifiedAtBytes),
      modifiedAtBcd: decodeBcdTimestamp(Array.from(modifiedAtBytes)),
      md5Hex: toHex(md5Bytes).replaceAll(" ", ""),
      audioProfile: AUDIO_PROFILES[fileVersion] ?? null,
      estimatedDurationSeconds: estimateDurationSeconds(fileVersion, fileSize),
    });
  }

  return { count, files, trailingBytes: body.length - cursor };
}

function buildFileListBody(entries) {
  const chunks = [];
  const header = new Uint8Array(6);
  header[0] = 0xFF;
  header[1] = 0xFF;
  header[2] = (entries.length >>> 24) & 0xFF;
  header[3] = (entries.length >>> 16) & 0xFF;
  header[4] = (entries.length >>> 8) & 0xFF;
  header[5] = entries.length & 0xFF;
  chunks.push(header);

  for (const entry of entries) {
    const fileNameBytes = textEncoder.encode(entry.fileName);
    const row = new Uint8Array(1 + 3 + fileNameBytes.length + 4 + 6 + 16);
    let cursor = 0;
    row[cursor] = entry.fileVersion;
    cursor += 1;
    writeU24BE(row, cursor, fileNameBytes.length);
    cursor += 3;
    row.set(fileNameBytes, cursor);
    cursor += fileNameBytes.length;
    row[cursor] = (entry.fileSize >>> 24) & 0xFF;
    row[cursor + 1] = (entry.fileSize >>> 16) & 0xFF;
    row[cursor + 2] = (entry.fileSize >>> 8) & 0xFF;
    row[cursor + 3] = entry.fileSize & 0xFF;
    cursor += 4;
    row.set(entry.modifiedAtBcdBytes, cursor);
    cursor += 6;
    row.set(entry.md5Bytes, cursor);
    chunks.push(row);
  }

  return concatBytes(...chunks);
}

function buildTestMd5(seed) {
  const md5 = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) {
    md5[i] = (seed + i * 17) & 0xFF;
  }
  return md5;
}

function runProtocolFrameTests() {
  const cmd = 0x0001;
  const messageId = 42;
  const body = new Uint8Array(0);
  const frame = encodeFrame(cmd, messageId, body);

  assert.equal(frame.length, 12);
  assert.equal(toHex(frame), "12 34 00 01 00 00 00 2a 00 00 00 00");

  const decoded = decodeFrame(frame);
  assert.equal(decoded.commandId, cmd);
  assert.equal(decoded.messageId, messageId);
  assert.equal(decoded.bodyLength, 0);
}

function runStreamParserTests() {
  const parser = new HidockFrameStreamParser();
  const frameA = encodeFrame(0x0006, 1, new Uint8Array([0x00, 0x00, 0x00, 0x0A]));
  const frameB = encodeFrame(0x0002, 2, new Uint8Array([0x20, 0x26, 0x02, 0x21, 0x11, 0x59]));
  const full = concatBytes(frameA, frameB);

  const slices = [
    full.subarray(0, 3),
    full.subarray(3, 12),
    full.subarray(12, 20),
    full.subarray(20, 25),
    full.subarray(25),
  ];

  const decodedFrames = [];
  for (const slice of slices) {
    const fresh = parser.feed(slice);
    decodedFrames.push(...fresh);
  }

  assert.equal(decodedFrames.length, 2);
  assert.equal(decodedFrames[0].commandId, 0x0006);
  assert.equal(decodedFrames[0].messageId, 1);
  assert.equal(decodedFrames[1].commandId, 0x0002);
  assert.equal(decodedFrames[1].messageId, 2);
  assert.equal(toHex(decodedFrames[0].body), "00 00 00 0a");
}

function runFileListTests() {
  const body = buildFileListBody([
    {
      fileVersion: 0x02,
      fileName: "20250804-200954-Whsp00.hda",
      fileSize: 96044,
      modifiedAtBcdBytes: Uint8Array.from([0x20, 0x25, 0x08, 0x04, 0x20, 0x09]),
      md5Bytes: buildTestMd5(0x10),
    },
    {
      fileVersion: 0x01,
      fileName: "20250804-200857-Call00.hda",
      fileSize: 64000,
      modifiedAtBcdBytes: Uint8Array.from([0x20, 0x25, 0x08, 0x04, 0x20, 0x08]),
      md5Bytes: buildTestMd5(0x50),
    },
  ]);

  const parsed = parseFileListBody(body);
  assert.equal(parsed.count, 2);
  assert.equal(parsed.trailingBytes, 0);
  assert.equal(parsed.files[0].fileName, "20250804-200954-Whsp00.hda");
  assert.equal(parsed.files[0].audioProfile.codec, "wav");
  assert.equal(parsed.files[0].estimatedDurationSeconds, 1);
  assert.equal(parsed.files[1].audioProfile.codec, "mp3");
  assert.equal(parsed.files[1].estimatedDurationSeconds, 16);
}

function main() {
  runProtocolFrameTests();
  runStreamParserTests();
  runFileListTests();
  console.log("Protocol lab checks passed.");
}

main();
