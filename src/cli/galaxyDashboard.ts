import { exec } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildGalaxyData } from "../galaxyData.js";
import { startGalaxyServer } from "../galaxyServer.js";

const DEFAULT_STORAGE_DIR =
  "/Users/seansong/seanslab/Obsidian/OpenClawWorkspace/MeetingNotes";
const DEFAULT_PORT = 18180;

interface GalaxyDashboardCliOptions {
  storageDir: string;
  port: number;
  open: boolean;
  newSources: string[];
  showHelp: boolean;
}

function parseArgs(argv: string[]): GalaxyDashboardCliOptions {
  const options: GalaxyDashboardCliOptions = {
    storageDir: DEFAULT_STORAGE_DIR,
    port: DEFAULT_PORT,
    open: false,
    newSources: [],
    showHelp: false,
  };

  let index = 0;
  while (index < argv.length) {
    const arg = argv[index];
    switch (arg) {
      case "--help":
      case "-h":
        options.showHelp = true;
        break;
      case "--storage": {
        const value = readValue(argv, ++index, arg);
        options.storageDir = path.resolve(process.cwd(), value);
        break;
      }
      case "--port": {
        const value = readValue(argv, ++index, arg);
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error("Invalid value for --port (must be positive integer)");
        }
        options.port = parsed;
        break;
      }
      case "--open":
        options.open = true;
        break;
      case "--new-sources": {
        const value = readValue(argv, ++index, arg);
        options.newSources = value
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
    index += 1;
  }

  return options;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp(): void {
  console.log(`HiDock Galaxy Dashboard CLI

Usage:
  npm run galaxy -- [options]

Options:
  --storage <dir>              Storage root directory (default: ${DEFAULT_STORAGE_DIR})
  --port <n>                   HTTP server port (default: ${DEFAULT_PORT})
  --open                       Auto-open browser after server starts
  --new-sources <f1,f2,...>    Comma-separated source filenames to mark as new
  -h, --help                   Show this help
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.showHelp) {
    printHelp();
    return;
  }

  console.log(
    `[Galaxy Dashboard] building graph data from ${options.storageDir}`,
  );

  const buildOptions: { storageDir: string; newlySyncedSources?: string[] } = {
    storageDir: options.storageDir,
  };
  if (options.newSources.length > 0) {
    buildOptions.newlySyncedSources = options.newSources;
  }
  const graphData = await buildGalaxyData(buildOptions);

  console.log(
    `[Galaxy Dashboard] loaded ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`,
  );

  const handle = await startGalaxyServer({
    port: options.port,
    graphData,
    log: (message) => console.log(`[Galaxy Server] ${message}`),
  });

  console.log(`[Galaxy Dashboard] dashboard ready at ${handle.url}`);

  if (options.open) {
    exec(`open ${handle.url}`, (err) => {
      if (err) {
        console.error(`[Galaxy Dashboard] failed to open browser: ${err.message}`);
      }
    });
  }

  const shutdown = (signal: string): void => {
    console.log(`[Galaxy Dashboard] stopping (${signal})`);
    handle
      .close()
      .then(() => {
        process.exit(0);
      })
      .catch((err) => {
        console.error(`[Galaxy Dashboard] error during shutdown:`, err);
        process.exit(1);
      });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function isDirectRun(): boolean {
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    return false;
  }
  return pathToFileURL(scriptPath).href === import.meta.url;
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
