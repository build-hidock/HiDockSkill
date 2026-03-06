import { readU24BE, readU32BE, toHex, trimTrailingNul } from "./bytes.js";

const textDecoder = new TextDecoder();

export interface HiDockAudioProfile {
  codec: "mp3" | "wav";
  sampleRateHz: number;
  channels: number;
  bitrateBps?: number;
  bitsPerSample?: number;
  headerBytes?: number;
}

const AUDIO_PROFILES: Readonly<Record<number, HiDockAudioProfile>> = {
  0x00: { codec: "mp3", sampleRateHz: 16000, channels: 1, bitrateBps: 64000 },
  0x01: { codec: "mp3", sampleRateHz: 16000, channels: 1, bitrateBps: 32000 },
  0x02: {
    codec: "wav",
    sampleRateHz: 48000,
    channels: 1,
    bitsPerSample: 16,
    headerBytes: 44,
  },
  0x03: {
    codec: "wav",
    sampleRateHz: 48000,
    channels: 2,
    bitsPerSample: 16,
    headerBytes: 44,
  },
  0x04: { codec: "mp3", sampleRateHz: 48000, channels: 1, bitrateBps: 64000 },
  0x05: { codec: "mp3", sampleRateHz: 48000, channels: 1, bitrateBps: 96000 },
  0x06: { codec: "mp3", sampleRateHz: 16000, channels: 2, bitrateBps: 128000 },
  0x07: { codec: "mp3", sampleRateHz: 16000, channels: 2, bitrateBps: 80000 },
};

export interface HiDockFileEntry {
  fileVersion: number;
  fileName: string;
  rawFileNameBytes: Uint8Array;
  fileSize: number;
  modifiedAtRaw: Uint8Array;
  modifiedAtBcd: string | null;
  md5Hex: string;
  audioProfile: HiDockAudioProfile | null;
  estimatedDurationSeconds: number | null;
}

export interface HiDockFileList {
  fileCount: number;
  files: HiDockFileEntry[];
  trailingBytes: number;
}

export function getAudioProfileByVersion(
  fileVersion: number,
): HiDockAudioProfile | null {
  return AUDIO_PROFILES[fileVersion] ?? null;
}

export function parseHiDockFileListBody(body: Uint8Array): HiDockFileList {
  if (body.length === 0) {
    return { fileCount: 0, files: [], trailingBytes: 0 };
  }
  if (body.length < 6) {
    throw new Error(`Invalid file list body length: ${body.length}`);
  }
  if (body[0] !== 0xff || body[1] !== 0xff) {
    throw new Error(
      `Invalid file list marker: ${toHex(body.subarray(0, 2))}`,
    );
  }

  const fileCount = readU32BE(body, 2);
  const files: HiDockFileEntry[] = [];
  let cursor = 6;

  for (let index = 0; index < fileCount; index += 1) {
    if (cursor + 1 + 3 + 4 + 6 + 16 > body.length) {
      throw new Error(`File entry ${index} is truncated`);
    }

    const fileVersion = body[cursor];
    if (fileVersion === undefined) {
      throw new Error(`File entry ${index} is truncated at fileVersion`);
    }
    cursor += 1;

    const fileNameLength = readU24BE(body, cursor);
    cursor += 3;
    if (cursor + fileNameLength + 4 + 6 + 16 > body.length) {
      throw new Error(
        `File entry ${index} has invalid fileNameLength=${fileNameLength}`,
      );
    }

    const rawFileNameBytes = Uint8Array.from(
      body.subarray(cursor, cursor + fileNameLength),
    );
    const fileName = trimTrailingNul(textDecoder.decode(rawFileNameBytes));
    cursor += fileNameLength;

    const fileSize = readU32BE(body, cursor);
    cursor += 4;

    const modifiedAtRaw = Uint8Array.from(body.subarray(cursor, cursor + 6));
    cursor += 6;

    const md5Bytes = body.subarray(cursor, cursor + 16);
    cursor += 16;

    const audioProfile = getAudioProfileByVersion(fileVersion);

    files.push({
      fileVersion,
      fileName,
      rawFileNameBytes,
      fileSize,
      modifiedAtRaw,
      modifiedAtBcd: decodeBcdCompact(modifiedAtRaw),
      md5Hex: toHex(md5Bytes).replaceAll(" ", ""),
      audioProfile,
      estimatedDurationSeconds: estimateDurationSeconds(audioProfile, fileSize),
    });
  }

  return {
    fileCount,
    files,
    trailingBytes: body.length - cursor,
  };
}

function decodeBcdCompact(value: Uint8Array): string | null {
  const allNibblesDecimal = value.every(
    (byte) => (byte >> 4) <= 9 && (byte & 0x0f) <= 9,
  );
  if (!allNibblesDecimal) {
    return null;
  }

  const digits = Array.from(value, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  if (!/^\d{12}$/.test(digits)) {
    return null;
  }

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)} ${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
}

function estimateDurationSeconds(
  profile: HiDockAudioProfile | null,
  fileSize: number,
): number | null {
  if (!profile) {
    return null;
  }
  if (profile.codec === "mp3" && profile.bitrateBps) {
    return fileSize / (profile.bitrateBps / 8);
  }
  if (profile.codec === "wav" && profile.bitsPerSample && profile.headerBytes) {
    const payloadBytes = Math.max(0, fileSize - profile.headerBytes);
    const bytesPerSample = profile.bitsPerSample / 8;
    return payloadBytes / (profile.sampleRateHz * profile.channels * bytesPerSample);
  }
  return null;
}

export function detectAudioContainer(
  data: Uint8Array,
): "mp3" | "wav" | "unknown" {
  if (data.length >= 12) {
    const riff = data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46;
    const wave = data[8] === 0x57 && data[9] === 0x41 && data[10] === 0x56 && data[11] === 0x45;
    if (riff && wave) {
      return "wav";
    }
  }

  if (data.length >= 3) {
    const id3 = data[0] === 0x49 && data[1] === 0x44 && data[2] === 0x33;
    const mp3FrameSync = data[0] === 0xff && ((data[1] ?? 0) & 0xe0) === 0xe0;
    if (id3 || mp3FrameSync) {
      return "mp3";
    }
  }

  return "unknown";
}
