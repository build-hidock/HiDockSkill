import { WebUSB } from "usb";

const HIDOCK_HEADER_HI = 0x12;
const HIDOCK_HEADER_LO = 0x34;
const FRAME_HEADER_BYTES = 12;

const DEFAULT_VID = 0x10d6;
const DEFAULT_PID = 0xb00d;
const DEFAULT_INTERFACE_NUMBER = 0;
const DEFAULT_OUT_ENDPOINT = 1;
const DEFAULT_IN_ENDPOINT = 2;
const DEFAULT_TRANSFER_SIZE = 512;

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

function parseNumericEnv(name, fallbackValue) {
  const raw = process.env[name];
  if (!raw) {
    return fallbackValue;
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized.startsWith("0x")) {
    return Number.parseInt(normalized.slice(2), 16);
  }
  return Number.parseInt(normalized, 10);
}

function toHex(bytes) {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(" ");
}

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
    throw new Error(`Frame length mismatch: ${frameBytes.length} != ${expectedLength}`);
  }
  return { commandId, messageId, body: frameBytes.subarray(FRAME_HEADER_BYTES) };
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
        const offset = this.findHeaderOffset();
        if (offset < 0) {
          this.buffer = new Uint8Array(0);
          break;
        }
        this.buffer = this.buffer.subarray(offset);
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

      const frameBytes = this.buffer.subarray(0, frameLength);
      frames.push(decodeFrame(frameBytes));
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

