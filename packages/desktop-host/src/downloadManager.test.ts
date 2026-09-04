import { createServer, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
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

  it("keeps ZIP extraction targets inside the destination", async () => {
    const zip = zipSync({
      "../Escaped Test.gba": new Uint8Array([8, 9])
    });
    const server = await serveBuffer(zip);
    const parent = await mkdtemp(join(tmpdir(), "romdeck-zip-traversal-parent-"));
    const destination = join(parent, "roms");
    await mkdir(destination);

    const job = await enqueueDownload({
      id: "test|gba|zip-traversal",
      source: "internet-archive",
      itemId: "test",
      title: "Escaped Test",
      systemKey: "gba",
      format: "Archive",
      files: [
        {
          sourceUrl: server.url,
          sourceName: "Escaped Test.zip",
          targetName: "Escaped Test.zip",
          size: zip.byteLength
        }
      ],
      extractedFiles: [{ name: "../Escaped Test.gba", size: 2 }],
      fileCount: 1,
      totalSize: 2,
      requiresExtraction: true,
      canDownload: true,
      warnings: [],
      confidence: 0.9,
      reason: "ZIP contains a compatible file"
    }, pathToFileUri(destination));
    const completed = await waitForJob(job.id);

    expect(completed.status).toBe("complete");
    expect(await readFile(join(destination, "Escaped Test.gba"))).toEqual(Buffer.from([8, 9]));
    await expect(stat(join(parent, "Escaped Test.gba"))).rejects.toMatchObject({ code: "ENOENT" });
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

  it("fails instead of overwriting an existing direct file with a different size", async () => {
    const server = await serveBuffer(new Uint8Array([4, 5, 6]));
    const destination = await mkdtemp(join(tmpdir(), "romdeck-overwrite-test-roms-"));
    await writeFile(join(destination, "Overwrite Test.gba"), Buffer.from([1]));

    const job = await enqueueDownload(testDirectCandidate({
      title: "Overwrite Test",
      targetName: "Overwrite Test.gba",
      sourceUrl: server.url,
      size: 3
    }), pathToFileUri(destination));
    const completed = await waitForJob(job.id);

    expect(completed.status).toBe("failed");
    expect(completed.error).toContain("already exists with different size");
    expect(await readFile(join(destination, "Overwrite Test.gba"))).toEqual(Buffer.from([1]));
  });

  it("returns an existing active job for duplicate download requests", async () => {
    const server = await serveSlowBuffer(new Uint8Array(128 * 1024).fill(3));
    const destination = await mkdtemp(join(tmpdir(), "romdeck-duplicate-test-roms-"));
    const candidate = testDirectCandidate({
      title: "Duplicate Test",
      targetName: "Duplicate Test.gba",
      sourceUrl: server.url
    });

    const first = await enqueueDownload(candidate, pathToFileUri(destination));
    const second = await enqueueDownload(candidate, pathToFileUri(destination));
    await cancelDownload(first.id);
    await waitForJob(first.id);

    expect(second.id).toBe(first.id);
  });

  it("clears terminal download history", async () => {
    const jobs = await clearDownloadHistory();

    expect(jobs.every((job) => !["complete", "failed", "skipped", "canceled"].includes(job.status))).toBe(true);
  });

  it("lists newest download jobs first", async () => {
    const firstServer = await serveBuffer(new Uint8Array([1]));
    const secondServer = await serveBuffer(new Uint8Array([2]));
    const destination = await mkdtemp(join(tmpdir(), "romdeck-order-test-roms-"));

    const first = await enqueueDownload(testDirectCandidate({
      title: "First Order Test",
      targetName: "First Order Test.gba",
      sourceUrl: firstServer.url
    }), pathToFileUri(destination));
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await enqueueDownload(testDirectCandidate({
      title: "Second Order Test",
      targetName: "Second Order Test.gba",
      sourceUrl: secondServer.url
    }), pathToFileUri(destination));

    await waitForJob(first.id);
    await waitForJob(second.id);
    const jobs = await listDownloadJobs();

    expect(jobs[0].id).toBe(second.id);
    expect(jobs[1].id).toBe(first.id);
  });
});

function testDirectCandidate(options: { title: string; targetName: string; sourceUrl: string; size?: number }): DownloadCandidate {
  return {
    id: `test|gba|${options.targetName}`,
    source: "internet-archive",
    itemId: "test",
    title: options.title,
    systemKey: "gba",
    format: "GBA",
    files: [
      {
        sourceUrl: options.sourceUrl,
        sourceName: options.targetName,
        targetName: options.targetName,
        size: options.size ?? 1
      }
    ],
    fileCount: 1,
    totalSize: options.size ?? 1,
    requiresExtraction: false,
    canDownload: true,
    warnings: [],
    confidence: 0.9,
    reason: "direct order test file"
  };
}

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
