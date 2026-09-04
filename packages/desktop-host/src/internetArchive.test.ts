import { afterEach, describe, expect, it, vi } from "vitest";
import { clearInternetArchiveCaches, fetchInternetArchiveFiles, searchInternetArchive } from "./internetArchive.js";

afterEach(() => {
  clearInternetArchiveCaches();
  vi.unstubAllGlobals();
});

describe("Internet Archive adapter cache", () => {
  it("caches repeated searches by system and query", async () => {
    const fetch = vi.fn(async () => jsonResponse({
      response: {
        docs: [
          {
            identifier: "metroid-fusion",
            title: "Metroid Fusion",
            year: "2002",
            collection: ["gba"],
            subject: ["Game Boy Advance"]
          }
        ]
      }
    }));
    vi.stubGlobal("fetch", fetch);

    const first = await searchInternetArchive("gba", "Metroid Fusion");
    const second = await searchInternetArchive("gba", " metroid fusion ");

    expect(first).toHaveLength(1);
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("joins concurrent metadata requests for the same item", async () => {
    const fetch = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return jsonResponse({
        files: [
          { name: "Metroid Fusion.gba", size: "8388608", format: "Game Boy Advance ROM" }
        ]
      });
    });
    vi.stubGlobal("fetch", fetch);

    const [first, second] = await Promise.all([
      fetchInternetArchiveFiles("metroid-fusion"),
      fetchInternetArchiveFiles("metroid-fusion")
    ]);

    expect(first).toEqual([{ name: "Metroid Fusion.gba", size: 8388608, format: "Game Boy Advance ROM", source: undefined }]);
    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
