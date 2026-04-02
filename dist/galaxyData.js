import { promises as fs } from "node:fs";
import path from "node:path";
// ---------------------------------------------------------------------------
// Index-line parsing
// ---------------------------------------------------------------------------
/** Extract a field value from a pipe-delimited index line. */
export function extractField(line, fieldName) {
    // Fields look like:  `FieldName: value`  separated by  ` | `
    // The field value runs until the next ` | ` or end of line.
    const prefix = `${fieldName}: `;
    const idx = line.indexOf(prefix);
    if (idx === -1)
        return "";
    const start = idx + prefix.length;
    const pipeIdx = line.indexOf(" | ", start);
    return pipeIdx === -1 ? line.slice(start).trim() : line.slice(start, pipeIdx).trim();
}
/**
 * Parse a single meeting-index line.
 *
 * Meeting format:
 *   `- DateTime: ... | Title: ... | Attendee: ... | Brief: ... | Source: ... | Note: ...`
 *
 * Whisper format (subset):
 *   `- DateTime: ... | Brief: ... | Source: ... | Note: ...`
 */
export function parseIndexLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- DateTime:"))
        return null;
    const dateTimeRaw = extractField(trimmed, "DateTime");
    if (!dateTimeRaw)
        return null;
    const title = extractField(trimmed, "Title");
    const attendeeRaw = extractField(trimmed, "Attendee");
    const brief = extractField(trimmed, "Brief");
    const source = extractField(trimmed, "Source");
    const notePath = extractField(trimmed, "Note");
    // Parse attendees: comma-separated, trim each, drop "Unknown"
    const attendees = attendeeRaw
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a.length > 0 && a !== "Unknown");
    return {
        dateTime: dateTimeRaw,
        title,
        attendees,
        brief,
        source,
        notePath,
    };
}
// ---------------------------------------------------------------------------
// Tier extraction
// ---------------------------------------------------------------------------
/** Derive the storage tier from the relative note path. */
export function extractTier(notePath) {
    if (notePath.includes("/hotmem/") || notePath.includes("\\hotmem\\"))
        return "hotmem";
    if (notePath.includes("/warmmem/") || notePath.includes("\\warmmem\\"))
        return "warmmem";
    if (notePath.includes("/coldmem/") || notePath.includes("\\coldmem\\"))
        return "coldmem";
    // Default to coldmem when the path doesn't contain a recognisable tier.
    return "coldmem";
}
// ---------------------------------------------------------------------------
// Keyword extraction & Jaccard similarity (utility, used by project edges)
// ---------------------------------------------------------------------------
const STOP_WORDS = new Set([
    "a", "an", "the", "and", "or", "of", "to", "in", "for", "on", "with",
    "is", "it", "at", "by", "from", "as", "was", "are", "be", "this", "that",
    "no", "not", "but", "so", "if", "its", "has", "had", "have", "do", "does",
    "did", "will", "would", "can", "could", "may", "might", "shall", "should",
    "about", "been", "into", "than", "then", "them", "they", "their", "there",
    "these", "those", "we", "he", "she", "my", "me", "our", "you", "your",
    "i", "am",
]);
/** Additional stop words for entity extraction — generic meeting terms. */
const ENTITY_STOP_WORDS = new Set([
    ...STOP_WORDS,
    "meeting", "meetings", "discussion", "discussions", "discussing",
    "discussed", "overview", "conclusion", "summary", "recap", "update",
    "updates", "details", "information", "content", "available", "provided",
    "session", "acknowledgment", "conversation", "feedback", "question",
    "questions", "remarks", "closing", "plans", "noted", "new", "also",
    "first", "second", "third", "last", "next", "current", "recent",
    "brief", "note", "notes", "transcript", "unknown", "untitled",
]);
/** Extract lowercased keyword tokens from a text string. */
export function extractKeywords(text) {
    const words = text
        .toLowerCase()
        .replace(/[^a-z0-9\u00C0-\u024F\u4e00-\u9fff\uac00-\ud7af]+/g, " ")
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
    return new Set(words);
}
/** Jaccard similarity between two keyword sets. */
export function jaccardSimilarity(a, b) {
    if (a.size === 0 && b.size === 0)
        return 0;
    let intersectionSize = 0;
    for (const w of a) {
        if (b.has(w))
            intersectionSize++;
    }
    const unionSize = a.size + b.size - intersectionSize;
    return unionSize === 0 ? 0 : intersectionSize / unionSize;
}
// ---------------------------------------------------------------------------
// DateTime helpers
// ---------------------------------------------------------------------------
/** Convert the index datetime string (YYYY-MM-DD HH:MM:SS) to ISO 8601. */
export function toISO8601(dateTimeStr) {
    const cleaned = dateTimeStr.trim().replace(" ", "T");
    return cleaned;
}
/** Extract calendar date (YYYY-MM-DD) from a datetime string. */
export function extractCalendarDate(dateTimeStr) {
    return dateTimeStr.trim().slice(0, 10);
}
// ---------------------------------------------------------------------------
// Series detection — recurring meetings with identical titles
// ---------------------------------------------------------------------------
const GENERIC_TITLE_PATTERNS = [
    /^unknown/i,
    /^untitled$/i,
    /^whisper$/i,
];
/** Normalize a title for series grouping. */
export function normalizeTitle(title) {
    return title.toLowerCase().replace(/\s+/g, " ").trim();
}
/** Check if a title is generic (noise) and should not form series. */
export function isGenericTitle(title) {
    const normalized = normalizeTitle(title);
    if (normalized.length < 3)
        return true;
    return GENERIC_TITLE_PATTERNS.some((p) => p.test(normalized));
}
function buildSeriesEdges(nodes) {
    const groups = new Map();
    for (let i = 0; i < nodes.length; i++) {
        if (isGenericTitle(nodes[i].title))
            continue;
        const normalized = normalizeTitle(nodes[i].title);
        const group = groups.get(normalized);
        if (group) {
            group.push(i);
        }
        else {
            groups.set(normalized, [i]);
        }
    }
    const edges = [];
    for (const indices of groups.values()) {
        if (indices.length < 2)
            continue;
        for (let a = 0; a < indices.length; a++) {
            for (let b = a + 1; b < indices.length; b++) {
                edges.push({
                    source: nodes[indices[a]].id,
                    target: nodes[indices[b]].id,
                    type: "series",
                    weight: indices.length, // group size as weight
                });
            }
        }
    }
    return edges;
}
// ---------------------------------------------------------------------------
// Entity extraction — IDF-weighted significant terms for project clustering
// ---------------------------------------------------------------------------
/**
 * Extract entity tokens from text for project/topic matching.
 * Handles both Latin words and CJK bigrams.
 */
