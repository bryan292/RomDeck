import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

const configDir = join(tmpdir(), `romdeck-history-test-${process.pid}-${Date.now()}`);
process.env.ROMDECK_CONFIG_DIR = configDir;

beforeAll(async () => {
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, "downloads.json"), `${JSON.stringify([
    {
      id: "interrupted-job",
      systemKey: "gba",
      title: "Interrupted Test",
      destinationUri: "file:///tmp/romdeck-history-test",
      files: [
        {
          sourceUrl: "https://archive.org/download/test/Interrupted%20Test.gba",
          sourceName: "Interrupted Test.gba",
          targetName: "Interrupted Test.gba",
          size: 3
        }
      ],
      status: "downloading",
      bytesReceived: 2,
      bytesTotal: 3,
      downloadedBytes: 2,
      extractedBytes: 0,
      speedBytesPerSecond: 128,
      currentFile: "Interrupted Test.gba",
      requiresExtraction: false,
      createdAt: "2026-09-04T00:00:00.000Z",
      updatedAt: "2026-09-04T00:00:01.000Z"
    },
    {
      id: "complete-job",
      systemKey: "gba",
      title: "Complete Test",
      destinationUri: "file:///tmp/romdeck-history-test",
      files: [],
      status: "complete",
      bytesReceived: 3,
      bytesTotal: 3,
      downloadedBytes: 3,
      extractedBytes: 0,
      speedBytesPerSecond: 64,
      requiresExtraction: false,
      createdAt: "2026-09-04T00:00:02.000Z",
      updatedAt: "2026-09-04T00:00:03.000Z",
      completedAt: "2026-09-04T00:00:03.000Z"
    }
  ], null, 2)}\n`, "utf8");
});

describe("download history restart recovery", () => {
  it("restores interrupted active jobs as failed on startup", async () => {
    const { listDownloadJobs } = await import("./downloadManager.js");

    const jobs = await listDownloadJobs();
    const interrupted = jobs.find((job) => job.id === "interrupted-job");
    const complete = jobs.find((job) => job.id === "complete-job");

    expect(interrupted).toMatchObject({
      status: "failed",
      error: "Job was interrupted by app shutdown.",
      speedBytesPerSecond: 0
    });
    expect(complete).toMatchObject({
      status: "complete",
      error: undefined,
      speedBytesPerSecond: 0
    });
  });
});
