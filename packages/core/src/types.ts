export type SystemKey =
  | "gba"
  | "gb"
  | "gbc"
  | "nes"
  | "snes"
  | "n64"
  | "nds"
  | "n3ds"
  | "wii"
  | "wiiu"
  | "psx"
  | "ps2"
  | "psp"
  | "psvita"
  | "gamecube"
  | "dreamcast"
  | "xbox"
  | "xbox360";

export interface SystemDefinition {
  key: SystemKey;
  displayName: string;
  extensions: string[];
  archiveExtensions: string[];
  preferredExtensions: string[];
  esdeDirectoryNames: string[];
}

export interface SystemConfig {
  enabled: boolean;
  destinationUri?: string;
}

export interface AppConfig {
  version: 1;
  systems: Partial<Record<SystemKey, SystemConfig>>;
}

export interface SourceFile {
  name: string;
  size?: number;
  format?: string;
  source?: string;
  crc32?: string;
  md5?: string;
  sha1?: string;
}

export interface SearchResult {
  source: "internet-archive";
  itemId: string;
  title: string;
  systemKey: SystemKey;
  year?: number;
  region?: string;
  version?: string;
  confidence: number;
}

export interface ArchiveEntry {
  name: string;
  size?: number;
}

export interface ResolvedFile {
  sourceUrl: string;
  sourceName: string;
  targetName: string;
  size?: number;
  crc32?: string;
  md5?: string;
  sha1?: string;
}

export interface DownloadCandidate {
  id: string;
  source: "internet-archive";
  itemId: string;
  title: string;
  systemKey: SystemKey;
  format: string;
  region?: string;
  version?: string;
  files: ResolvedFile[];
  extractedFiles?: ArchiveEntry[];
  fileCount: number;
  totalSize?: number;
  requiresExtraction: boolean;
  canDownload: boolean;
  warnings: string[];
  confidence: number;
  reason: string;
}

export interface LocalFileEntry {
  name: string;
  relativePath?: string;
  size?: number;
  modifiedAt?: string;
}

export interface InstalledGame {
  systemKey: SystemKey;
  title: string;
  normalizedTitle: string;
  comparableTitle: string;
  region?: string;
  version?: string;
  files: LocalFileEntry[];
}

export type InstalledState = "installed" | "possible" | "missing";

export interface PlannedDownloadJob {
  id: string;
  systemKey: SystemKey;
  title: string;
  destinationUri: string;
  files: ResolvedFile[];
  status: "queued";
}
