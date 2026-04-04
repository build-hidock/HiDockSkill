import { concatBytes, trimTrailingNul, writeU32BE } from "./bytes.js";
import { HiDockCommand } from "./commands.js";
import {
  HiDockFileEntry,
  HiDockFileList,
  parseHiDockFileListBody,
} from "./fileList.js";
import {
  HiDockDeviceInfo,
  HiDockDeviceTime,
  parseDeviceInfoBody,
  parseDeviceTimeBody,
  parseFileCountBody,
} from "./parsers.js";
import { HiDockFrame } from "./protocol.js";
import { HiDockTransportOptions, HiDockWebUsbTransport, UsbDeviceLike } from "./transport.js";

const textEncoder = new TextEncoder();

export interface DownloadFileOptions {
  expectedSize?: number;
  readLimit?: number;
  readTimeoutMs?: number;
  onProgress?: (receivedBytes: number, expectedBytes: number) => void;
}

const DEFAULT_READ_TIMEOUT_MS = 30_000; // 30s stale-read timeout

export interface HiDockTransportLike {
  open(): Promise<void>;
  close(): Promise<void>;
  sendCommand(commandId: number, messageId: number, body?: Uint8Array): Promise<void>;
  readFrames(): Promise<HiDockFrame[]>;
  requestResponseFrame(
    commandId: number,
    messageId: number,
    body?: Uint8Array,
    readLimit?: number,
  ): Promise<HiDockFrame>;
}

export class HiDockClient {
  private readonly transport: HiDockTransportLike;
  private messageId = 0;
  private connected = false;

  constructor(transport: HiDockTransportLike) {
    this.transport = transport;
  }

  static fromUsbDevice(
    device: UsbDeviceLike,
    options: HiDockTransportOptions = {},
  ): HiDockClient {
    return new HiDockClient(new HiDockWebUsbTransport(device, options));
  }

  async open(): Promise<void> {
    if (this.connected) {
      return;
    }
    await this.transport.open();
    this.connected = true;
  }

  async close(): Promise<void> {
    if (!this.connected) {
      return;
    }
    try {
      await this.transport.close();
    } finally {
      this.connected = false;
    }
  }

  async withConnection<T>(run: () => Promise<T>): Promise<T> {
    await this.open();
    try {
      return await run();
    } finally {
      await this.close();
    }
  }

  async getDeviceInfo(): Promise<HiDockDeviceInfo> {
    const frame = await this.requestSingle(HiDockCommand.QUERY_DEVICE_INFO);
    return parseDeviceInfoBody(frame.body);
  }

  async getDeviceTime(): Promise<HiDockDeviceTime> {
    const frame = await this.requestSingle(HiDockCommand.QUERY_DEVICE_TIME);
    return parseDeviceTimeBody(frame.body);
  }

  async getFileCount(): Promise<number> {
    const frame = await this.requestSingle(HiDockCommand.QUERY_FILE_COUNT);
    return parseFileCountBody(frame.body);
  }

  async listFiles(): Promise<HiDockFileList> {
    const frame = await this.requestSingle(HiDockCommand.QUERY_FILE_LIST, undefined, 256);
    return parseHiDockFileListBody(frame.body);
  }

  async readFileHead(
    file: Pick<HiDockFileEntry, "rawFileNameBytes"> | string,
    byteLength: number,
  ): Promise<Uint8Array> {
    const body = new Uint8Array(4 + this.getFileNameBytes(file).length);
    writeU32BE(body, 0, byteLength);
    body.set(this.getFileNameBytes(file), 4);

    const messageId = this.nextMessageId();
    await this.transport.sendCommand(HiDockCommand.TRANSFER_FILE_HEAD, messageId, body);
    return this.collectCommandBytes(
      HiDockCommand.TRANSFER_FILE_HEAD,
      messageId,
      byteLength,
      64,
    );
  }

