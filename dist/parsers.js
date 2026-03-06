import { readU32BE, toHex, trimTrailingNul } from "./bytes.js";
const textDecoder = new TextDecoder();
export function parseDeviceInfoBody(body) {
    if (body.length < 4) {
        return {
            version: "unknown",
            serialNumber: "",
            rawHex: toHex(body),
        };
    }
    const versionParts = [body[0], body[1], body[2], body[3]];
    const version = versionParts.join(".");
    const serialNumberRaw = body.subarray(4);
    const serialNumber = trimTrailingNul(textDecoder.decode(serialNumberRaw).replace(/\u0000/g, "")).trim();
    return {
        version,
        serialNumber,
        rawHex: toHex(body),
    };
}
export function parseDeviceTimeBody(body) {
    return {
        bcdDateTime: decodeBcdDateTime(body),
        rawHex: toHex(body),
    };
}
export function parseFileCountBody(body) {
    if (body.length === 0) {
        return 0;
    }
    if (body.length !== 4) {
        throw new Error(`Invalid file count body length: ${body.length}`);
    }
    return readU32BE(body, 0);
}
function decodeBcdDateTime(value) {
    if (value.length !== 7) {
        return null;
    }
    const allNibblesDecimal = value.every((byte) => (byte >> 4) <= 9 && (byte & 0x0f) <= 9);
    if (!allNibblesDecimal) {
        return null;
    }
    const digits = Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!/^\d{14}$/.test(digits)) {
        return null;
    }
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)} ${digits.slice(8, 10)}:${digits.slice(10, 12)}:${digits.slice(12, 14)}`;
}
//# sourceMappingURL=parsers.js.map