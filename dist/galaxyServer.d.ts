import http from "node:http";
import type { GalaxyGraphData } from "./galaxyData.js";
import type { WikiSearchIndex } from "./wikiSearch.js";
export interface SyncProgressItem {
    fileName: string;
    status: "pending" | "downloading" | "transcribing" | "summarizing" | "saved" | "skipped" | "failed";
    progressPercent: number;
    error?: string;
}
export interface SyncProgress {
    phase: "connecting" | "listing" | "processing" | "done";
    total: number;
    current: number;
    items: SyncProgressItem[];
}
export interface GalaxyServerOptions {
    port?: number;
    host?: string;
    graphData?: GalaxyGraphData;
    log?: (message: string) => void;
}
/**
 * Raw entry pushed by the USB watcher's file-poll. The server enriches each
 * entry by matching against current graphData.nodes (where node.source ===
 * fileName) before storing in graphData.deviceFiles.
 */
export interface RawDeviceFileEntry {
    fileName: string;
    fileSize: number;
    modifiedAt: string | null;
    deviceName: string;
}
/**
 * Rename a speaker in a meeting note's transcript section.
 *
 * Matches lines of the form `[<oldName>]:` or `[<oldName> @<seconds>]:` and
 * replaces only the speaker name part — the `@seconds` timestamp is preserved.
 * Only operates on lines INSIDE the `## Transcript` section of the markdown
 * file; the summary, attendee list, and any other section are left untouched.
 *
 * Returns the rewritten content and the count of lines replaced. Exported so
 * unit tests can exercise the regex without needing a running HTTP server.
 */
export declare function renameSpeakerInTranscript(content: string, fromName: string, toName: string): {
    content: string;
    replaced: number;
};
export interface GalaxyServerHandle {
    server: http.Server;
    url: string;
    close: () => Promise<void>;
    updateData: (data: GalaxyGraphData) => void;
    clearData: () => void;
    resetProgress: () => void;
    updateProgress: (progress: SyncProgress) => void;
    updateWikiIndex: (index: WikiSearchIndex) => void;
    setDeviceFiles: (entries: RawDeviceFileEntry[]) => void;
}
export declare function startGalaxyServer(options: GalaxyServerOptions): Promise<GalaxyServerHandle>;
//# sourceMappingURL=galaxyServer.d.ts.map