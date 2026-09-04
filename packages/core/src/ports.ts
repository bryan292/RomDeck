import type {
  AppConfig,
  ArchiveEntry,
  DownloadCandidate,
  InstalledGame,
  LocalFileEntry,
  SearchResult,
  SourceFile,
  SystemKey
} from "./types.js";

export interface ProviderClient {
  search(systemKey: SystemKey, query: string): Promise<SearchResult[]>;
  files(itemId: string): Promise<SourceFile[]>;
}

export interface FileStore {
  validateWritableDirectory(destinationUri: string): Promise<void>;
  listDirectoryFiles(destinationUri: string): Promise<LocalFileEntry[]>;
  writeFileFromStream(options: FileWriteRequest): Promise<void>;
  removePartial(targetUri: string): Promise<void>;
}

export interface FileWriteRequest {
  destinationUri: string;
  targetName: string;
  bytes: AsyncIterable<Uint8Array>;
  expectedSize?: number;
}

export interface ConfigStore {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<AppConfig>;
}

export interface DownloadTransport {
  fetch(url: string, signal?: AbortSignal): Promise<DownloadResponse>;
}

export interface DownloadResponse {
  ok: boolean;
  status: number;
  contentLength?: number;
  body: AsyncIterable<Uint8Array>;
}

export interface ArchiveInspector {
  inspect(candidate: DownloadCandidate): Promise<DownloadCandidate>;
  extract(options: ArchiveExtractRequest): Promise<ArchiveExtractResult>;
}

export interface ArchiveExtractRequest {
  archiveBytes: AsyncIterable<Uint8Array>;
  systemKey: SystemKey;
  destinationUri: string;
}

export interface ArchiveExtractResult {
  entries: ArchiveEntry[];
}

export interface Clock {
  now(): Date;
}

export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface LibraryScanner {
  scan(systemKey: SystemKey, destinationUri: string): Promise<InstalledGame[]>;
}