export function extractEntityTokens(text) {
    const tokens = [];
    // Latin words: lowercase, filter stop words and very short words
    const latinWords = text.match(/[a-zA-Z][a-zA-Z0-9]*/g) ?? [];
    for (const w of latinWords) {
        const lower = w.toLowerCase();
        if (lower.length > 1 && !ENTITY_STOP_WORDS.has(lower)) {
            tokens.push(lower);
        }
    }
    // CJK sequences: extract full sequences and bigrams for partial matching
    const cjkSequences = text.match(/[\u4e00-\u9fff\uac00-\ud7af]{2,}/g) ?? [];
    for (const seq of cjkSequences) {
        tokens.push(seq);
        // Also generate bigrams for cross-matching
        // e.g. "录音设备" → "录音", "音设", "设备"
        if (seq.length > 2) {
            for (let i = 0; i < seq.length - 1; i++) {
                tokens.push(seq.substring(i, i + 2));
            }
        }
    }
    return tokens;
}
const MAX_PROJECT_EDGES_PER_NODE = 5;
function buildProjectEdges(nodes) {
    // Extract entity tokens for each node
    const nodeTokens = nodes.map((n) => extractEntityTokens(`${n.title} ${n.brief}`));
    // Build document frequency: how many nodes contain each token
    const docFreq = new Map();
    for (const tokens of nodeTokens) {
        const unique = new Set(tokens);
        for (const token of unique) {
            docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
        }
    }
    // Significant terms: appear in 2+ docs but not more than 30% of all docs.
    // Terms appearing in too many docs are generic; terms in only 1 doc can't
    // connect anything.
    const maxDf = Math.max(Math.ceil(nodes.length * 0.3), 3);
    const significantTerms = new Set();
    for (const [term, df] of docFreq) {
        if (df >= 2 && df <= maxDf) {
            significantTerms.add(term);
        }
    }
    // Filter each node's tokens to only significant ones
    const nodeSignificant = nodeTokens.map((tokens) => {
        const filtered = new Set();
        for (const t of tokens) {
            if (significantTerms.has(t))
                filtered.add(t);
        }
        return filtered;
    });
    // Build candidate edges from shared significant terms
    const candidates = [];
    for (let i = 0; i < nodes.length; i++) {
        if (nodeSignificant[i].size === 0)
            continue;
        for (let j = i + 1; j < nodes.length; j++) {
            if (nodeSignificant[j].size === 0)
                continue;
            let shared = 0;
            for (const t of nodeSignificant[i]) {
                if (nodeSignificant[j].has(t))
                    shared++;
            }
            if (shared >= 1) {
                candidates.push({
                    source: nodes[i].id,
                    target: nodes[j].id,
                    type: "project",
                    weight: shared,
                });
            }
        }
    }
    // Sort descending by weight, cap to max edges per node
    candidates.sort((a, b) => b.weight - a.weight);
    const edgeCounts = new Map();
    const kept = [];
    for (const edge of candidates) {
        const countS = edgeCounts.get(edge.source) ?? 0;
        const countT = edgeCounts.get(edge.target) ?? 0;
        if (countS >= MAX_PROJECT_EDGES_PER_NODE || countT >= MAX_PROJECT_EDGES_PER_NODE) {
            continue;
        }
        kept.push(edge);
        edgeCounts.set(edge.source, countS + 1);
        edgeCounts.set(edge.target, countT + 1);
    }
    return kept;
}
// ---------------------------------------------------------------------------
// Attendee edges — shared named attendees
// ---------------------------------------------------------------------------
function buildAttendeeEdges(nodes) {
    const edges = [];
    for (let i = 0; i < nodes.length; i++) {
        const nodeI = nodes[i];
        if (nodeI.attendees.length === 0)
            continue;
        for (let j = i + 1; j < nodes.length; j++) {
            const nodeJ = nodes[j];
            if (nodeJ.attendees.length === 0)
                continue;
            const shared = nodeI.attendees.filter((a) => nodeJ.attendees.includes(a));
            if (shared.length > 0) {
                edges.push({
                    source: nodeI.id,
                    target: nodeJ.id,
                    type: "attendee",
                    weight: shared.length,
                });
            }
        }
    }
    return edges;
}
// ---------------------------------------------------------------------------
// Same-day edges — temporal proximity
// ---------------------------------------------------------------------------
function buildSameDayEdges(nodes) {
    const edges = [];
    const dateGroups = new Map();
    for (const node of nodes) {
        const date = extractCalendarDate(node.dateTime);
        const group = dateGroups.get(date);
        if (group) {
            group.push(node);
        }
        else {
            dateGroups.set(date, [node]);
        }
    }
    for (const group of dateGroups.values()) {
        if (group.length < 2)
            continue;
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                edges.push({
                    source: group[i].id,
                    target: group[j].id,
                    type: "sameDay",
                    weight: 1,
                });
            }
        }
    }
    return edges;
}
// ---------------------------------------------------------------------------
// Source type detection from filename
// ---------------------------------------------------------------------------
/** Detect recording source type from the source filename. */
export function detectSourceType(source) {
    const name = source.toLowerCase();
    if (/[-_]rec\d/i.test(name) || name.startsWith("rec"))
        return "rec";
    if (/[-_]wip\d/i.test(name) || name.startsWith("wip"))
        return "wip";
    if (/[-_]room\d/i.test(name) || name.startsWith("room"))
        return "room";
    if (/[-_]call\d/i.test(name) || name.startsWith("call"))
        return "call";
    if (/whsp/i.test(name))
        return "whsp";
    return "rec";
}
// ---------------------------------------------------------------------------
// Insight extraction from note summaries
// ---------------------------------------------------------------------------
async function readNoteSummary(notePath) {
    try {
        const content = await fs.readFile(notePath, "utf8");
        const match = content.match(/## Summary\n([\s\S]*?)(?=\n## |\n#\s|$)/);
        return match?.[1]?.trim() ?? "";
    }
    catch {
        return "";
    }
}
function categorizeInsight(text) {
    const lower = text.toLowerCase();
    if (/\b(need to|needs to|should|plan to|planning to|will\s|todo|to.do|action item|follow.?up|next step|must|待办|需要|计划|해야)\b/.test(lower))
        return "todo";
    if (/\b(completed?|achieved?|launched|delivered|finished|resolved|fixed|shipped|implemented|deployed|released|approved|完成|实现|达成|출시)\b/.test(lower))
        return "achievement";
    if (/\b(deadline|due\b|by (monday|tuesday|wednesday|thursday|friday|tomorrow|next)|remind|don't forget|remember to|important|截止|提醒|记住|마감)\b/.test(lower))
        return "reminder";
    if (/\b(could|might want|consider|suggest|recommend|idea|opportunity|potential|improve|optimize|建议|考虑|可以|改进|제안)\b/.test(lower))
        return "suggestion";
    return null;
}
async function buildInsights(nodes) {
    const hotNodes = nodes.filter((n) => n.tier === "hotmem");
    const summaryResults = await Promise.all(hotNodes.map(async (node) => ({
        node,
        summary: await readNoteSummary(node.notePath),
    })));
    const todos = [];
    const reminders = [];
    const achievements = [];
    const suggestions = [];
    for (const { node, summary } of summaryResults) {
        if (!summary)
            continue;
        // Split by sentence-ending punctuation (English + CJK)
        const sentences = summary
            .split(/[.!?。！？]+/)
            .map((s) => s.trim())
            .filter((s) => s.length > 5);
        for (const sentence of sentences) {
            const type = categorizeInsight(sentence);
            if (!type)
                continue;
            const item = {
                text: sentence,
                noteTitle: node.title,
                noteDate: node.dateTime,
                noteId: node.id,
            };
            switch (type) {
                case "todo":
                    todos.push(item);
                    break;
                case "reminder":
                    reminders.push(item);
                    break;
                case "achievement":
                    achievements.push(item);
                    break;
                case "suggestion":
                    suggestions.push(item);
                    break;
            }
        }
    }
    // Top recurring topics from entity extraction across hot nodes
    const tokenCounts = new Map();
    for (const node of hotNodes) {
        const tokens = extractEntityTokens(`${node.title} ${node.brief}`);
        const unique = new Set(tokens);
        for (const t of unique) {
            tokenCounts.set(t, (tokenCounts.get(t) ?? 0) + 1);
        }
    }
    const topTopics = [...tokenCounts.entries()]
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([topic, count]) => ({ topic, count }));
    return { todos, reminders, achievements, suggestions, topTopics };
}
// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------
async function detectRecentSources(storageDir, maxAgeMs) {
    const sources = new Set();
    const cutoff = Date.now() - maxAgeMs;
    for (const indexName of ["meetingindex.md", "whisperindex.md"]) {
        const lines = await readIndexLines(path.join(storageDir, indexName));
        for (const line of lines) {
            const entry = parseIndexLine(line);
            if (!entry)
                continue;
            const noteFullPath = path.join(storageDir, entry.notePath);
            try {
                const stat = await fs.stat(noteFullPath);
                if (stat.mtimeMs >= cutoff) {
                    sources.add(entry.source);
                }
            }
            catch {
                // file may not exist
            }
        }
    }
    return sources;
}
async function readIndexLines(indexPath) {
    try {
        const content = await fs.readFile(indexPath, "utf8");
        return content.split("\n");
    }
    catch {
        return [];
    }
}
export async function buildGalaxyData(options) {
    const { storageDir, newlySyncedSources } = options;
    // If no explicit newlySyncedSources, mark notes from the last 24h as new
    let newSourceSet;
    if (newlySyncedSources && newlySyncedSources.length > 0) {
        newSourceSet = new Set(newlySyncedSources);
    }
    else {
        newSourceSet = await detectRecentSources(storageDir, 24 * 60 * 60 * 1000);
    }
    const meetingIndexPath = path.join(storageDir, "meetingindex.md");
    const whisperIndexPath = path.join(storageDir, "whisperindex.md");
    const [meetingLines, whisperLines] = await Promise.all([
        readIndexLines(meetingIndexPath),
        readIndexLines(whisperIndexPath),
    ]);
    const nodes = [];
    // Parse meeting index
    for (const line of meetingLines) {
        const entry = parseIndexLine(line);
        if (!entry)
            continue;
        nodes.push({
            id: entry.notePath,
            title: entry.title || "Untitled",
            dateTime: toISO8601(entry.dateTime),
            attendees: entry.attendees,
            brief: entry.brief,
            source: entry.source,
            tier: extractTier(entry.notePath),
            kind: "meeting",
            sourceType: detectSourceType(entry.source),
            isNew: newSourceSet.has(entry.source),
            notePath: path.join(storageDir, entry.notePath),
        });
    }
    // Parse whisper index
    for (const line of whisperLines) {
        const entry = parseIndexLine(line);
        if (!entry)
            continue;
        nodes.push({
            id: entry.notePath,
            title: entry.title || "Whisper",
            dateTime: toISO8601(entry.dateTime),
            attendees: entry.attendees,
            brief: entry.brief,
            source: entry.source,
            tier: extractTier(entry.notePath),
            kind: "whisper",
            sourceType: detectSourceType(entry.source),
            isNew: newSourceSet.has(entry.source),
            notePath: path.join(storageDir, entry.notePath),
        });
    }
    // Build edges — four relationship types
    const attendeeEdges = buildAttendeeEdges(nodes);
    const sameDayEdges = buildSameDayEdges(nodes);
    const seriesEdges = buildSeriesEdges(nodes);
    const projectEdges = buildProjectEdges(nodes);
    // Build insights from hot memory notes
    const insights = await buildInsights(nodes);
    return {
        nodes,
        edges: [...seriesEdges, ...projectEdges, ...attendeeEdges, ...sameDayEdges],
        insights,
        generatedAt: new Date().toISOString(),
    };
}
//# sourceMappingURL=galaxyData.js.map