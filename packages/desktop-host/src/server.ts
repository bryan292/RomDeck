import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  attachInstalledState,
  resolveItemFiles,
  scanInstalledGames,
  isSystemKey,
  SYSTEM_LIST,
  type AppConfig,
  type DownloadCandidate
} from "@romdeck/core";
import { loadConfig, saveConfig } from "./config.js";
import { cancelDownload, clearDownloadHistory, enqueueDownload, initializeDownloadHistory, listDownloadJobs, onDownloadComplete } from "./downloadManager.js";
import { listDirectoryFiles, pathToFileUri, validateWritableDirectory } from "./files.js";
import { fetchInternetArchiveFiles, searchInternetArchive } from "./internetArchive.js";
import { enrichArchiveCandidates } from "./archiveInspector.js";
import { readJson, sendError, sendJson, serveStatic } from "./http.js";
import { detectEsdeFolderSuggestions } from "./esde.js";
import { logError, logInfo } from "./logger.js";

const PORT = Number(process.env.PORT ?? 5137);
const currentDir = dirname(fileURLToPath(import.meta.url));
const staticRoot = resolve(currentDir, "../../web-ui/dist");

let installedCache: ReturnType<typeof scanInstalledGames> = [];

onDownloadComplete(async () => {
  installedCache = await scanConfiguredSystems();
});

