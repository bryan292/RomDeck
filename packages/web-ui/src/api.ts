import type { AppConfig, DownloadCandidate, InstalledGame, InstalledState, SearchResult, SystemDefinition } from "@romdeck/core";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

const API_BASE = typeof window !== "undefined" && window.__TAURI_INTERNALS__
  ? "http://127.0.0.1:5137"
  : "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options?.headers
    }
  });

  const body = await response.json();
  if (!response.ok) {
    throw new Error(body.error ?? "Request failed.");
  }
  return body as T;
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
  systemKey: string;
  systemName: string;
  path: string;
  destinationUri: string;
  confidence: "exact" | "expected";
  reason: string;
}
