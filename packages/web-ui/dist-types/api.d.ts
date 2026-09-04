import type { AppConfig, DownloadCandidate, InstalledGame, InstalledState, SearchResult, SystemDefinition } from "@romdeck/core";
declare global {
    interface Window {
        __TAURI_INTERNALS__?: unknown;
    }
}
export declare function getSystems(): Promise<{
    systems: SystemDefinition[];
}>;
export declare function getEsdeSuggestions(): Promise<{
    suggestions: EsdeFolderSuggestion[];
}>;
export declare function getConfig(): Promise<{
    config: AppConfig;
}>;
export declare function saveConfig(config: AppConfig): Promise<{
    config: AppConfig;
}>;
export declare function pathToUri(path: string): Promise<{
    destinationUri: string;
}>;
export declare function validateFolder(destinationUri: string): Promise<{
    ok: true;
    destinationUri: string;
}>;
export declare function scanLibrary(): Promise<{
    installed: InstalledGame[];
}>;
export declare function getLibrary(): Promise<{
    installed: InstalledGame[];
}>;
export declare function searchArchive(systemKey: string, query: string): Promise<{
    results: Array<SearchResult & {
        installed: boolean;
        installedState: InstalledState;
    }>;
}>;
export declare function resolveItem(itemId: string, systemKey: string, title: string): Promise<{
    candidates: DownloadCandidate[];
}>;
export declare function startDownload(candidate: DownloadCandidate): Promise<{
    job: DownloadJob;
}>;
export declare function getDownloads(): Promise<{
    jobs: DownloadJob[];
}>;
export declare function cancelDownload(jobId: string): Promise<{
    job: DownloadJob;
}>;
export declare function clearDownloadHistory(): Promise<{
    jobs: DownloadJob[];
}>;
export interface DownloadJob {
    id: string;
    systemKey: string;
    title: string;
    destinationUri: string;
    files: Array<{
        targetName: string;
        size?: number;
    }>;
    extractedFiles?: Array<{
        name: string;
        size?: number;
    }>;
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