const server = createServer(async (request, response) => {
  const startedAt = Date.now();
  const requestPath = request.url ?? "/";
  let shouldLogRequest = true;
  try {
    response.setHeader("access-control-allow-origin", "*");
    response.setHeader("access-control-allow-methods", "GET,POST,PUT,OPTIONS");
    response.setHeader("access-control-allow-headers", "content-type");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    shouldLogRequest = !(request.method === "GET" && url.pathname === "/api/downloads");
    if (shouldLogRequest) {
      logInfo("HTTP request started", { method: request.method, path: url.pathname });
    }

    if (url.pathname === "/api/health") {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (url.pathname === "/api/systems" && request.method === "GET") {
      sendJson(response, 200, { systems: SYSTEM_LIST });
      return;
    }

    if (url.pathname === "/api/esde/suggestions" && request.method === "GET") {
      sendJson(response, 200, { suggestions: await detectEsdeFolderSuggestions() });
      return;
    }

    if (url.pathname === "/api/config" && request.method === "GET") {
      sendJson(response, 200, { config: await loadConfig() });
      return;
    }

    if (url.pathname === "/api/config" && request.method === "PUT") {
      const body = await readJson<{ config: AppConfig }>(request);
      sendJson(response, 200, { config: await saveConfig(body.config) });
      return;
    }

    if (url.pathname === "/api/path-uri" && request.method === "POST") {
      const body = await readJson<{ path: string }>(request);
      sendJson(response, 200, { destinationUri: pathToFileUri(body.path) });
      return;
    }

    if (url.pathname === "/api/folders/validate" && request.method === "POST") {
      const body = await readJson<{ destinationUri?: string; path?: string }>(request);
      const destinationUri = body.destinationUri ?? (body.path ? pathToFileUri(body.path) : undefined);
      if (!destinationUri) {
        sendError(response, 400, "destinationUri or path is required");
        return;
      }
      await validateWritableDirectory(destinationUri);
      sendJson(response, 200, { ok: true, destinationUri });
      return;
    }

    if (url.pathname === "/api/library/scan" && request.method === "POST") {
      installedCache = await scanConfiguredSystems();
      sendJson(response, 200, { installed: installedCache });
      return;
    }

    if (url.pathname === "/api/library" && request.method === "GET") {
      sendJson(response, 200, { installed: installedCache });
      return;
    }

    if (url.pathname === "/api/search" && request.method === "POST") {
      const body = await readJson<{ systemKey: unknown; query: string }>(request);
      if (!isSystemKey(body.systemKey)) {
        sendError(response, 400, "Unsupported systemKey.");
        return;
      }
      const results = await searchInternetArchive(body.systemKey, body.query);
      sendJson(response, 200, { results: attachInstalledState(results, installedCache) });
      return;
    }

    const resolveMatch = url.pathname.match(/^\/api\/items\/([^/]+)\/resolve$/);
    if (resolveMatch && request.method === "GET") {
      const itemId = decodeURIComponent(resolveMatch[1]);
      const systemKey = url.searchParams.get("systemKey");
      const title = url.searchParams.get("title") ?? itemId;
      if (!isSystemKey(systemKey)) {
        sendError(response, 400, "Unsupported systemKey.");
        return;
      }
      const files = await fetchInternetArchiveFiles(itemId);
      const candidates = resolveItemFiles({ itemId, title, systemKey, files });
      sendJson(response, 200, {
        candidates: await enrichArchiveCandidates(candidates)
      });
      return;
    }

    if (url.pathname === "/api/downloads" && request.method === "GET") {
      sendJson(response, 200, { jobs: await listDownloadJobs() });
      return;
    }

    if (url.pathname === "/api/downloads/clear-history" && request.method === "POST") {
      sendJson(response, 200, { jobs: await clearDownloadHistory() });
      return;
    }

    const cancelMatch = url.pathname.match(/^\/api\/downloads\/([^/]+)\/cancel$/);
    if (cancelMatch && request.method === "POST") {
      const job = await cancelDownload(decodeURIComponent(cancelMatch[1]));
      sendJson(response, 200, { job });
      return;
    }

    if (url.pathname === "/api/downloads" && request.method === "POST") {
      const body = await readJson<{ candidate: DownloadCandidate }>(request);
      const config = await loadConfig();
      const systemConfig = config.systems[body.candidate.systemKey];
      if (!systemConfig?.enabled || !systemConfig.destinationUri) {
        sendError(response, 400, "System destination is not configured.");
        return;
      }
      await validateWritableDirectory(systemConfig.destinationUri);
      const sourceFiles = await fetchInternetArchiveFiles(body.candidate.itemId);
      const resolvedCandidates = await enrichArchiveCandidates(resolveItemFiles({
        itemId: body.candidate.itemId,
        title: body.candidate.title,
        systemKey: body.candidate.systemKey,
        files: sourceFiles
      }));
      const trustedCandidate = resolvedCandidates.find((candidate) => candidate.id === body.candidate.id);
      if (!trustedCandidate) {
        sendError(response, 400, "Download candidate no longer matches provider metadata.");
        return;
      }
      if (!trustedCandidate.canDownload) {
        sendError(response, 400, trustedCandidate.warnings[0] ?? "Candidate is not downloadable yet.");
        return;
      }
      const job = await enqueueDownload(trustedCandidate, systemConfig.destinationUri);
      sendJson(response, 202, { job });
      return;
    }

    if (request.method === "GET" && await serveStatic(response, staticRoot, url.pathname)) {
      return;
    }

    sendError(response, 404, "Not found");
  } catch (error) {
    logError("HTTP request failed", error, { method: request.method, path: requestPath });
    sendError(response, 500, error);
  } finally {
    if (shouldLogRequest || Date.now() - startedAt > 500) {
      logInfo("HTTP request completed", {
        method: request.method,
        path: requestPath,
        durationMs: Date.now() - startedAt
      });
    }
  }
});

await initializeDownloadHistory();

server.listen(PORT, () => {
  logInfo(`RomDeck desktop host listening on http://localhost:${PORT}`);
});

async function scanConfiguredSystems() {
  const config = await loadConfig();
  const installed = [];
  for (const system of SYSTEM_LIST) {
    const systemConfig = config.systems[system.key];
    if (!systemConfig?.enabled || !systemConfig.destinationUri) {
      continue;
    }
    try {
      const files = await listDirectoryFiles(systemConfig.destinationUri);
      installed.push(...scanInstalledGames(system.key, files));
    } catch {
      // A missing or unreadable configured folder is surfaced in settings/downloads.
    }
  }
  return installed;
}
