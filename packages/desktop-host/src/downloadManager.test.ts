import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import type { DownloadCandidate } from "@romdeck/core";

const configDir = await mkdtemp(join(tmpdir(), "romdeck-download-test-config-"));
process.env.ROMDECK_CONFIG_DIR = configDir;

const { cancelDownload, clearDownloadHistory, enqueueDownload, listDownloadJobs } = await import("./downloadManager.js");
const { pathToFileUri } = await import("./files.js");

const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});

describe("downloadManager", () => {
  it("streams a ZIP and extracts only compatible entries", async () => {
    const zip = zipSync({
      "Metroid Fusion.gba": new Uint8Array([1, 2, 3]),
      "cover.jpg": new Uint8Array([9])
    });
    const server = await serveBuffer(zip);
    const destination = await mkdtemp(join(tmpdir(), "romdeck-download-test-roms-"));
    const candidate: DownloadCandidate = {
      id: "test|gba|zip",
      source: "internet-archive",
      itemId: "test",
      title: "Metroid Fusion",
      systemKey: "gba",
      format: "Archive",
      files: [
        {
          sourceUrl: server.url,
          sourceName: "Metroid Fusion.zip",
          targetName: "Metroid Fusion.zip",
          size: zip.byteLength
        }
      ],
      extractedFiles: [{ name: "Metroid Fusion.gba", size: 3 }],
      fileCount: 1,
      totalSize: 3,
      requiresExtraction: true,
      canDownload: true,
      warnings: [],
      confidence: 0.9,
      reason: "ZIP contains Metroid Fusion.gba"
    };

    const job = await enqueueDownload(candidate, pathToFileUri(destination));
    const completed = await waitForJob(job.id);

    expect(completed.status).toBe("complete");
    expect(await readFile(join(destination, "Metroid Fusion.gba"))).toEqual(Buffer.from([1, 2, 3]));
    await expect(stat(join(destination, "Metroid Fusion.zip"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(join(destination, "cover.jpg"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("cancels an active direct download and removes the partial file", async () => {
    const server = await serveSlowBuffer(new Uint8Array(1024 * 1024).fill(7));
    const destination = await mkdtemp(join(tmpdir(), "romdeck-cancel-test-roms-"));
    const candidate: DownloadCandidate = {
      id: "test|gba|direct",
      source: "internet-archive",
      itemId: "test",
      title: "Cancel Test",
      systemKey: "gba",
      format: "GBA",
      files: [
        {
          sourceUrl: server.url,
          sourceName: "Cancel Test.gba",
          targetName: "Cancel Test.gba",
          size: 1024 * 1024
        }
      ],
      fileCount: 1,
      totalSize: 1024 * 1024,
      requiresExtraction: false,
      canDownload: true,
      warnings: [],
      confidence: 0.9,
      reason: "direct test file"
    };

    const job = await enqueueDownload(candidate, pathToFileUri(destination));
    await new Promise((resolve) => setTimeout(resolve, 25));
    const canceled = await cancelDownload(job.id);
    const completed = await waitForJob(job.id);

    expect(canceled.status).toBe("canceled");
    expect(completed.status).toBe("canceled");
    await expect(stat(join(destination, "Cancel Test.gba.part"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("retries transient direct download failures", async () => {
    const server = await serveFailOnceThenBuffer(new Uint8Array([4, 5, 6]));
    const destination = await mkdtemp(join(tmpdir(), "romdeck-retry-test-roms-"));
    const candidate: DownloadCandidate = {
      id: "test|gba|retry",
      source: "internet-archive",
      itemId: "test",
      title: "Retry Test",
      systemKey: "gba",
      format: "GBA",
      files: [
        {
          sourceUrl: server.url,
          sourceName: "Retry Test.gba",
          targetName: "Retry Test.gba",
          size: 3
        }
      ],
      fileCount: 1,
      totalSize: 3,
      requiresExtraction: false,
      canDownload: true,
      warnings: [],
      confidence: 0.9,
      reason: "direct retry test"
    };

    const job = await enqueueDownload(candidate, pathToFileUri(destination));
    const completed = await waitForJob(job.id);

    expect(completed.status).toBe("complete");
    expect(completed.downloadedBytes).toBe(3);
    expect(server.requests()).toBe(2);
    expect(await readFile(join(destination, "Retry Test.gba"))).toEqual(Buffer.from([4, 5, 6]));
  });

  it("clears terminal download history", async () => {
    const jobs = await clearDownloadHistory();

    expect(jobs.every((job) => !["complete", "failed", "skipped", "canceled"].includes(job.status))).toBe(true);
  });
});

async function serveBuffer(buffer: Uint8Array): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    if (request.url !== "/archive.zip") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-length": buffer.byteLength,
      "content-type": "application/zip"
    });
    response.end(buffer);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  const handle = {
    url: `http://127.0.0.1:${address.port}/archive.zip`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
  servers.push(handle);
  return handle;
}

async function serveSlowBuffer(buffer: Uint8Array): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    if (request.url !== "/file.gba") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-length": buffer.byteLength,
      "content-type": "application/octet-stream"
    });
    void writeSlowly(response, buffer);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  const handle = {
    url: `http://127.0.0.1:${address.port}/file.gba`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
  servers.push(handle);
  return handle;
}

async function serveFailOnceThenBuffer(buffer: Uint8Array): Promise<{ url: string; requests: () => number; close: () => Promise<void> }> {
  let requests = 0;
  const server = createServer((request, response) => {
    if (request.url !== "/file.gba") {
      response.writeHead(404);
      response.end();
      return;
    }
    requests += 1;
    if (requests === 1) {
      response.writeHead(503);
      response.end();
      return;
    }
    response.writeHead(200, {
      "content-length": buffer.byteLength,
      "content-type": "application/octet-stream"
    });
    response.end(buffer);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not bind to a TCP port.");
  }
  const handle = {
    url: `http://127.0.0.1:${address.port}/file.gba`,
    requests: () => requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
  servers.push(handle);
  return handle;
}

async function writeSlowly(response: ServerResponse, buffer: Uint8Array): Promise<void> {
  for (let offset = 0; offset < buffer.byteLength; offset += 16 * 1024) {
    if (response.destroyed) {
      return;
    }
    response.write(buffer.subarray(offset, offset + 16 * 1024));
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  response.end();
}

async function waitForJob(jobId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = (await listDownloadJobs()).find((entry) => entry.id === jobId);
    if (job && ["complete", "failed", "skipped", "canceled"].includes(job.status)) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("Timed out waiting for download job.");
}
