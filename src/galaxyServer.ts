import http from "node:http";
import { promises as fs } from "node:fs";
import type { GalaxyGraphData, DeviceFileEntry } from "./galaxyData.js";
import { renderGalaxyHtml } from "./galaxyHtml.js";
import type { WikiSearchIndex, SearchResult } from "./wikiSearch.js";
import { searchWiki } from "./wikiSearch.js";
import { streamLlmChatChunked } from "./llmChat.js";

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
  let wikiIndex: WikiSearchIndex | null = null;
  const llmHost = "http://localhost:8080";
  const llmModel = "mlx-community/Qwen3.5-9B-4bit";

  return new Promise<GalaxyServerHandle>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      const pathname = url.pathname;

      if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "DELETE" && req.method !== "POST") {
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
        // Read wiki index if available
        const wikiIndexPromise = graphData?.nodes[0]
          ? fs.readFile(
              graphData.nodes[0].notePath.replace(/\/(meetings|whispers)\/.*$/, "/wiki/index.md"),
              "utf8",
            ).catch(() => undefined)
          : Promise.resolve(undefined);

        wikiIndexPromise.then((wikiContent) => {
          const html = renderGalaxyHtml(graphData, wikiContent);
          res.writeHead(200, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-cache",
          });
          res.end(html);
          log(`GET / -> 200 (${html.length} bytes)`);
        });
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

      // ---- Wiki endpoints ----

      if (pathname === "/wiki/search") {
        const q = url.searchParams.get("q") ?? "";
        if (!wikiIndex || !q) {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ results: [] }));
          return;
        }
        const results = searchWiki(wikiIndex, q, 10);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ results }));
        log(`GET /wiki/search?q=${q} -> ${results.length} results`);
        return;
      }

      if (pathname === "/wiki/page") {
        const wikiPath = url.searchParams.get("path");
        if (!wikiPath || !graphData) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }
        // Resolve wiki dir from any node's notePath
        const anyNode = graphData.nodes[0];
        const storageDir = anyNode
          ? anyNode.notePath.replace(/\/(meetings|whispers)\/.*$/, "")
          : "";
        const fullPath = storageDir
          ? `${storageDir}/wiki/${wikiPath}`
          : "";
        if (!fullPath) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("Not Found");
          return;
        }
        fs.readFile(fullPath, "utf8")
          .then((content) => {
            const title = content.match(/^# (.+)/m)?.[1] ?? wikiPath;
            const category = wikiPath.split("/")[0] ?? "";
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(JSON.stringify({ title, content, category }));
            log(`GET /wiki/page -> 200 (${wikiPath})`);
          })
          .catch(() => {
            res.writeHead(404, { "Content-Type": "text/plain" });
            res.end("Not Found");
          });
        return;
      }

      // ---- AskHiDock endpoint (SSE) ----

      if (req.method === "POST" && pathname === "/ask") {
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
        req.on("end", () => {
          (async () => {
            try {
              const { query } = JSON.parse(body) as { query: string };
              if (!query) {
                res.writeHead(400, { "Content-Type": "text/plain" });
                res.end("Missing query");
                return;
              }

              // Search wiki for context
              let sources: SearchResult[] = [];
              if (wikiIndex) {
                sources = searchWiki(wikiIndex, query, 5);
              }

              // Build context from top wiki pages
              let wikiContext = "";
              if (sources.length > 0 && graphData) {
                const anyNode = graphData.nodes[0];
                const storageDir = anyNode
                  ? anyNode.notePath.replace(/\/(meetings|whispers)\/.*$/, "")
                  : "";
                for (const src of sources.slice(0, 2)) {
                  try {
                    const content = await fs.readFile(`${storageDir}/wiki/${src.path}`, "utf8");
                    wikiContext += `\n## Source: ${src.path}\n${content.slice(0, 800)}\n`;
                  } catch { /* skip */ }
                }
              }

              // SSE headers
              res.writeHead(200, {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
              });

              // Send sources
              res.write(`data: ${JSON.stringify({ type: "sources", results: sources })}\n\n`);

              // Stream LLM answer
              const systemPrompt =
                "Answer using ONLY the context below. Cite sources in [brackets]. Be concise.\n\n" +
                "Context:" + wikiContext;

              await streamLlmChatChunked(
                llmHost,
                {
                  model: llmModel,
                  messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: query + "\n\n/no_think" },
                  ],
                },
                (chunk) => {
                  res.write(`data: ${JSON.stringify({ type: "chunk", text: chunk })}\n\n`);
                },
              );

              res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
              res.end();
              log(`POST /ask -> 200 (${query.slice(0, 40)})`);
            } catch (error) {
              if (!res.headersSent) {
                res.writeHead(500, { "Content-Type": "text/plain" });
              }
              res.end("Error");
              log(`POST /ask -> 500`);
            }
          })();
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
        updateWikiIndex: (index: WikiSearchIndex) => {
          wikiIndex = index;
          log(`Wiki search index updated: ${index.documents.length} documents`);
        },
        setDeviceFiles: (entries: RawDeviceFileEntry[]) => {
          if (!graphData) {
            // No graph data yet — nothing to enrich against. Stash for later by
            // creating a minimal stub. The next updateData() will overwrite it.
            return;
          }
          // Enrich each raw entry by matching against current nodes. The note's
          // `source` field is the .hda filename, so direct equality works.
          const nodesBySource = new Map(graphData.nodes.map((n) => [n.source, n]));
          const enriched: DeviceFileEntry[] = entries.map((e) => {
            const match = nodesBySource.get(e.fileName);
            if (match) {
              return {
                fileName: e.fileName,
                fileSize: e.fileSize,
                modifiedAt: e.modifiedAt,
                deviceName: e.deviceName,
                isTranscribed: true,
                noteId: match.id,
                noteTitle: match.title,
                noteBrief: match.brief,
              };
            }
            return {
              fileName: e.fileName,
              fileSize: e.fileSize,
              modifiedAt: e.modifiedAt,
              deviceName: e.deviceName,
              isTranscribed: false,
            };
          });
          graphData.deviceFiles = enriched;
          const pending = enriched.filter((d) => !d.isTranscribed).length;
          log(`Device files updated: ${enriched.length} total, ${pending} pending`);
        },
      });
    });
  });
}
