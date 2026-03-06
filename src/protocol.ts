import { concatBytes, readU32BE, toHex, writeU32BE } from "./bytes.js";

export const HIDOCK_FRAME_HEADER = 0x1234;
export const HIDOCK_FRAME_HEADER_HI = 0x12;
export const HIDOCK_FRAME_HEADER_LO = 0x34;
export const HIDOCK_FRAME_HEADER_BYTES = 12;

export interface HiDockFrame {
  commandId: number;
  messageId: number;
  bodyLength: number;
  body: Uint8Array;
}

export function encodeHiDockFrame(
  commandId: number,
  messageId: number,
  body: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const frame = new Uint8Array(HIDOCK_FRAME_HEADER_BYTES + body.length);
  frame[0] = HIDOCK_FRAME_HEADER_HI;
  frame[1] = HIDOCK_FRAME_HEADER_LO;
  frame[2] = (commandId >>> 8) & 0xff;
  frame[3] = commandId & 0xff;
  writeU32BE(frame, 4, messageId >>> 0);
  writeU32BE(frame, 8, body.length >>> 0);
  frame.set(body, HIDOCK_FRAME_HEADER_BYTES);
  return frame;
}

export function decodeHiDockFrame(frameBytes: Uint8Array): HiDockFrame {
  if (frameBytes.length < HIDOCK_FRAME_HEADER_BYTES) {
    throw new Error(`Frame too short: ${frameBytes.length}`);
  }
  if (
    frameBytes[0] !== HIDOCK_FRAME_HEADER_HI ||
    frameBytes[1] !== HIDOCK_FRAME_HEADER_LO
  ) {
    throw new Error(`Invalid frame header: ${toHex(frameBytes.subarray(0, 2))}`);
  }

  const cmdHi = frameBytes[2];
  const cmdLo = frameBytes[3];
  if (cmdHi === undefined || cmdLo === undefined) {
    throw new Error("Frame command bytes are missing");
  }
  const commandId = (cmdHi << 8) | cmdLo;
  const messageId = readU32BE(frameBytes, 4);
  const bodyLength = readU32BE(frameBytes, 8);
  const expectedLength = HIDOCK_FRAME_HEADER_BYTES + bodyLength;
  if (frameBytes.length !== expectedLength) {
    throw new Error(
      `Frame length mismatch: got ${frameBytes.length}, expected ${expectedLength}`,
    );
  }

  return {
    commandId,
    messageId,
    bodyLength,
    body: frameBytes.subarray(HIDOCK_FRAME_HEADER_BYTES),
  };
}

export class HiDockFrameStreamParser {
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  feed(chunk: Uint8Array): HiDockFrame[] {
    this.buffer = concatBytes(this.buffer, chunk);
    const frames: HiDockFrame[] = [];

    while (this.buffer.length >= HIDOCK_FRAME_HEADER_BYTES) {
      if (
        this.buffer[0] !== HIDOCK_FRAME_HEADER_HI ||
        this.buffer[1] !== HIDOCK_FRAME_HEADER_LO
      ) {
        const headerOffset = this.findHeaderOffset();
        if (headerOffset < 0) {
          this.buffer = new Uint8Array(0);
          break;
        }
        this.buffer = this.buffer.subarray(headerOffset);
        if (this.buffer.length < HIDOCK_FRAME_HEADER_BYTES) {
          break;
        }
      }

      const bodyLength = readU32BE(this.buffer, 8);
      const frameLength = HIDOCK_FRAME_HEADER_BYTES + bodyLength;
      if (this.buffer.length < frameLength) {
        break;
      }

      const frameBytes = this.buffer.subarray(0, frameLength);
      frames.push(decodeHiDockFrame(frameBytes));
      this.buffer = this.buffer.subarray(frameLength);
    }

    return frames;
  }

  reset(): void {
    this.buffer = new Uint8Array(0);
  }

  private findHeaderOffset(): number {
    for (let index = 0; index < this.buffer.length - 1; index += 1) {
      if (
        this.buffer[index] === HIDOCK_FRAME_HEADER_HI &&
        this.buffer[index + 1] === HIDOCK_FRAME_HEADER_LO
      ) {
        return index;
      }
    }
    return -1;
  }
}
