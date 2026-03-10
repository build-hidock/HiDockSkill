import type { GalaxyGraphData } from "./galaxyData.js";
/**
 * Render a self-contained HTML page with two states:
 * 1. Syncing — pulsing animation while HiDock device is being synced
 * 2. Galaxy — D3.js force-directed graph of meeting notes
 *
 * When `data` is null, the page starts in syncing mode and polls /data.json
 * until data becomes available, then transitions to the galaxy view.
 */
export declare function renderGalaxyHtml(data: GalaxyGraphData | null): string;
//# sourceMappingURL=galaxyHtml.d.ts.map