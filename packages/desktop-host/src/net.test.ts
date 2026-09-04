import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchJson, fetchWithRetries } from "./net.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("net", () => {
  it("retries transient HTTP responses", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("temporary", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    const response = await fetchWithRetries("https://example.test/file", {
      label: "test fetch",
      attempts: 2,
      timeoutMs: 1000
    });

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("reports permanent JSON HTTP failures with context", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 404 })));

    await expect(fetchJson("https://example.test/missing", {
      label: "test json",
      attempts: 1,
      timeoutMs: 1000
    })).rejects.toThrow("test json failed with HTTP 404");
  });

  it("does not pass retry-only options into fetch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetch);

    await fetchWithRetries("https://example.test/file", {
      label: "test fetch",
      attempts: 1,
      timeoutMs: 1000,
      headers: {
        accept: "text/plain"
      }
    });

    const requestOptions = fetch.mock.calls[0][1] as RequestInit;
    expect(requestOptions).not.toHaveProperty("label");
    expect(requestOptions).not.toHaveProperty("attempts");
    expect(requestOptions).not.toHaveProperty("timeoutMs");
    expect(requestOptions).toMatchObject({
      headers: {
        accept: "text/plain"
      }
    });
  });
});
