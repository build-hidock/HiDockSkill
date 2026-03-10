import { promises as fs } from "node:fs";
import path from "node:path";

import type { StorageTier, DocumentKind } from "./meetingStorage.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GalaxyNode {
  id: string;
  title: string;
  dateTime: string; // ISO 8601
  attendees: string[];
  brief: string;
  source: string;
  tier: StorageTier;
  kind: DocumentKind;
  isNew: boolean;
  notePath: string; // full path to .md file
}

export interface GalaxyEdge {
  source: string;
  target: string;
  type: "attendee" | "sameDay" | "series" | "project";
  weight: number;
}

export interface GalaxyGraphData {
  nodes: GalaxyNode[];
  edges: GalaxyEdge[];
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Index-line parsing
// ---------------------------------------------------------------------------

/** Extract a field value from a pipe-delimited index line. */
export function extractField(line: string, fieldName: string): string {
  // Fields look like:  `FieldName: value`  separated by  ` | `
  // The field value runs until the next ` | ` or end of line.
  const prefix = `${fieldName}: `;
  const idx = line.indexOf(prefix);
  if (idx === -1) return "";

  const start = idx + prefix.length;
  const pipeIdx = line.indexOf(" | ", start);
  return pipeIdx === -1 ? line.slice(start).trim() : line.slice(start, pipeIdx).trim();
}

export interface ParsedIndexEntry {
  dateTime: string;
  title: string;
  attendees: string[];
  brief: string;
  source: string;
  notePath: string; // relative path as written in the index
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
export function parseIndexLine(line: string): ParsedIndexEntry | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- DateTime:")) return null;

