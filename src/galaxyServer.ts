import http from "node:http";
import { promises as fs } from "node:fs";
import type { GalaxyGraphData } from "./galaxyData.js";
import { renderGalaxyHtml } from "./galaxyHtml.js";

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

  return new Promise<GalaxyServerHandle>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      const pathname = url.pathname;

      if (req.method !== "GET") {
        res.writeHead(405, { "Content-Type": "text/plain" });
        res.end("Method Not Allowed");
        return;
      }

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
              /## Summary\n([\s\S]*?)(?=\n## |\n#\s|$)/,
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
      });
    });
  });
}
