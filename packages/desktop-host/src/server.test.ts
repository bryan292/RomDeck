import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { DownloadCandidate } from "@romdeck/core";
import type { Server } from "node:http";

const nativeFetch = globalThis.fetch.bind(globalThis);
const configDir = await mkdtemp(join(tmpdir(), "romdeck-server-test-config-"));
process.env.ROMDECK_CONFIG_DIR = configDir;

const { createRomDeckServer } = await import("./server.js");
const { saveConfig } = await import("./config.js");
const { pathToFileUri } = await import("./files.js");

const servers: Server[] = [];

beforeAll(async () => {
  await saveConfig({ version: 1, systems: {} });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.ROMDECK_SESSION_TOKEN;
  delete process.env.ROMDECK_HOST_LOG_FILE;
  await Promise.all(servers.map((server) => closeServer(server)));
  servers.length = 0;
});

describe("desktop host HTTP API", () => {
  it("converts file URIs to native paths for display", async () => {
    const server = await listen();
    const nativePath = join(configDir, "roms", "gba");
    const response = await postJson<{ path: string }>(server, "/api/file-path", {
      destinationUri: pathToFileUri(nativePath)
    });

    expect(response.status).toBe(200);
    expect(response.body.path).toBe(nativePath);
  });

  it("requires the desktop session token when one is configured", async () => {
    process.env.ROMDECK_SESSION_TOKEN = "test-token";
    const server = await listen();

    const unauthorized = await getJson<{ error: string }>(server, "/api/systems");
    const authorized = await getJson<{ systems: unknown[] }>(server, "/api/systems", {
      "x-romdeck-session": "test-token"
    });

    expect(unauthorized.status).toBe(401);
    expect(unauthorized.body.error).toContain("session token");
    expect(authorized.status).toBe(200);
    expect(authorized.body.systems.length).toBeGreaterThan(0);
  });

  it("leaves health checks available without a session token", async () => {
    process.env.ROMDECK_SESSION_TOKEN = "test-token";
    const server = await listen();

    const response = await getJson<{ ok: true }>(server, "/api/health");

    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
  });

  it("reports protected host diagnostics", async () => {
    process.env.ROMDECK_SESSION_TOKEN = "test-token";
    process.env.ROMDECK_HOST_LOG_FILE = join(configDir, "romdeck-host.log");
    const server = await listen();

    const response = await getJson<{ diagnostics: { host: string; sessionProtected: boolean; appDataDirectory: string; logFile?: string } }>(
      server,
      "/api/diagnostics",
      { "x-romdeck-session": "test-token" }
    );

    expect(response.status).toBe(200);
    expect(response.body.diagnostics.host).toBe("desktop-node");
    expect(response.body.diagnostics.sessionProtected).toBe(true);
    expect(response.body.diagnostics.appDataDirectory).toBe(configDir);
    expect(response.body.diagnostics.logFile).toBe(join(configDir, "romdeck-host.log"));
  });

  it("rejects downloads with unavailable destinations before provider fetch", async () => {
    const missingPath = join(configDir, "missing", "gba");
    await saveConfig({
      version: 1,
      systems: {
        gba: {
          enabled: true,
          destinationUri: pathToFileUri(missingPath)
        }
      }
    });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const server = await listen();

    const response = await postJson<{ error: string }>(server, "/api/downloads", {
      candidate: directGbaCandidate()
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Configured destination is not available");
    expect(fetch).not.toHaveBeenCalled();
  });
});

async function listen(): Promise<Server> {
  const server = createRomDeckServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return server;
}

async function getJson<T>(server: Server, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: T }> {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  const response = await nativeFetch(`http://127.0.0.1:${address.port}${path}`, { headers });
  return {
    status: response.status,
    body: await response.json() as T
  };
}

async function postJson<T>(server: Server, path: string, body: unknown): Promise<{ status: number; body: T }> {
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  const response = await nativeFetch(`http://127.0.0.1:${address.port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  return {
    status: response.status,
    body: await response.json() as T
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function directGbaCandidate(): DownloadCandidate {
  return {
    id: "test|gba|direct",
    source: "internet-archive",
    itemId: "metroid-fusion",
    title: "Metroid Fusion",
    systemKey: "gba",
    format: "GBA",
    files: [
      {
        sourceUrl: "https://archive.org/download/metroid-fusion/Metroid%20Fusion.gba",
        sourceName: "Metroid Fusion.gba",
        targetName: "Metroid Fusion.gba",
        size: 8388608
      }
    ],
    fileCount: 1,
    totalSize: 8388608,
    requiresExtraction: false,
    canDownload: true,
    warnings: [],
    confidence: 0.9,
    reason: "direct GBA file"
  };
}
