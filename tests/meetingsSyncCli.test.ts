import { describe, expect, it } from "vitest";

import { parseArgs } from "../src/cli/meetingsSync.js";

describe("meetings sync CLI args", () => {
  it("keeps manual defaults and state file under storage", () => {
    const options = parseArgs([], {});
    expect(options.storageDir).toContain("meeting-storage");
    expect(options.stateFile).toContain(".hidock-sync-state.json");
    expect(options.storageBackend).toBe("local");
    expect(options.showHelp).toBe(false);
  });

  it("supports explicit state file", () => {
    const options = parseArgs(["--storage", "./x", "--state-file", "./state.json"], {});
    expect(options.storageDir.endsWith("/x")).toBe(true);
    expect(options.stateFile.endsWith("/state.json")).toBe(true);
  });

  it("parses memdock env configuration", () => {
    const options = parseArgs([], {
      HIDOCK_NOTES_BACKEND: "memdock",
      MEMDOCK_BASE_URL: "http://127.0.0.1:7788",
      MEMDOCK_API_KEY: "k",
      MEMDOCK_API_PATH: "/bridge/notes",
      MEMDOCK_WORKSPACE: "team-a",
      MEMDOCK_COLLECTION: "hinotes",
      MEMDOCK_TIMEOUT_MS: "3456",
    });
    expect(options.storageBackend).toBe("memdock");
    expect(options.memdockBaseUrl).toBe("http://127.0.0.1:7788");
    expect(options.memdockApiKey).toBe("k");
    expect(options.memdockApiPath).toBe("/bridge/notes");
    expect(options.memdockWorkspace).toBe("team-a");
    expect(options.memdockCollection).toBe("hinotes");
    expect(options.memdockTimeoutMs).toBe(3456);
  });

  it("parses memdock flags", () => {
    const options = parseArgs(
      [
        "--storage-backend",
        "memdock",
        "--memdock-base-url",
        "http://localhost:7788",
        "--memdock-api-key",
        "token-1",
        "--memdock-api-path",
        "/v2/notes",
        "--memdock-workspace",
        "ws",
        "--memdock-collection",
        "notes",
        "--memdock-timeout-ms",
        "4000",
      ],
      {},
    );
    expect(options.storageBackend).toBe("memdock");
    expect(options.memdockBaseUrl).toBe("http://localhost:7788");
    expect(options.memdockApiKey).toBe("token-1");
    expect(options.memdockApiPath).toBe("/v2/notes");
    expect(options.memdockWorkspace).toBe("ws");
    expect(options.memdockCollection).toBe("notes");
    expect(options.memdockTimeoutMs).toBe(4000);
  });

  it("rejects invalid storage backend", () => {
    expect(() => parseArgs(["--storage-backend", "remote"], {})).toThrow(
      "Invalid value for storage backend",
    );
  });
});
