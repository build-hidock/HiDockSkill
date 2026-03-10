import http from "node:http";
import type { GalaxyGraphData } from "./galaxyData.js";
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
}
export declare function startGalaxyServer(options: GalaxyServerOptions): Promise<GalaxyServerHandle>;
//# sourceMappingURL=galaxyServer.d.ts.map