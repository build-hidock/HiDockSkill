import http from "node:http";
import { promises as fs } from "node:fs";
import type { GalaxyGraphData } from "./galaxyData.js";
import { renderGalaxyHtml } from "./galaxyHtml.js";

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

export interface GalaxyServerHandle {
  server: http.Server;
  url: string;
  close: () => Promise<void>;
  updateData: (data: GalaxyGraphData) => void;
  clearData: () => void;
  resetProgress: () => void;
  updateProgress: (progress: SyncProgress) => void;
}

const DEFAULT_PORT = 18180;
const DEFAULT_HOST = "127.0.0.1";

export function startGalaxyServer(
  options: GalaxyServerOptions,
): Promise<GalaxyServerHandle> {
  const port = options.port ?? DEFAULT_PORT;
  const host = options.host ?? DEFAULT_HOST;
  const log = options.log ?? (() => {});

  // Mutable state: starts null (syncing) or with initial data (ready)
  let graphData: GalaxyGraphData | null = options.graphData ?? null;
  let syncProgress: SyncProgress = { phase: "connecting", total: 0, current: 0, items: [] };

  return new Promise<GalaxyServerHandle>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      const pathname = url.pathname;

      if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE") {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
        return;
      }
      const isHead = req.method === "HEAD";

      // DELETE /note?id=... — delete note, audio, and index entry
      if (req.method === "DELETE" && pathname === "/note") {
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
        (async () => {
          try {
            // Delete note file
            await fs.unlink(node.notePath).catch(() => {});
            // Delete audio (.mp3 / .wav)
            await fs.unlink(node.notePath.replace(/\.md$/, ".mp3")).catch(() => {});
            await fs.unlink(node.notePath.replace(/\.md$/, ".wav")).catch(() => {});
            // Remove from in-memory graph
            graphData!.nodes = graphData!.nodes.filter((n) => n.id !== nodeId);
            graphData!.edges = graphData!.edges.filter((e) => e.source !== nodeId && e.target !== nodeId);
            // Remove from index file (line containing the source filename)
            const indexName = node.kind === "whisper" ? "whisperindex.md" : "meetingindex.md";
            const storageDir = node.notePath.replace(/\/(meetings|whispers)\/.*$/, "");
            const indexPath = storageDir + "/" + indexName;
            try {
              const indexContent = await fs.readFile(indexPath, "utf8");
              const filtered = indexContent.split("\n").filter((line) => !line.includes(node.source)).join("\n");
              await fs.writeFile(indexPath, filtered, "utf8");
            } catch { /* index may not exist */ }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ deleted: true }));
            log(`DELETE /note -> 200 (${node.notePath})`);
          } catch (err) {
            res.writeHead(500, { "Content-Type": "text/plain" });
            res.end("Delete failed");
            log(`DELETE /note -> 500 (${node.notePath})`);
          }
        })();
        return;
      }

      if (pathname === "/") {
        // Always start in polling mode so the browser never races with a
        // fast sync that sets graphData before the page loads.
        const html = renderGalaxyHtml(null);
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
        const tryServeAudio = (audioPath: string, mimeType: string): void => {
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
                  } else {
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
              } else {
                fs.readFile(audioPath).then((data) => res.end(data));
              }
              log(`${req.method} /audio -> 200 (${audioPath})`);
            })
            .catch(() => {
              if (audioPath === mp3Path) {
                tryServeAudio(wavPath, "audio/wav");
              } else {
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
            const summaryMatch = content.match(
              /## Summary\n([\s\S]*?)(?=\n## Transcript\b|$)/,
            );
            const transcriptMatch = content.match(
              /## Transcript\n([\s\S]*?)$/,
            );
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
        close: () =>
          new Promise<void>((resolveClose, rejectClose) => {
            server.close((err) => {
              if (err) {
                rejectClose(err);
              } else {
                resolveClose();
              }
            });
          }),
        updateData: (data: GalaxyGraphData) => {
          graphData = data;
          log(`Galaxy data updated: ${data.nodes.length} nodes, ${data.edges.length} edges`);
        },
        clearData: () => {
          graphData = null;
          syncProgress = { phase: "connecting", total: 0, current: 0, items: [] };
        },
        resetProgress: () => {
          syncProgress = { phase: "connecting", total: 0, current: 0, items: [] };
        },
        updateProgress: (progress: SyncProgress) => {
          syncProgress = progress;
        },
      });
    });
  });
}
