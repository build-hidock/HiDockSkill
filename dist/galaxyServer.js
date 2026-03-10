import http from "node:http";
import { renderGalaxyHtml } from "./galaxyHtml.js";
const DEFAULT_PORT = 18180;
const DEFAULT_HOST = "127.0.0.1";
export function startGalaxyServer(options) {
    const port = options.port ?? DEFAULT_PORT;
    const host = options.host ?? DEFAULT_HOST;
    const log = options.log ?? (() => { });
    const { graphData } = options;
    return new Promise((resolve, reject) => {
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
            if (pathname === "/data.json") {
                const json = JSON.stringify(graphData);
                res.writeHead(200, {
                    "Content-Type": "application/json; charset=utf-8",
                    "Cache-Control": "no-cache",
                });
                res.end(json);
                log(`GET /data.json -> 200 (${json.length} bytes)`);
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
            });
        });
    });
}
//# sourceMappingURL=galaxyServer.js.map