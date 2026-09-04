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
const metadataCache = new Map<string, SourceFile[]>();

export async function searchInternetArchive(systemKey: SystemKey, query: string): Promise<SearchResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) {
    return [];
  }

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
  logInfo("Internet Archive search completed", {
    systemKey,
    query: cleanQuery,
    results: sorted.length,
    durationMs: Date.now() - startedAt
  });
  return sorted;
}

export async function fetchInternetArchiveFiles(itemId: string): Promise<SourceFile[]> {
  const cached = metadataCache.get(itemId);
  if (cached) {
    logInfo("Internet Archive metadata cache hit", { itemId, files: cached.length });
    return cached;
  }

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
      source: file.source
    }));
  metadataCache.set(itemId, files);
  logInfo("Internet Archive metadata completed", {
    itemId,
    files: files.length,
    durationMs: Date.now() - startedAt
  });
  return files;
}

function flatten(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.join(" ");
  }
  return value ?? "";
}