  async downloadFile(
    file: HiDockFileEntry | string,
    options: DownloadFileOptions = {},
  ): Promise<Uint8Array> {
    const target = await this.resolveFileTarget(file, options.expectedSize);
    const expectedSize = options.expectedSize ?? target.fileSize;
    if (expectedSize <= 0) {
      throw new Error(
        "Expected file size is unknown. Pass expectedSize or download from a listed file entry.",
      );
    }
    const readLimit = options.readLimit ?? 4096;

    const messageId = this.nextMessageId();
    await this.transport.sendCommand(
      HiDockCommand.TRANSFER_FILE,
      messageId,
      target.rawFileNameBytes,
    );

    return this.collectCommandBytes(
      HiDockCommand.TRANSFER_FILE,
      messageId,
      expectedSize,
      readLimit,
      options.onProgress,
      options.readTimeoutMs ?? DEFAULT_READ_TIMEOUT_MS,
    );
  }

  private async collectCommandBytes(
    commandId: number,
    messageId: number,
    expectedSize: number,
    readLimit: number,
    onProgress?: (receivedBytes: number, expectedBytes: number) => void,
    readTimeoutMs: number = DEFAULT_READ_TIMEOUT_MS,
  ): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    let received = 0;

    for (let reads = 0; reads < readLimit && received < expectedSize; reads += 1) {
      const frames = await Promise.race([
        this.transport.readFrames(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(
            `USB read timeout after ${readTimeoutMs / 1000}s (received ${received}/${expectedSize} bytes)`,
          )), readTimeoutMs),
        ),
      ]);
      for (const frame of frames) {
        if (frame.commandId !== commandId) {
          continue;
        }

        // H1 firmware streams TRANSFER_FILE chunks with auto-incremented messageId
        // (startId, startId+1, ...), while older devices may reuse the same id.
        // Accept both patterns for file transfer commands.
        if (
          commandId !== HiDockCommand.TRANSFER_FILE &&
          frame.messageId !== messageId
        ) {
          continue;
        }
        if (
          commandId === HiDockCommand.TRANSFER_FILE &&
          frame.messageId < messageId
        ) {
          continue;
        }
        if (frame.body.length === 0) {
          continue;
        }
        chunks.push(frame.body);
        received += frame.body.length;
        if (onProgress) {
          onProgress(Math.min(received, expectedSize), expectedSize);
        }
        if (received >= expectedSize) {
          break;
        }
      }
    }

    if (received < expectedSize) {
      throw new Error(
        `Incomplete transfer for command=0x${commandId.toString(16)}: expected ${expectedSize}, got ${received}`,
      );
    }

    const all = concatBytes(...chunks);
    return all.length === expectedSize ? all : all.subarray(0, expectedSize);
  }

  private async resolveFileTarget(
    file: HiDockFileEntry | string,
    expectedSize?: number,
  ): Promise<{ fileSize: number; rawFileNameBytes: Uint8Array }> {
    if (typeof file !== "string") {
      return { fileSize: file.fileSize, rawFileNameBytes: file.rawFileNameBytes };
    }

    const fileName = trimTrailingNul(file);
    const list = await this.listFiles();
    const matched = list.files.find((entry) => entry.fileName === fileName);
    if (!matched) {
      if (!expectedSize || expectedSize <= 0) {
        throw new Error(
          `File "${fileName}" not found in device list. Provide expectedSize to download by name.`,
        );
      }
      return {
        fileSize: expectedSize,
        rawFileNameBytes: ensureTrailingNul(textEncoder.encode(fileName)),
      };
    }
    return { fileSize: matched.fileSize, rawFileNameBytes: matched.rawFileNameBytes };
  }

  private getFileNameBytes(file: Pick<HiDockFileEntry, "rawFileNameBytes"> | string): Uint8Array {
    if (typeof file === "string") {
      return ensureTrailingNul(textEncoder.encode(trimTrailingNul(file)));
    }
    return file.rawFileNameBytes;
  }

  private async requestSingle(
    commandId: number,
    body?: Uint8Array,
    readLimit?: number,
  ): Promise<HiDockFrame> {
    return this.transport.requestResponseFrame(
      commandId,
      this.nextMessageId(),
      body,
      readLimit,
    );
  }

  private nextMessageId(): number {
    this.messageId = (this.messageId + 1) >>> 0;
    return this.messageId;
  }
}

function ensureTrailingNul(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 0 && bytes[bytes.length - 1] === 0x00) {
    return bytes;
  }
  const value = new Uint8Array(bytes.length + 1);
  value.set(bytes, 0);
  value[value.length - 1] = 0x00;
  return value;
}
