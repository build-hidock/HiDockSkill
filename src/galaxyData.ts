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
  type: "attendee" | "sameDay" | "topic";
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
// Keyword extraction & Jaccard similarity (for topic edges)
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
  // Input: "2026-02-21 13:28:25"
  // Output: "2026-02-21T13:28:25"
  const cleaned = dateTimeStr.trim().replace(" ", "T");
  return cleaned;
}

/** Extract calendar date (YYYY-MM-DD) from a datetime string. */
export function extractCalendarDate(dateTimeStr: string): string {
  return dateTimeStr.trim().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Edge building
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

function buildSameDayEdges(nodes: GalaxyNode[]): GalaxyEdge[] {
  const edges: GalaxyEdge[] = [];
  // Group nodes by calendar date
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

const MAX_TOPIC_EDGES_PER_NODE = 3;
const TOPIC_SIMILARITY_THRESHOLD = 0.3;

function buildTopicEdges(nodes: GalaxyNode[]): GalaxyEdge[] {
  // Pre-compute keyword sets
  const keywordSets = nodes.map((n) =>
    extractKeywords(`${n.title} ${n.brief}`),
  );

  // Compute all candidate edges
  const candidates: GalaxyEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const score = jaccardSimilarity(keywordSets[i]!, keywordSets[j]!);
      if (score >= TOPIC_SIMILARITY_THRESHOLD) {
        candidates.push({
          source: nodes[i]!.id,
          target: nodes[j]!.id,
          type: "topic",
          weight: Math.round(score * 1000) / 1000, // 3 decimal places
        });
      }
    }
  }

  // Sort descending by weight so we keep the strongest edges per node
  candidates.sort((a, b) => b.weight - a.weight);

  // Cap to max edges per node
  const edgeCounts = new Map<string, number>();
  const kept: GalaxyEdge[] = [];

  for (const edge of candidates) {
    const countS = edgeCounts.get(edge.source) ?? 0;
    const countT = edgeCounts.get(edge.target) ?? 0;
    if (countS >= MAX_TOPIC_EDGES_PER_NODE || countT >= MAX_TOPIC_EDGES_PER_NODE) {
      continue;
    }
    kept.push(edge);
    edgeCounts.set(edge.source, countS + 1);
    edgeCounts.set(edge.target, countT + 1);
  }

  return kept;
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

  // Build edges
  const attendeeEdges = buildAttendeeEdges(nodes);
  const sameDayEdges = buildSameDayEdges(nodes);
  const topicEdges = buildTopicEdges(nodes);

  return {
    nodes,
    edges: [...attendeeEdges, ...sameDayEdges, ...topicEdges],
    generatedAt: new Date().toISOString(),
  };
}
