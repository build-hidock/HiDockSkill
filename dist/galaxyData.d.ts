import type { StorageTier, DocumentKind } from "./meetingStorage.js";
export interface GalaxyNode {
    id: string;
    title: string;
    dateTime: string;
    attendees: string[];
    brief: string;
    source: string;
    tier: StorageTier;
    kind: DocumentKind;
    sourceType: string;
    isNew: boolean;
    notePath: string;
}
export interface GalaxyEdge {
    source: string;
    target: string;
    type: "attendee" | "sameDay" | "series" | "project";
    weight: number;
}
export interface GalaxyInsightItem {
    text: string;
    noteTitle: string;
    noteDate: string;
    noteId: string;
}
export interface GalaxyInsights {
    todos: GalaxyInsightItem[];
    reminders: GalaxyInsightItem[];
    achievements: GalaxyInsightItem[];
    suggestions: GalaxyInsightItem[];
    topTopics: {
        topic: string;
        count: number;
    }[];
}
/**
 * A file currently present on a connected HiDock device, optionally enriched
 * with the matching transcribed note when one exists. Populated by the watcher's
 * file-poll loop and surfaced in the list view so the user can see all device
 * recordings (transcribed and pending).
 */
export interface DeviceFileEntry {
    fileName: string;
    fileSize: number;
    modifiedAt: string | null;
    deviceName: string;
    isTranscribed: boolean;
    noteId?: string;
    noteTitle?: string;
    noteBrief?: string;
}
export interface GalaxyGraphData {
    nodes: GalaxyNode[];
    edges: GalaxyEdge[];
    insights: GalaxyInsights;
    generatedAt: string;
    deviceFiles?: DeviceFileEntry[];
}
/** Extract a field value from a pipe-delimited index line. */
export declare function extractField(line: string, fieldName: string): string;
export interface ParsedIndexEntry {
    dateTime: string;
    title: string;
    attendees: string[];
    brief: string;
    source: string;
    notePath: string;
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
export declare function parseIndexLine(line: string): ParsedIndexEntry | null;
/** Derive the storage tier from the relative note path. */
export declare function extractTier(notePath: string): StorageTier;
/** Extract lowercased keyword tokens from a text string. */
export declare function extractKeywords(text: string): Set<string>;
/** Jaccard similarity between two keyword sets. */
export declare function jaccardSimilarity(a: Set<string>, b: Set<string>): number;
/** Convert the index datetime string (YYYY-MM-DD HH:MM:SS) to ISO 8601. */
export declare function toISO8601(dateTimeStr: string): string;
/** Extract calendar date (YYYY-MM-DD) from a datetime string. */
export declare function extractCalendarDate(dateTimeStr: string): string;
/** Normalize a title for series grouping. */
export declare function normalizeTitle(title: string): string;
/** Check if a title is generic (noise) and should not form series. */
export declare function isGenericTitle(title: string): boolean;
/**
 * Extract entity tokens from text for project/topic matching.
 * Handles both Latin words and CJK bigrams.
 */
export declare function extractEntityTokens(text: string): string[];
/** Detect recording source type from the source filename. */
export declare function detectSourceType(source: string): string;
export declare function buildGalaxyData(options: {
    storageDir: string;
    newlySyncedSources?: string[];
}): Promise<GalaxyGraphData>;
//# sourceMappingURL=galaxyData.d.ts.map