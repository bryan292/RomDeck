import type { AppConfig, DownloadCandidate, InstalledGame, InstalledState, SearchResult, SystemDefinition, SystemKey } from "@romdeck/core";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const API_BASE = defaultApiBase();
const REQUEST_RETRIES = API_BASE ? 30 : 0;
const REQUEST_RETRY_DELAY_MS = 350;
let sessionTokenPromise: Promise<string | null> | null = null;

export function canUseNativeDialogs(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean(window.__TAURI_INTERNALS__) || !["http:", "https:"].includes(window.location.protocol);
}

function defaultApiBase(): string {
  if (typeof window === "undefined") {
    return "";
  }
  if (
    (window.location.protocol === "http:" || window.location.protocol === "https:") &&
    (window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost")
  ) {
    return "";
  }
  return "http://127.0.0.1:5137";
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= REQUEST_RETRIES; attempt += 1) {
    try {
      const sessionToken = await romdeckSessionToken();
      const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          "content-type": "application/json",
          ...(sessionToken ? { "x-romdeck-session": sessionToken } : {}),
          ...options?.headers
        }
      });

      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error ?? "Request failed.");
      }
      return body as T;
    } catch (error) {
      lastError = error;
      if (!shouldRetryRequest(error, attempt, options?.method)) {
        break;
      }
      await delay(REQUEST_RETRY_DELAY_MS);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function romdeckSessionToken(): Promise<string | null> {
  if (!API_BASE || !canUseNativeDialogs()) {
    return Promise.resolve(null);
  }
  sessionTokenPromise ??= invoke<string>("romdeck_session_token").catch(() => null);
  return sessionTokenPromise;
}

function shouldRetryRequest(error: unknown, attempt: number, method?: string): boolean {
  const safeMethod = !method || method === "GET";
  return safeMethod && attempt < REQUEST_RETRIES && error instanceof TypeError;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function getSystems() {
  return request<{ systems: SystemDefinition[] }>("/api/systems");
}

export function getEsdeSuggestions() {
  return request<{ suggestions: EsdeFolderSuggestion[] }>("/api/esde/suggestions");
}

export function getConfig() {
  return request<{ config: AppConfig }>("/api/config");
}

export function getDiagnostics() {
  return request<{ diagnostics: HostDiagnostics }>("/api/diagnostics");
}

export function saveConfig(config: AppConfig) {
  return request<{ config: AppConfig }>("/api/config", {
    method: "PUT",
    body: JSON.stringify({ config })
  });
}

export function pathToUri(path: string) {
  return request<{ destinationUri: string }>("/api/path-uri", {
    method: "POST",
    body: JSON.stringify({ path })
  });
}

export function uriToPath(destinationUri: string) {
  return request<{ path: string }>("/api/file-path", {
    method: "POST",
    body: JSON.stringify({ destinationUri })
  });
}

export async function pickDirectoryPath(title = "Choose ROM folder"): Promise<string | null> {
  if (!canUseNativeDialogs()) {
    return null;
  }
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

export function validateFolder(destinationUri: string) {
  return request<{ ok: true; destinationUri: string }>("/api/folders/validate", {
    method: "POST",
    body: JSON.stringify({ destinationUri })
  });
}

export function scanLibrary() {
  return request<{ installed: InstalledGame[] }>("/api/library/scan", { method: "POST" });
}

export function getLibrary() {
  return request<{ installed: InstalledGame[] }>("/api/library");
}

export function searchArchive(systemKey: string, query: string) {
  return request<{ results: Array<SearchResult & { installed: boolean; installedState: InstalledState }> }>("/api/search", {
    method: "POST",
    body: JSON.stringify({ systemKey, query })
  });
}

export function resolveItem(itemId: string, systemKey: string, title: string) {
  const params = new URLSearchParams({ systemKey, title });
  return request<{ candidates: DownloadCandidate[] }>(`/api/items/${encodeURIComponent(itemId)}/resolve?${params}`);
}

export function startDownload(candidate: DownloadCandidate) {
  return request<{ job: DownloadJob }>("/api/downloads", {
    method: "POST",
    body: JSON.stringify({ candidate })
  });
}

export function getDownloads() {
  return request<{ jobs: DownloadJob[] }>("/api/downloads");
}

export function cancelDownload(jobId: string) {
  return request<{ job: DownloadJob }>(`/api/downloads/${encodeURIComponent(jobId)}/cancel`, {
    method: "POST"
  });
}

export function clearDownloadHistory() {
  return request<{ jobs: DownloadJob[] }>("/api/downloads/clear-history", {
    method: "POST"
  });
}

export interface DownloadJob {
  id: string;
  systemKey: string;
  title: string;
  destinationUri: string;
  files: Array<{ targetName: string; size?: number }>;
  extractedFiles?: Array<{ name: string; size?: number }>;
  status: "queued" | "downloading" | "extracting" | "complete" | "failed" | "skipped" | "canceled";
  bytesReceived: number;
  bytesTotal?: number;
  downloadedBytes: number;
  extractedBytes: number;
  speedBytesPerSecond: number;
  currentFile?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface EsdeFolderSuggestion {
  systemKey: SystemKey;
  systemName: string;
  path: string;
  destinationUri: string;
  confidence: "exact" | "expected";
  reason: string;
}

export interface HostDiagnostics {
  host: string;
  platform: string;
  arch: string;
  node: string;
  appDataDirectory: string;
  logFile?: string;
  sessionProtected: boolean;
}
