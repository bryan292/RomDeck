import { rankSearchResult, sortAndFilterSearchResults, type SearchResult, type SourceFile, type SystemKey } from "@romdeck/core";
import { logInfo } from "./logger.js";
import { fetchJson } from "./net.js";

interface AdvancedSearchResponse {
  response?: {
    docs?: Array<{
      identifier?: string;
      title?: string;
      year?: string | number;
      collection?: string | string[];
      subject?: string | string[];
      description?: string | string[];
    }>;
  };
}

interface MetadataResponse {
  files?: Array<{
    name?: string;
    size?: string;
    format?: string;
    source?: string;
    crc32?: string;
    md5?: string;
    sha1?: string;
  }>;
}

const SYSTEM_TERMS: Record<SystemKey, string[]> = {
  gba: ["game boy advance", "gba"],
  gb: ["game boy"],
  gbc: ["game boy color", "gbc"],
  nes: ["nes", "nintendo entertainment system"],
  snes: ["snes", "super nintendo"],
  n64: ["nintendo 64", "n64"],
  nds: ["nintendo ds", "nds"],
  n3ds: ["nintendo 3ds", "3ds"],
  wii: ["nintendo wii", "wii"],
  wiiu: ["wii u", "wiiu", "nintendo wii u"],
  psx: ["playstation", "psx"],
  ps2: ["playstation 2", "ps2"],
  psp: ["playstation portable", "psp"],
  psvita: ["playstation vita", "ps vita", "psvita", "vita"],
  gamecube: ["gamecube", "game cube", "gcn"],
  dreamcast: ["dreamcast"],
  xbox: ["xbox", "original xbox"],
  xbox360: ["xbox 360", "xbox360"]
};
const SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const METADATA_CACHE_TTL_MS = 15 * 60 * 1000;

const searchCache = new Map<string, CacheEntry<SearchResult[]>>();
const metadataCache = new Map<string, CacheEntry<SourceFile[]>>();
const searchInflight = new Map<string, Promise<SearchResult[]>>();
const metadataInflight = new Map<string, Promise<SourceFile[]>>();

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

export async function searchInternetArchive(systemKey: SystemKey, query: string): Promise<SearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return [];
  }

  const cacheKey = searchCacheKey(systemKey, cleanQuery);
  const cached = getCached(searchCache, cacheKey);
  if (cached) {
    logInfo("Internet Archive search cache hit", { systemKey, query: cleanQuery, results: cached.length });
    return cloneSearchResults(cached);
  }

  const inflight = searchInflight.get(cacheKey);
  if (inflight) {
    logInfo("Internet Archive search joined in-flight request", { systemKey, query: cleanQuery });
    return cloneSearchResults(await inflight);
  }

  const request = fetchSearchResults(systemKey, cleanQuery, cacheKey);
  searchInflight.set(cacheKey, request);
  try {
    return cloneSearchResults(await request);
  } finally {
    searchInflight.delete(cacheKey);
  }
}

async function fetchSearchResults(systemKey: SystemKey, cleanQuery: string, cacheKey: string): Promise<SearchResult[]> {
  const terms = SYSTEM_TERMS[systemKey].map((term) => `"${term}"`).join(" OR ");
  const q = `(title:(${cleanQuery}) OR ${cleanQuery}) AND mediatype:software AND (${terms})`;
  const url = new URL("https://archive.org/advancedsearch.php");
  url.searchParams.set("q", q);
  url.searchParams.append("fl[]", "identifier");
  url.searchParams.append("fl[]", "title");
  url.searchParams.append("fl[]", "year");
  url.searchParams.append("fl[]", "collection");
  url.searchParams.append("fl[]", "subject");
  url.searchParams.append("fl[]", "description");
  url.searchParams.set("rows", "50");
  url.searchParams.set("page", "1");
  url.searchParams.set("output", "json");

  const startedAt = Date.now();
  logInfo("Internet Archive search started", { systemKey, query: cleanQuery });
  const data = await fetchJson<AdvancedSearchResponse>(url, {
    label: "Internet Archive search",
    timeoutMs: 15_000,
    attempts: 3
  });
  const results = (data.response?.docs ?? [])
    .filter((doc) => doc.identifier && doc.title)
    .map((doc): SearchResult => {
      const metadataText = [
        flatten(doc.collection),
        flatten(doc.subject),
        flatten(doc.description)
      ].join(" ");
      return {
        source: "internet-archive",
        itemId: doc.identifier as string,
        title: doc.title as string,
        systemKey,
        year: doc.year === undefined ? undefined : Number(doc.year),
        confidence: rankSearchResult({
          query: cleanQuery,
          systemKey,
          title: doc.title as string,
          identifier: doc.identifier as string,
          metadataText
        })
      };
    });

  const sorted = sortAndFilterSearchResults(results).slice(0, 24);
  searchCache.set(cacheKey, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    value: sorted
  });
  logInfo("Internet Archive search completed", {
    systemKey,
    query: cleanQuery,
    results: sorted.length,
    durationMs: Date.now() - startedAt
  });
  return sorted;
}

export async function fetchInternetArchiveFiles(itemId: string): Promise<SourceFile[]> {
  const cached = getCached(metadataCache, itemId);
  if (cached) {
    logInfo("Internet Archive metadata cache hit", { itemId, files: cached.length });
    return cloneSourceFiles(cached);
  }

  const inflight = metadataInflight.get(itemId);
  if (inflight) {
    logInfo("Internet Archive metadata joined in-flight request", { itemId });
    return cloneSourceFiles(await inflight);
  }

  const request = fetchMetadataFiles(itemId);
  metadataInflight.set(itemId, request);
  try {
    return cloneSourceFiles(await request);
  } finally {
    metadataInflight.delete(itemId);
  }
}

async function fetchMetadataFiles(itemId: string): Promise<SourceFile[]> {
  const url = `https://archive.org/metadata/${encodeURIComponent(itemId)}`;
  const startedAt = Date.now();
  logInfo("Internet Archive metadata started", { itemId });
  const data = await fetchJson<MetadataResponse>(url, {
    label: "Internet Archive metadata",
    timeoutMs: 15_000,
    attempts: 3
  });
  const files = (data.files ?? [])
    .filter((file) => file.name)
    .map((file) => ({
      name: file.name as string,
      size: file.size ? Number(file.size) : undefined,
      format: file.format,
      source: file.source,
      crc32: file.crc32,
      md5: file.md5,
      sha1: file.sha1
    }));
  metadataCache.set(itemId, {
    expiresAt: Date.now() + METADATA_CACHE_TTL_MS,
    value: files
  });
  logInfo("Internet Archive metadata completed", {
    itemId,
    files: files.length,
    durationMs: Date.now() - startedAt
  });
  return files;
}

export function clearInternetArchiveCaches(): void {
  searchCache.clear();
  metadataCache.clear();
  searchInflight.clear();
  metadataInflight.clear();
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function searchCacheKey(systemKey: SystemKey, query: string): string {
  return `${systemKey}:${query.trim().toLocaleLowerCase()}`;
}

function cloneSearchResults(results: SearchResult[]): SearchResult[] {
  return results.map((result) => ({ ...result }));
}

function cloneSourceFiles(files: SourceFile[]): SourceFile[] {
  return files.map((file) => ({ ...file }));
}

function flatten(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.join(" ");
  }
  return value ?? "";
}
