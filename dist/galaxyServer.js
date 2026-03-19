import http from "node:http";
import { promises as fs } from "node:fs";
import { renderGalaxyHtml } from "./galaxyHtml.js";
const DEFAULT_PORT = 18180;
const DEFAULT_HOST = "127.0.0.1";
export function startGalaxyServer(options) {
    const port = options.port ?? DEFAULT_PORT;
    const host = options.host ?? DEFAULT_HOST;
    const log = options.log ?? (() => { });
    // Mutable state: starts null (syncing) or with initial data (ready)
    let graphData = options.graphData ?? null;
    let syncProgress = { phase: "connecting", total: 0, current: 0, items: [] };
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url ?? "/", `http://${host}:${port}`);
            const pathname = url.pathname;
            if (req.method !== "GET" && req.method !== "HEAD") {
                res.writeHead(405, { "Content-Type": "text/plain" });
                res.end("Method Not Allowed");
                return;
            }
            const isHead = req.method === "HEAD";
            if (pathname === "/") {
                const html = renderGalaxyHtml(graphData);
                res.writeHead(200, {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "no-cache",
                });
                res.end(html);
                log(`GET / -> 200 (${html.length} bytes)`);
                return;
            }
            if (pathname === "/status") {
                const state = graphData ? "ready" : "syncing";
                const json = JSON.stringify({ state });
                res.writeHead(200, {
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-cache",
                });
                res.end(json);
                return;
            }
            if (pathname === "/progress") {
                const json = JSON.stringify(syncProgress);
                res.writeHead(200, {
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-cache",
                });
                res.end(json);
                return;
            }
            if (pathname === "/data.json") {
                if (!graphData) {
                    res.writeHead(204);
                    res.end();
                    return;
                }
                const json = JSON.stringify(graphData);
                res.writeHead(200, {
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-cache",
                });
                res.end(json);
                log(`GET /data.json -> 200 (${json.length} bytes)`);
                return;
            }
            if (pathname === "/audio") {
                const nodeId = url.searchParams.get("id");
                if (!nodeId || !graphData) {
                    res.writeHead(404, { "Content-Type": "text/plain" });
                    res.end("Not Found");
                    return;
                }
                const audioNode = graphData.nodes.find((n) => n.id === nodeId);
                if (!audioNode) {
                    res.writeHead(404, { "Content-Type": "text/plain" });
                    res.end("Node not found");
                    return;
                }
                // Try .mp3 then .wav alongside the note
                const mp3Path = audioNode.notePath.replace(/\.md$/, ".mp3");
                const wavPath = audioNode.notePath.replace(/\.md$/, ".wav");
                const tryServeAudio = (audioPath, mimeType) => {
                    fs.stat(audioPath)
                        .then((stat) => {
                        const total = stat.size;
                        const rangeHeader = req.headers.range;
                        if (rangeHeader) {
                            const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
                            if (match) {
                                const start = Number(match[1]);
                                const end = match[2] ? Number(match[2]) : total - 1;
                                res.writeHead(206, {
                                    "Content-Type": mimeType,
                                    "Content-Range": `bytes ${start}-${end}/${total}`,
                                    "Accept-Ranges": "bytes",
                                    "Content-Length": (end - start + 1).toString(),
                                    "Cache-Control": "no-cache",
                                });
                                if (isHead) {
                                    res.end();
                                }
                                else {
                                    fs.readFile(audioPath).then((data) => res.end(data.subarray(start, end + 1)));
                                }
                                log(`${req.method} /audio -> 206 (${start}-${end}/${total})`);
                                return;
                            }
                        }
                        res.writeHead(200, {
                            "Content-Type": mimeType,
                            "Content-Length": total.toString(),
                            "Accept-Ranges": "bytes",
                            "Cache-Control": "no-cache",
                        });
                        if (isHead) {
                            res.end();
                        }
                        else {
                            fs.readFile(audioPath).then((data) => res.end(data));
                        }
                        log(`${req.method} /audio -> 200 (${audioPath})`);
                    })
                        .catch(() => {
                        if (audioPath === mp3Path) {
                            tryServeAudio(wavPath, "audio/wav");
                        }
                        else {
                            res.writeHead(404, { "Content-Type": "text/plain" });
                            res.end();
                        }
                    });
                };
                tryServeAudio(mp3Path, "audio/mpeg");
                return;
            }
            if (pathname === "/note") {
                const nodeId = url.searchParams.get("id");
                if (!nodeId || !graphData) {
                    res.writeHead(404, { "Content-Type": "text/plain" });
                    res.end("Not Found");
                    return;
                }
                const node = graphData.nodes.find((n) => n.id === nodeId);
                if (!node) {
                    res.writeHead(404, { "Content-Type": "text/plain" });
                    res.end("Node not found");
                    return;
                }
                fs.readFile(node.notePath, "utf8")
                    .then((content) => {
                    const summaryMatch = content.match(/## Summary\n([\s\S]*?)(?=\n## Transcript\b|$)/);
                    const transcriptMatch = content.match(/## Transcript\n([\s\S]*?)$/);
                    const noteJson = JSON.stringify({
                        summary: summaryMatch?.[1]?.trim() ?? "",
                        transcript: transcriptMatch?.[1]?.trim() ?? "",
                    });
                    res.writeHead(200, {
                        "Content-Type": "application/json; charset=utf-8",
                        "Cache-Control": "no-cache",
                    });
                    res.end(noteJson);
                    log(`GET /note -> 200 (${node.notePath})`);
                })
                    .catch(() => {
                    res.writeHead(500, { "Content-Type": "text/plain" });
                    res.end("Error reading note");
                    log(`GET /note -> 500 (${node.notePath})`);
                });
                return;
            }
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
            log(`GET ${pathname} -> 404`);
        });
        server.on("error", (err) => {
            reject(err);
        });
        server.listen(port, host, () => {
            const serverUrl = `http://${host}:${port}`;
            log(`Galaxy server listening on ${serverUrl}`);
            resolve({
                server,
                url: serverUrl,
                close: () => new Promise((resolveClose, rejectClose) => {
                    server.close((err) => {
                        if (err) {
                            rejectClose(err);
                        }
                        else {
                            resolveClose();
                        }
                    });
                }),
                updateData: (data) => {
                    graphData = data;
                    log(`Galaxy data updated: ${data.nodes.length} nodes, ${data.edges.length} edges`);
                },
                updateProgress: (progress) => {
                    syncProgress = progress;
                },
            });
        });
    });
}
//# sourceMappingURL=galaxyServer.js.map