  const dateTimeRaw = extractField(trimmed, "DateTime");
  if (!dateTimeRaw) return null;

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
export function extractTier(notePath: string): StorageTier {
  if (notePath.includes("/hotmem/") || notePath.includes("\\hotmem\\")) return "hotmem";
  if (notePath.includes("/warmmem/") || notePath.includes("\\warmmem\\")) return "warmmem";
  if (notePath.includes("/coldmem/") || notePath.includes("\\coldmem\\")) return "coldmem";
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
export function extractKeywords(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u4e00-\u9fff\uac00-\ud7af]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return new Set(words);
}

/** Jaccard similarity between two keyword sets. */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersectionSize = 0;
  for (const w of a) {
    if (b.has(w)) intersectionSize++;
  }
  const unionSize = a.size + b.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

// ---------------------------------------------------------------------------
// DateTime helpers
// ---------------------------------------------------------------------------

/** Convert the index datetime string (YYYY-MM-DD HH:MM:SS) to ISO 8601. */
export function toISO8601(dateTimeStr: string): string {
  const cleaned = dateTimeStr.trim().replace(" ", "T");
  return cleaned;
}

/** Extract calendar date (YYYY-MM-DD) from a datetime string. */
export function extractCalendarDate(dateTimeStr: string): string {
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
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Check if a title is generic (noise) and should not form series. */
export function isGenericTitle(title: string): boolean {
  const normalized = normalizeTitle(title);
  if (normalized.length < 3) return true;
  return GENERIC_TITLE_PATTERNS.some((p) => p.test(normalized));
}

function buildSeriesEdges(nodes: GalaxyNode[]): GalaxyEdge[] {
  const groups = new Map<string, number[]>();

  for (let i = 0; i < nodes.length; i++) {
    if (isGenericTitle(nodes[i]!.title)) continue;
    const normalized = normalizeTitle(nodes[i]!.title);
    const group = groups.get(normalized);
    if (group) {
      group.push(i);
    } else {
      groups.set(normalized, [i]);
    }
  }

  const edges: GalaxyEdge[] = [];
  for (const indices of groups.values()) {
    if (indices.length < 2) continue;
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        edges.push({
          source: nodes[indices[a]!]!.id,
          target: nodes[indices[b]!]!.id,
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
export function extractEntityTokens(text: string): string[] {
  const tokens: string[] = [];

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

function buildProjectEdges(nodes: GalaxyNode[]): GalaxyEdge[] {
  // Extract entity tokens for each node
  const nodeTokens = nodes.map((n) =>
    extractEntityTokens(`${n.title} ${n.brief}`),
  );

  // Build document frequency: how many nodes contain each token
  const docFreq = new Map<string, number>();
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
  const significantTerms = new Set<string>();
  for (const [term, df] of docFreq) {
    if (df >= 2 && df <= maxDf) {
      significantTerms.add(term);
    }
  }

  // Filter each node's tokens to only significant ones
  const nodeSignificant: Set<string>[] = nodeTokens.map((tokens) => {
    const filtered = new Set<string>();
    for (const t of tokens) {
      if (significantTerms.has(t)) filtered.add(t);
    }
    return filtered;
  });

  // Build candidate edges from shared significant terms
  const candidates: GalaxyEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodeSignificant[i]!.size === 0) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      if (nodeSignificant[j]!.size === 0) continue;

      let shared = 0;
      for (const t of nodeSignificant[i]!) {
        if (nodeSignificant[j]!.has(t)) shared++;
      }

      if (shared >= 1) {
        candidates.push({
          source: nodes[i]!.id,
          target: nodes[j]!.id,
          type: "project",
          weight: shared,
        });
      }
    }
  }

  // Sort descending by weight, cap to max edges per node
  candidates.sort((a, b) => b.weight - a.weight);
  const edgeCounts = new Map<string, number>();
  const kept: GalaxyEdge[] = [];

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

function buildAttendeeEdges(nodes: GalaxyNode[]): GalaxyEdge[] {
  const edges: GalaxyEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const nodeI = nodes[i]!;
    if (nodeI.attendees.length === 0) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const nodeJ = nodes[j]!;
      if (nodeJ.attendees.length === 0) continue;
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

function buildSameDayEdges(nodes: GalaxyNode[]): GalaxyEdge[] {
  const edges: GalaxyEdge[] = [];
  const dateGroups = new Map<string, GalaxyNode[]>();
  for (const node of nodes) {
    const date = extractCalendarDate(node.dateTime);
    const group = dateGroups.get(date);
    if (group) {
      group.push(node);
    } else {
      dateGroups.set(date, [node]);
    }
  }

  for (const group of dateGroups.values()) {
    if (group.length < 2) continue;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        edges.push({
          source: group[i]!.id,
          target: group[j]!.id,
          type: "sameDay",
          weight: 1,
        });
      }
    }
  }
  return edges;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

async function readIndexLines(indexPath: string): Promise<string[]> {
  try {
    const content = await fs.readFile(indexPath, "utf8");
    return content.split("\n");
  } catch {
    return [];
  }
}

export async function buildGalaxyData(options: {
  storageDir: string;
  newlySyncedSources?: string[];
}): Promise<GalaxyGraphData> {
  const { storageDir, newlySyncedSources } = options;
  const newSourceSet = new Set(newlySyncedSources ?? []);

  const meetingIndexPath = path.join(storageDir, "meetingindex.md");
  const whisperIndexPath = path.join(storageDir, "whisperindex.md");

  const [meetingLines, whisperLines] = await Promise.all([
    readIndexLines(meetingIndexPath),
    readIndexLines(whisperIndexPath),
  ]);

  const nodes: GalaxyNode[] = [];

  // Parse meeting index
  for (const line of meetingLines) {
    const entry = parseIndexLine(line);
    if (!entry) continue;
    nodes.push({
      id: entry.notePath,
      title: entry.title || "Untitled",
      dateTime: toISO8601(entry.dateTime),
      attendees: entry.attendees,
      brief: entry.brief,
      source: entry.source,
      tier: extractTier(entry.notePath),
      kind: "meeting",
      isNew: newSourceSet.has(entry.source),
      notePath: path.join(storageDir, entry.notePath),
    });
  }

  // Parse whisper index
  for (const line of whisperLines) {
    const entry = parseIndexLine(line);
    if (!entry) continue;
    nodes.push({
      id: entry.notePath,
      title: entry.title || "Whisper",
      dateTime: toISO8601(entry.dateTime),
      attendees: entry.attendees,
      brief: entry.brief,
      source: entry.source,
      tier: extractTier(entry.notePath),
      kind: "whisper",
      isNew: newSourceSet.has(entry.source),
      notePath: path.join(storageDir, entry.notePath),
    });
  }

  // Build edges — four relationship types
  const attendeeEdges = buildAttendeeEdges(nodes);
  const sameDayEdges = buildSameDayEdges(nodes);
  const seriesEdges = buildSeriesEdges(nodes);
  const projectEdges = buildProjectEdges(nodes);

  return {
    nodes,
    edges: [...seriesEdges, ...projectEdges, ...attendeeEdges, ...sameDayEdges],
    generatedAt: new Date().toISOString(),
  };
}
