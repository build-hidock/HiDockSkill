export function concatBytes(...parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let cursor = 0;
    for (const part of parts) {
        out.set(part, cursor);
        cursor += part.length;
    }
    return out;
}
export function toHex(bytes) {
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(" ");
}
export function readU24BE(bytes, offset) {
    const b0 = getByte(bytes, offset);
    const b1 = getByte(bytes, offset + 1);
    const b2 = getByte(bytes, offset + 2);
    return (b0 << 16) | (b1 << 8) | b2;
}
export function writeU24BE(bytes, offset, value) {
    if (value < 0 || value > 0xffffff) {
        throw new RangeError(`u24 out of range: ${value}`);
    }
    bytes[offset] = (value >>> 16) & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = value & 0xff;
}
export function readU32BE(bytes, offset) {
    const b0 = getByte(bytes, offset);
    const b1 = getByte(bytes, offset + 1);
    const b2 = getByte(bytes, offset + 2);
    const b3 = getByte(bytes, offset + 3);
    return (b0 * 0x1000000 +
        (b1 << 16) +
        (b2 << 8) +
        b3);
}
export function writeU32BE(bytes, offset, value) {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
        throw new RangeError(`u32 out of range: ${value}`);
    }
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
}
export function trimTrailingNul(value) {
    return value.replace(/\u0000+$/g, "");
}
export function asArrayBuffer(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
function getByte(bytes, index) {
    const value = bytes[index];
    if (value === undefined) {
        throw new RangeError(`Byte index out of range: ${index}`);
    }
    return value;
}
//# sourceMappingURL=bytes.js.map