import { afterEach, describe, expect, it, vi } from "vitest";
import type { DownloadCandidate } from "@romdeck/core";
import { enrichArchiveCandidates } from "./archiveInspector.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("archive candidate enrichment", () => {
  it("blocks 7z archives with unknown size", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const [candidate] = await enrichArchiveCandidates([
      archiveCandidate({ targetName: "Unknown Size.7z", size: undefined })
    ]);

    expect(candidate.canDownload).toBe(false);
    expect(candidate.reason).toContain("size is unknown");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("blocks rar archives that exceed the JS/WASM extraction limit", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const [candidate] = await enrichArchiveCandidates([
      archiveCandidate({ targetName: "Too Large.rar", size: 257 * 1024 * 1024 })
    ]);

    expect(candidate.canDownload).toBe(false);
    expect(candidate.reason).toContain("exceeds JS/WASM extraction limit");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows bounded 7z archives without expensive preinspection", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const [candidate] = await enrichArchiveCandidates([
      archiveCandidate({ targetName: "Bounded.7z", size: 32 * 1024 * 1024 })
    ]);

    expect(candidate.canDownload).toBe(true);
    expect(candidate.reason).toContain("not inspected before download");
    expect(fetch).not.toHaveBeenCalled();
  });
});

function archiveCandidate(options: { targetName: string; size?: number }): DownloadCandidate {
  return {
    id: `test|gba|${options.targetName}`,
    source: "internet-archive",
    itemId: "test",
    title: options.targetName,
    systemKey: "gba",
    format: "Archive",
    files: [
      {
        sourceUrl: `https://archive.org/download/test/${encodeURIComponent(options.targetName)}`,
        sourceName: options.targetName,
        targetName: options.targetName,
        size: options.size
      }
    ],
    fileCount: 1,
    totalSize: options.size,
    requiresExtraction: true,
    canDownload: false,
    warnings: ["Archive must be inspected before download."],
    confidence: 0.55,
    reason: "Archive may contain GBA files"
  };
}
