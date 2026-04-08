import http from "node:http";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { GalaxyGraphData, DeviceFileEntry } from "./galaxyData.js";
import { renderGalaxyHtml } from "./galaxyHtml.js";
import type { WikiSearchIndex, SearchResult } from "./wikiSearch.js";
import { searchWiki, buildSearchIndex } from "./wikiSearch.js";
import { streamLlmChatChunked } from "./llmChat.js";
import {
  renameSpeakerInNoteContent,
  renameSpeakerInIndexContent,
  renameSpeakerInWikiDir,
} from "./speakerRename.js";
import { regenerateIndex } from "./wikiCompiler.js";

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

      // POST /note/speaker?id=NODE_ID
      // Body: { from: "Speaker 0", to: "Sean Song", lineStart?: "12.4" }
      //
      // Two distinct modes determined by `lineStart`:
      //
      //   BULK (no lineStart) — "rename this speaker"
      //     User intent: give a diarized speaker a real name, or merge two
      //     speakers entirely. Propagates across all four layers:
      //       1. ## Transcript: every `[<from>]:` line
      //       2. ## Summary:    every word-token mention
      //       3. meetingindex.md row's Brief/Title/Attendee fields
      //       4. Wiki:          people page rename or merge + cross-references
      //     Plus refreshes the wiki master index, search index, and in-memory
      //     graph attendee data.
      //
      //   SINGLE (lineStart provided) — "fix this misdiarized line"
      //     User intent: a single sentence was assigned to the wrong speaker
      //     by the diarizer. Reassigns ONLY the transcript line whose
      //     `@<lineStart>` matches. The other lines from the original speaker
      //     stay as-is. Summary, index, and wiki are NOT touched — the
      //     original speaker still exists for the unchanged lines.
      //
      // Returns per-layer counts so the frontend can confirm what was touched.
      if (req.method === "POST" && pathname === "/note/speaker") {
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
        let body = "";
        req.on("data", (chunk: Buffer) => { body += chunk.toString("utf8"); });
        req.on("end", () => {
          let parsed: { from?: string; to?: string; lineStart?: string | number };
          try {
            parsed = JSON.parse(body || "{}");
          } catch {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("Bad JSON");
            return;
          }
          const fromName = (parsed.from ?? "").trim();
          const toName = (parsed.to ?? "").trim();
          // lineStart is the @<sec> identifier of a single transcript line.
          // Accept either a string ("12.4") or number (12.4) for flexibility.
          // Empty / null / undefined → BULK mode.
          let lineStart: string | undefined;
          if (parsed.lineStart !== undefined && parsed.lineStart !== null && parsed.lineStart !== "") {
            lineStart = String(parsed.lineStart);
          }
          const isSingle = lineStart !== undefined;

          if (!fromName || !toName) {
            res.writeHead(400, { "Content-Type": "text/plain" });
            res.end("from and to are required");
            return;
          }
          if (fromName === toName) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
              ok: true,
              mode: isSingle ? "single" : "bulk",
              note: 0,
              index: 0,
              wiki: { filesUpdated: 0, peopleRenamed: 0, peopleMerged: 0, replacements: 0 },
            }));
            return;
          }
          (async () => {
            // Compute the storage root from the note path. Both the meeting
            // index and the wiki dir are siblings of the meetings/whispers dir.
            const storageDir = node.notePath.replace(/\/(meetings|whispers)\/.*$/, "");
            const indexName = node.kind === "whisper" ? "whisperindex.md" : "meetingindex.md";
            const indexPath = path.join(storageDir, indexName);
            const wikiDir = path.join(storageDir, "wiki");

            let noteReplaced = 0;
            let indexReplaced = 0;
            const wikiResult = { filesUpdated: 0, peopleRenamed: 0, peopleMerged: 0, replacements: 0 };

            try {
              // --- Layer 1+2: Rewrite the note file ---
              // SINGLE mode rewrites only the matching transcript line.
              // BULK mode rewrites all transcript lines + summary mentions.
              try {
                const noteContent = await fs.readFile(node.notePath, "utf8");
                const renameOptions = lineStart !== undefined ? { lineStart } : {};
                const updated = renameSpeakerInNoteContent(noteContent, fromName, toName, renameOptions);
                if (updated.replaced > 0) {
                  await fs.writeFile(node.notePath, updated.content, "utf8");
                  noteReplaced = updated.replaced;
                }
              } catch (e) {
                log(`POST /note/speaker: note file rewrite failed: ${e instanceof Error ? e.message : String(e)}`);
              }

              // --- Layer 3+4 are BULK only ---
              // A single-line fix doesn't propagate to the summary, the index,
              // or the wiki because the original speaker still exists for the
              // unchanged transcript lines. The wiki entity for the original
              // speaker is still valid; only that one line's identity changed.
              if (!isSingle) {
                // --- Layer 3: Rewrite the meeting index row ---
                try {
                  const indexContent = await fs.readFile(indexPath, "utf8");
                  const updated = renameSpeakerInIndexContent(indexContent, node.source, fromName, toName);
                  if (updated.replaced > 0) {
                    await fs.writeFile(indexPath, updated.content, "utf8");
                    indexReplaced = updated.replaced;
                  }
                } catch (e) {
                  // Index file may not exist for older notes — non-fatal
                  log(`POST /note/speaker: index rewrite skipped: ${e instanceof Error ? e.message : String(e)}`);
                }

                // --- Layer 4: Walk the wiki ---
                try {
                  const wr = await renameSpeakerInWikiDir(wikiDir, fromName, toName);
                  Object.assign(wikiResult, wr);
                } catch (e) {
                  log(`POST /note/speaker: wiki rewrite failed: ${e instanceof Error ? e.message : String(e)}`);
                }

                // --- Refresh derived state ---
                if (wikiResult.peopleRenamed + wikiResult.peopleMerged + wikiResult.filesUpdated > 0) {
                  try {
                    await regenerateIndex(wikiDir);
                  } catch (e) {
                    log(`POST /note/speaker: wiki index regen failed: ${e instanceof Error ? e.message : String(e)}`);
                  }
                  try {
                    const newSearchIndex = await buildSearchIndex(wikiDir);
                    wikiIndex = newSearchIndex;
                    log(`Wiki search index updated: ${newSearchIndex.documents.length} documents`);
                  } catch (e) {
                    log(`POST /note/speaker: wiki search rebuild failed: ${e instanceof Error ? e.message : String(e)}`);
                  }
                }

                // Update in-memory graph node attendees so the list view's
                // attendee column reflects the rename without a full sync.
                if (graphData) {
                  for (const n of graphData.nodes) {
                    if (n.attendees && n.attendees.length > 0) {
                      n.attendees = n.attendees.map((a) => (a === fromName ? toName : a));
                    }
                  }
                }
              }

              const summary = {
                ok: true,
                mode: isSingle ? "single" : "bulk",
                note: noteReplaced,
                index: indexReplaced,
                wiki: wikiResult,
              };
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(summary));
              log(
                `POST /note/speaker -> 200 (${isSingle ? "single@" + lineStart : "bulk"} ` +
                `"${fromName}" -> "${toName}" | note=${noteReplaced} index=${indexReplaced} ` +
                `wiki=${wikiResult.filesUpdated}files,${wikiResult.peopleRenamed}renamed,${wikiResult.peopleMerged}merged,${wikiResult.replacements}repl)`,
              );
            } catch (err) {
              res.writeHead(500, { "Content-Type": "text/plain" });
              res.end("Error updating note");
              log(`POST /note/speaker -> 500 (${node.notePath}): ${err instanceof Error ? err.message : String(err)}`);
            }
          })();
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
