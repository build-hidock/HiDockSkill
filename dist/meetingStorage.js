import { promises as fs } from "node:fs";
import path from "node:path";
const DEFAULT_MEETINGS_DIR = "meetings";
const DEFAULT_WHISPERS_DIR = "whispers";
export const DEFAULT_HOT_TIER_MAX_AGE_DAYS = 30;
export const DEFAULT_WARM_TIER_MAX_AGE_DAYS = 180;
export const TIER_HOT_MAX_AGE_DAYS_ENV = "HIDOCK_NOTES_TIER_HOT_MAX_DAYS";
export const TIER_WARM_MAX_AGE_DAYS_ENV = "HIDOCK_NOTES_TIER_WARM_MAX_DAYS";
const MS_PER_DAY = 24 * 60 * 60 * 1000;
export class MeetingStorage {
    rootDir;
    meetingsDirName;
    whispersDirName;
    hotTierMaxAgeDays;
    warmTierMaxAgeDays;
    now;
    constructor(options) {
        this.rootDir = options.rootDir;
        this.meetingsDirName = options.meetingsDirName ?? DEFAULT_MEETINGS_DIR;
        this.whispersDirName = options.whispersDirName ?? DEFAULT_WHISPERS_DIR;
        this.hotTierMaxAgeDays = resolveTierThresholdDays(options.tierHotMaxAgeDays, parseTierDaysFromEnv(TIER_HOT_MAX_AGE_DAYS_ENV), DEFAULT_HOT_TIER_MAX_AGE_DAYS);
        this.warmTierMaxAgeDays = Math.max(this.hotTierMaxAgeDays, resolveTierThresholdDays(options.tierWarmMaxAgeDays, parseTierDaysFromEnv(TIER_WARM_MAX_AGE_DAYS_ENV), DEFAULT_WARM_TIER_MAX_AGE_DAYS));
        this.now = options.now ?? (() => new Date());
    }
    async saveMeeting(input) {
        await this.ensureStructure();
        const tier = this.selectTier(input.timestamp);
        const monthDir = path.join(this.rootDir, this.meetingsDirName, tier, formatMonthFolder(input.timestamp));
        await fs.mkdir(monthDir, { recursive: true });
        const indexPath = this.getIndexPath("meeting");
        if (await this.indexContainsSource(indexPath, input.sourceFileName)) {
            return {
                notePath: "",
                indexPath,
                relativeNotePath: "",
                skipped: true,
            };
        }
        const stamp = formatTimestampToken(input.timestamp);
        const titleSlug = slugify(input.title) || "meeting";
        const noteFilePath = await this.uniquePath(monthDir, `${stamp}-${titleSlug}.md`);
        const relativeNotePath = path
            .relative(this.rootDir, noteFilePath)
            .replaceAll(path.sep, "/");
        await fs.writeFile(noteFilePath, renderMeetingNote(input), "utf8");
        await this.ensureIndexHeader(indexPath, "# Meeting Index\n\n");
        const brief = truncateWords(input.brief, 14);
        const line = `- DateTime: ${formatDateTime(input.timestamp)} | ` +
            `Title: ${safeInline(input.title)} | ` +
            `Attendee: ${safeInline(input.attendee)} | ` +
            `Brief: ${safeInline(brief)} | ` +
            `Source: ${safeInline(input.sourceFileName)} | ` +
            `Note: ${relativeNotePath}\n`;
        await fs.appendFile(indexPath, line, "utf8");
        return {
            notePath: noteFilePath,
            indexPath,
            relativeNotePath,
            skipped: false,
        };
    }
    async saveWhisper(input) {
        await this.ensureStructure();
        const tier = this.selectTier(input.timestamp);
        const whisperDir = path.join(this.rootDir, this.whispersDirName, tier);
        await fs.mkdir(whisperDir, { recursive: true });
        const indexPath = this.getIndexPath("whisper");
        if (await this.indexContainsSource(indexPath, input.sourceFileName)) {
            return {
                notePath: "",
                indexPath,
                relativeNotePath: "",
                skipped: true,
            };
        }
        const stamp = formatTimestampToken(input.timestamp);
        const noteFilePath = await this.uniquePath(whisperDir, `${stamp}.md`);
        const relativeNotePath = path
            .relative(this.rootDir, noteFilePath)
            .replaceAll(path.sep, "/");
        await fs.writeFile(noteFilePath, renderWhisperNote(input), "utf8");
        await this.ensureIndexHeader(indexPath, "# Whisper Index\n\n");
        const brief = truncateWords(input.brief, 14);
        const line = `- DateTime: ${formatDateTime(input.timestamp)} | ` +
            `Brief: ${safeInline(brief)} | ` +
            `Source: ${safeInline(input.sourceFileName)} | ` +
            `Note: ${relativeNotePath}\n`;
        await fs.appendFile(indexPath, line, "utf8");
        return {
            notePath: noteFilePath,
            indexPath,
            relativeNotePath,
            skipped: false,
        };
    }
    async ensureStructure() {
        await fs.mkdir(this.rootDir, { recursive: true });
        await fs.mkdir(path.join(this.rootDir, this.meetingsDirName), {
            recursive: true,
        });
        await fs.mkdir(path.join(this.rootDir, this.whispersDirName), {
            recursive: true,
        });
    }
    getIndexPath(kind) {
        return path.join(this.rootDir, kind === "meeting" ? "meetingindex.md" : "whisperindex.md");
    }
    async isIndexed(sourceFileName, kind) {
        return this.indexContainsSource(this.getIndexPath(kind), sourceFileName);
    }
    selectTier(timestamp) {
        const ageDays = (this.now().getTime() - timestamp.getTime()) / MS_PER_DAY;
        return selectStorageTier(ageDays, this.hotTierMaxAgeDays, this.warmTierMaxAgeDays);
    }
    async ensureIndexHeader(indexPath, header) {
        try {
            await fs.access(indexPath);
        }
        catch {
            await fs.writeFile(indexPath, header, "utf8");
        }
    }
    async indexContainsSource(indexPath, sourceFileName) {
        try {
            const content = await fs.readFile(indexPath, "utf8");
            return content.includes(`Source: ${sourceFileName}`);
        }
        catch {
            return false;
        }
    }
    async uniquePath(dir, baseName) {
        const ext = path.extname(baseName);
        const stem = baseName.slice(0, baseName.length - ext.length);
        let candidate = path.join(dir, baseName);
        let counter = 1;
        while (true) {
            try {
                await fs.access(candidate);
                counter += 1;
                candidate = path.join(dir, `${stem}-${counter}${ext}`);
            }
            catch {
                return candidate;
            }
        }
    }
}
export function truncateWords(value, maxWords) {
    const words = value
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter((word) => word.length > 0);
    if (words.length <= maxWords) {
        return words.join(" ");
    }
    return words.slice(0, maxWords).join(" ");
}
export function formatMonthFolder(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${y}${m}`;
}
export function formatTimestampToken(date) {
    const month = MONTH_SHORT_UPPER[date.getMonth()] ?? "UNK";
    return (`${date.getFullYear()}` +
        `${month}` +
        `${String(date.getDate()).padStart(2, "0")}` +
        `-${String(date.getHours()).padStart(2, "0")}` +
        `${String(date.getMinutes()).padStart(2, "0")}` +
        `${String(date.getSeconds()).padStart(2, "0")}`);
}
export function formatDateTime(date) {
    return (`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ` +
        `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`);
}
export function selectStorageTier(ageDays, hotTierMaxAgeDays = DEFAULT_HOT_TIER_MAX_AGE_DAYS, warmTierMaxAgeDays = DEFAULT_WARM_TIER_MAX_AGE_DAYS) {
    const normalizedAgeDays = Number.isFinite(ageDays) ? Math.max(0, ageDays) : Number.MAX_VALUE;
    const normalizedHotMax = normalizeTierDays(hotTierMaxAgeDays, DEFAULT_HOT_TIER_MAX_AGE_DAYS);
    const normalizedWarmMax = Math.max(normalizedHotMax, normalizeTierDays(warmTierMaxAgeDays, DEFAULT_WARM_TIER_MAX_AGE_DAYS));
    if (normalizedAgeDays <= normalizedHotMax) {
        return "hot";
    }
    if (normalizedAgeDays <= normalizedWarmMax) {
        return "warm";
    }
    return "cold";
}
const MONTH_SHORT_UPPER = [
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
];
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48);
}
function safeInline(value) {
    return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}
function resolveTierThresholdDays(optionsValue, envValue, fallback) {
    if (typeof optionsValue === "number") {
        return normalizeTierDays(optionsValue, fallback);
    }
    if (typeof envValue === "number") {
        return normalizeTierDays(envValue, fallback);
    }
    return fallback;
}
function parseTierDaysFromEnv(envName) {
    const raw = process.env[envName];
    if (!raw) {
        return undefined;
    }
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        return undefined;
    }
    return parsed;
}
function normalizeTierDays(value, fallback) {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return Math.max(0, Math.floor(value));
}
function renderMeetingNote(input) {
    const brief = truncateWords(input.brief, 14);
    return (`# ${input.title}\n\n` +
        `- DateTime: ${formatDateTime(input.timestamp)}\n` +
        `- Attendee: ${input.attendee}\n` +
        `- Brief: ${brief}\n` +
        `- Source: ${input.sourceFileName}\n\n` +
        `## Summary\n\n` +
        `${input.summary.trim() || "N/A"}\n\n` +
        `## Transcript\n\n` +
        `${input.transcript.trim() || "N/A"}\n`);
}
function renderWhisperNote(input) {
    const brief = truncateWords(input.brief, 14);
    return (`# Whisper ${formatTimestampToken(input.timestamp)}\n\n` +
        `- DateTime: ${formatDateTime(input.timestamp)}\n` +
        `- Brief: ${brief}\n` +
        `- Source: ${input.sourceFileName}\n\n` +
        `## Summary\n\n` +
        `${input.summary.trim() || "N/A"}\n\n` +
        `## Transcript\n\n` +
        `${input.transcript.trim() || "N/A"}\n`);
}
//# sourceMappingURL=meetingStorage.js.map