function parseBcdDateTime(raw) {
  const bytes = Array.from(raw);
  const allDecimalNibbles = bytes.every((value) => (value >> 4) <= 9 && (value & 0x0F) <= 9);
  if (!allDecimalNibbles) {
    return null;
  }
  const digits = bytes.map((value) => value.toString(16).padStart(2, "0")).join("");
  if (digits.length !== 14) {
    return null;
  }
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)} ${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}`;
}

function parseDeviceInfoBody(body) {
  if (body.length < 4) {
    return { rawHex: toHex(body) };
  }
  const version = `${body[0]}.${body[1]}.${body[2]}${body[3] > 0 ? `.${body[3]}` : ""}`;
  const snRaw = body.subarray(4);
  const sn = textDecoder.decode(snRaw).replace(/\u0000/g, "").trim();
  return { version, serialNumber: sn, rawHex: toHex(body) };
}

function parseFileCountBody(body) {
  if (body.length !== 4) {
    return { rawHex: toHex(body), warning: "Expected 4 bytes for file count" };
  }
  const count = body[0] * 0x1000000 + (body[1] << 16) + (body[2] << 8) + body[3];
  return { count, rawHex: toHex(body) };
}

function parseFileListBody(body) {
  if (body.length < 6) {
    return { warning: "Body too short", rawHex: toHex(body) };
  }
  if (body[0] !== 0xFF || body[1] !== 0xFF) {
    return { warning: "Missing FF FF marker", rawHex: toHex(body) };
  }

  const fileCount = body[2] * 0x1000000 + (body[3] << 16) + (body[4] << 8) + body[5];
  const files = [];
  let cursor = 6;

  for (let i = 0; i < fileCount; i += 1) {
    if (cursor + 1 + 3 + 4 + 6 + 16 > body.length) {
      break;
    }
    const fileVersion = body[cursor];
    cursor += 1;

    const fileNameLength = (body[cursor] << 16) | (body[cursor + 1] << 8) | body[cursor + 2];
    cursor += 3;
    if (cursor + fileNameLength + 4 + 6 + 16 > body.length) {
      break;
    }

    const fileName = textDecoder.decode(body.subarray(cursor, cursor + fileNameLength));
    cursor += fileNameLength;

    const fileSize = body[cursor] * 0x1000000 + (body[cursor + 1] << 16) + (body[cursor + 2] << 8) + body[cursor + 3];
    cursor += 4;

    const modifiedAtRaw = body.subarray(cursor, cursor + 6);
    cursor += 6;

    const md5Raw = body.subarray(cursor, cursor + 16);
    cursor += 16;

    files.push({
      fileVersion,
      fileName,
      fileSize,
      modifiedAtRawHex: toHex(modifiedAtRaw),
      md5Hex: toHex(md5Raw).replaceAll(" ", ""),
    });
  }

  return {
    fileCount,
    parsedEntries: files.length,
    trailingBytes: body.length - cursor,
    files,
  };
}

function trimTrailingNul(value) {
  return value.replace(/\u0000+$/g, "");
}

async function transferOutFrame(device, endpointNumber, frameBytes) {
  const payload = frameBytes.buffer.slice(frameBytes.byteOffset, frameBytes.byteOffset + frameBytes.byteLength);
  const result = await device.transferOut(endpointNumber, payload);
  if (result.status !== "ok") {
    throw new Error(`transferOut status=${result.status}`);
  }
}

async function readOneTransfer(device, endpointNumber, length) {
  return device.transferIn(endpointNumber, length);
}

async function transact(device, parser, options) {
  const {
    commandId,
    messageId,
    body = new Uint8Array(0),
    outEndpointNumber,
    inEndpointNumber,
    perReadLength = DEFAULT_TRANSFER_SIZE,
    maxReads = 128,
  } = options;

  const request = encodeFrame(commandId, messageId, body);
  await transferOutFrame(device, outEndpointNumber, request);

  for (let readIndex = 0; readIndex < maxReads; readIndex += 1) {
    const transferResult = await readOneTransfer(device, inEndpointNumber, perReadLength);

    if (transferResult.status !== "ok") {
      continue;
    }
    if (!transferResult.data || transferResult.data.byteLength === 0) {
      continue;
    }

    const chunk = new Uint8Array(
      transferResult.data.buffer,
      transferResult.data.byteOffset,
      transferResult.data.byteLength,
    );
    const frames = parser.feed(chunk);
    for (const frame of frames) {
      if (frame.commandId === commandId && frame.messageId === messageId) {
        return frame;
      }
    }
  }

  throw new Error(
    `No matching response for cmd=0x${commandId.toString(16)} id=${messageId} in ${maxReads} reads`,
  );
}

async function findTargetDevice(webusb, targetVid, targetPid) {
  const devices = await webusb.getDevices();
  const exact = devices.find((device) => device.vendorId === targetVid && device.productId === targetPid);
  if (exact) {
    return exact;
  }
  const byName = devices.find((device) =>
    `${device.productName ?? ""} ${device.manufacturerName ?? ""}`.toLowerCase().includes("hidock"),
  );
  return byName ?? null;
}

async function main() {
  const targetVid = parseNumericEnv("HIDOCK_VID", DEFAULT_VID);
  const targetPid = parseNumericEnv("HIDOCK_PID", DEFAULT_PID);
  const interfaceNumber = parseNumericEnv("HIDOCK_INTERFACE", DEFAULT_INTERFACE_NUMBER);
  const outEndpointNumber = parseNumericEnv("HIDOCK_OUT_EP", DEFAULT_OUT_ENDPOINT);
  const inEndpointNumber = parseNumericEnv("HIDOCK_IN_EP", DEFAULT_IN_ENDPOINT);

  const webusb = new WebUSB({
    allowAllDevices: true,
    devicesFound: (devices) => devices[0],
  });

  const device = await findTargetDevice(webusb, targetVid, targetPid);
  if (!device) {
    throw new Error(`No HiDock device found (wanted vid=0x${targetVid.toString(16)} pid=0x${targetPid.toString(16)})`);
  }

  console.log(`Using device: ${device.productName} vid=0x${device.vendorId.toString(16)} pid=0x${device.productId.toString(16)}`);

  const parser = new HidockFrameStreamParser();
  let messageId = 0;

  await device.open();
  try {
    if (!device.configuration) {
      await device.selectConfiguration(1);
    }
    await device.claimInterface(interfaceNumber);

    const infoFrame = await transact(device, parser, {
      commandId: 0x0001,
      messageId: messageId += 1,
      outEndpointNumber,
      inEndpointNumber,
      maxReads: 24,
    });
    console.log("\n[0x0001] Device Info");
    console.log(parseDeviceInfoBody(infoFrame.body));

    const timeFrame = await transact(device, parser, {
      commandId: 0x0002,
      messageId: messageId += 1,
      outEndpointNumber,
      inEndpointNumber,
      maxReads: 24,
    });
    console.log("\n[0x0002] Device Time");
    console.log({
      rawHex: toHex(timeFrame.body),
      parsedBcdDateTime: parseBcdDateTime(timeFrame.body),
    });

    const countFrame = await transact(device, parser, {
      commandId: 0x0006,
      messageId: messageId += 1,
      outEndpointNumber,
      inEndpointNumber,
      maxReads: 24,
    });
    const countInfo = parseFileCountBody(countFrame.body);
    console.log("\n[0x0006] File Count");
    console.log(countInfo);

    if (countInfo.count && countInfo.count > 0) {
      const listFrame = await transact(device, parser, {
        commandId: 0x0004,
        messageId: messageId += 1,
        outEndpointNumber,
        inEndpointNumber,
        maxReads: 256,
      });
      const parsedList = parseFileListBody(listFrame.body);
      console.log("\n[0x0004] File List");
      console.log(parsedList);

      // Validate file download command by reading first returned chunk.
      const candidateFile = parsedList.files[parsedList.files.length - 1];
      if (candidateFile) {
        const fileNameBody = textEncoder.encode(candidateFile.fileName);
        const fileChunkFrame = await transact(device, parser, {
          commandId: 0x0005,
          messageId: messageId += 1,
          body: fileNameBody,
          outEndpointNumber,
          inEndpointNumber,
          maxReads: 128,
        });
        console.log("\n[0x0005] First File Chunk");
        console.log({
          fileName: trimTrailingNul(candidateFile.fileName),
          chunkBytes: fileChunkFrame.body.length,
          leadingHex: toHex(fileChunkFrame.body.subarray(0, Math.min(64, fileChunkFrame.body.length))),
          startsWithId3:
            fileChunkFrame.body.length >= 3 &&
            fileChunkFrame.body[0] === 0x49 &&
            fileChunkFrame.body[1] === 0x44 &&
            fileChunkFrame.body[2] === 0x33,
        });
      }
    } else {
      console.log("\nSkipping 0x0004 because device returned zero files.");
    }
  } finally {
    try {
      await device.releaseInterface(interfaceNumber);
    } catch (error) {
      console.warn("releaseInterface warning:", error.message);
    }
    await device.close();
  }
}

main().catch((error) => {
  console.error("Live probe failed:", error);
  process.exitCode = 1;
});
