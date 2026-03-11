import http from "node:http";
import type { GalaxyGraphData } from "./galaxyData.js";
export interface SyncProgressItem {
    fileName: string;
    status: "pending" | "downloading" | "transcribing" | "summarizing" | "saved" | "skipped" | "failed";
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
export interface GalaxyServerHandle {
    server: http.Server;
    url: string;
    close: () => Promise<void>;
    updateData: (data: GalaxyGraphData) => void;
    updateProgress: (progress: SyncProgress) => void;
}
export declare function startGalaxyServer(options: GalaxyServerOptions): Promise<GalaxyServerHandle>;
//# sourceMappingURL=galaxyServer.d.ts.map