import { asArrayBuffer } from "./bytes.js";
import {
  HiDockFrame,
  HiDockFrameStreamParser,
  encodeHiDockFrame,
} from "./protocol.js";

export type UsbTransferStatusLike = "ok" | "stall" | "babble";

export interface UsbInTransferResultLike {
  status: UsbTransferStatusLike;
  data?: DataView | null;
}

export interface UsbOutTransferResultLike {
  status: UsbTransferStatusLike;
  bytesWritten?: number;
}

export interface UsbDeviceLike {
  readonly configuration: object | null;
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  transferIn(
    endpointNumber: number,
    length: number,
  ): Promise<UsbInTransferResultLike>;
  transferOut(
    endpointNumber: number,
    data: ArrayBuffer,
  ): Promise<UsbOutTransferResultLike>;
}

export interface HiDockTransportOptions {
  interfaceNumber?: number;
  outEndpointNumber?: number;
  inEndpointNumber?: number;
  readLength?: number;
  defaultResponseReadLimit?: number;
}

const DEFAULT_INTERFACE_NUMBER = 0;
const DEFAULT_OUT_ENDPOINT = 1;
const DEFAULT_IN_ENDPOINT = 2;
const DEFAULT_READ_LENGTH = 8192;
const DEFAULT_RESPONSE_READ_LIMIT = 64;

export class HiDockWebUsbTransport {
  readonly interfaceNumber: number;
  readonly outEndpointNumber: number;
  readonly inEndpointNumber: number;
  readonly readLength: number;
  readonly defaultResponseReadLimit: number;

  private readonly parser = new HiDockFrameStreamParser();
  private readonly device: UsbDeviceLike;

  constructor(device: UsbDeviceLike, options: HiDockTransportOptions = {}) {
    this.device = device;
    this.interfaceNumber = options.interfaceNumber ?? DEFAULT_INTERFACE_NUMBER;
    this.outEndpointNumber = options.outEndpointNumber ?? DEFAULT_OUT_ENDPOINT;
    this.inEndpointNumber = options.inEndpointNumber ?? DEFAULT_IN_ENDPOINT;
    this.readLength = options.readLength ?? DEFAULT_READ_LENGTH;
    this.defaultResponseReadLimit =
      options.defaultResponseReadLimit ?? DEFAULT_RESPONSE_READ_LIMIT;
  }

  async open(): Promise<void> {
    await this.device.open();
    if (!this.device.configuration) {
      await this.device.selectConfiguration(1);
    }
    await this.device.claimInterface(this.interfaceNumber);
  }

  async close(): Promise<void> {
    try {
      await this.device.releaseInterface(this.interfaceNumber);
    } finally {
      await this.device.close();
      this.parser.reset();
    }
  }

  resetParser(): void {
    this.parser.reset();
  }

  async sendCommand(
    commandId: number,
    messageId: number,
    body: Uint8Array = new Uint8Array(0),
  ): Promise<void> {
    const frame = encodeHiDockFrame(commandId, messageId, body);
    const result = await this.device.transferOut(
      this.outEndpointNumber,
      asArrayBuffer(frame),
    );
    if (result.status !== "ok") {
      throw new Error(
        `transferOut failed: status=${result.status}, command=0x${commandId.toString(16)}`,
      );
    }
  }

  async readFrames(): Promise<HiDockFrame[]> {
    const result = await this.device.transferIn(
      this.inEndpointNumber,
      this.readLength,
    );
    if (result.status !== "ok") {
      return [];
    }
    if (!result.data || result.data.byteLength === 0) {
      return [];
    }

    const bytes = new Uint8Array(
      result.data.buffer,
      result.data.byteOffset,
      result.data.byteLength,
    );
    return this.parser.feed(bytes);
  }

  async requestResponseFrame(
    commandId: number,
    messageId: number,
    body: Uint8Array = new Uint8Array(0),
    readLimit: number = this.defaultResponseReadLimit,
  ): Promise<HiDockFrame> {
    await this.sendCommand(commandId, messageId, body);

    for (let reads = 0; reads < readLimit; reads += 1) {
      const frames = await this.readFrames();
      for (const frame of frames) {
        if (frame.commandId === commandId && frame.messageId === messageId) {
          return frame;
        }
      }
    }

    throw new Error(
      `No response for command=0x${commandId.toString(16)} messageId=${messageId}`,
    );
  }
}
