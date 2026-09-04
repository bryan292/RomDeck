import { SYSTEMS } from "./systems.js";
import {
  extensionOf,
  isArchiveForSystem,
  isAuxiliaryFile,
  isDirectSystemFile,
  makeCandidateId,
  normalizeTitle,
  regionFromName,
  safeTargetName,
  versionFromName
} from "./filenames.js";
import type { DownloadCandidate, SourceFile, SystemKey } from "./types.js";

export function buildArchiveDownloadUrl(itemId: string, sourceName: string): string {
  const encodedPath = sourceName.split("/").map(encodeURIComponent).join("/");
  return `https://archive.org/download/${encodeURIComponent(itemId)}/${encodedPath}`;
}

export function resolveItemFiles(params: {
  itemId: string;
  title: string;
  systemKey: SystemKey;
  files: SourceFile[];
}): DownloadCandidate[] {
  const directFiles = params.files.filter((file) => isDirectSystemFile(params.systemKey, file.name));
  const archiveFiles = params.files.filter((file) => isArchiveForSystem(params.systemKey, file.name));

  if (params.systemKey === "psx") {
    return resolvePsx(params.itemId, params.title, params.systemKey, directFiles, archiveFiles);
  }

  if (params.systemKey === "gamecube") {
    return resolveSingleDiscSystem(params.itemId, params.title, params.systemKey, directFiles, archiveFiles, "GameCube");
  }

  if (params.systemKey === "wii") {
    return resolveSingleDiscSystem(params.itemId, params.title, params.systemKey, directFiles, archiveFiles, "Wii");
  }

  if (params.systemKey === "wiiu") {
    return resolveSingleDiscSystem(params.itemId, params.title, params.systemKey, directFiles, archiveFiles, "Wii U");
  }

  if (params.systemKey === "dreamcast") {
    return resolveDreamcast(params.itemId, params.title, params.systemKey, directFiles, archiveFiles);
  }

  if (params.systemKey === "ps2") {
    return resolveSingleDiscSystem(params.itemId, params.title, params.systemKey, directFiles, archiveFiles, "PlayStation 2");
  }

  if (params.systemKey === "psp") {
    return resolveSingleDiscSystem(params.itemId, params.title, params.systemKey, directFiles, archiveFiles, "PSP");
  }

  if (params.systemKey === "xbox") {
    return resolveSingleDiscSystem(params.itemId, params.title, params.systemKey, directFiles, archiveFiles, "Xbox");
  }

  if (params.systemKey === "xbox360") {
    return resolveSingleDiscSystem(params.itemId, params.title, params.systemKey, directFiles, archiveFiles, "Xbox 360");
  }

  const preferred = [...directFiles].sort((a, b) => preferenceRank(params.systemKey, a.name) - preferenceRank(params.systemKey, b.name));
  const directCandidates = preferred.map((file) => candidateFromFiles({
    itemId: params.itemId,
    title: titleFromFile(file.name, params.title),
    systemKey: params.systemKey,
    files: [file],
    format: formatFromExtension(file.name),
    requiresExtraction: false,
    confidence: 0.9,
    reason: `Selected direct ${extensionOf(file.name)} file`
  }));

  if (directCandidates.length > 0) {
    return directCandidates;
  }

  return archiveFiles.map((file) => candidateFromFiles({
    itemId: params.itemId,
    title: titleFromFile(file.name, params.title),
    systemKey: params.systemKey,
    files: [file],
    format: "Archive",
    requiresExtraction: true,
    confidence: 0.55,
    reason: `Archive may contain ${SYSTEMS[params.systemKey].extensions.join(", ")}`
  }));
}

function resolveDreamcast(
  itemId: string,
  title: string,
  systemKey: SystemKey,
  directFiles: SourceFile[],
  archiveFiles: SourceFile[]
): DownloadCandidate[] {
  const chd = directFiles.filter((file) => extensionOf(file.name) === ".chd");
  if (chd.length > 0) {
    return chd.map((file) => candidateFromFiles({
      itemId,
      title: titleFromFile(file.name, title),
      systemKey,
      files: [file],
      format: "CHD",
      requiresExtraction: false,
      confidence: 0.92,
      reason: "Selected preferred Dreamcast CHD file"
    }));
  }

  const gdis = directFiles.filter((file) => extensionOf(file.name) === ".gdi");
  const tracks = directFiles.filter((file) => [".bin", ".raw"].includes(extensionOf(file.name)));
  if (gdis.length > 0 && tracks.length > 0) {
    const groups = gdis.flatMap((gdi) => {
      const relatedTracks = relatedTracksForDescriptor(gdi, tracks);
      if (relatedTracks.length === 0) {
        return [];
      }
      return candidateFromFiles({
        itemId,
        title: titleFromFile(gdi.name, title),
        systemKey,
        files: [gdi, ...relatedTracks],
        format: "GDI + TRACKS",
        requiresExtraction: false,
        confidence: 0.82,
        reason: "Selected GDI with related track files"
      });
    });
    if (groups.length > 0) {
      return groups;
    }
  }

  const cdi = directFiles.filter((file) => extensionOf(file.name) === ".cdi");
  if (cdi.length > 0) {
    return cdi.map((file) => candidateFromFiles({
      itemId,
      title: titleFromFile(file.name, title),
      systemKey,
      files: [file],
      format: "CDI",
      requiresExtraction: false,
      confidence: 0.75,
      reason: "Selected Dreamcast CDI file"
    }));
  }

  return archiveFiles.map((file) => candidateFromFiles({
    itemId,
    title: titleFromFile(file.name, title),
    systemKey,
    files: [file],
    format: "Archive",
    requiresExtraction: true,
    confidence: 0.5,
    reason: "Archive may contain Dreamcast disc files"
  }));
}

function resolveSingleDiscSystem(
  itemId: string,
  title: string,
  systemKey: SystemKey,
  directFiles: SourceFile[],
  archiveFiles: SourceFile[],
  displayName: string
): DownloadCandidate[] {
  const preferred = [...directFiles].sort((a, b) => preferenceRank(systemKey, a.name) - preferenceRank(systemKey, b.name));
  if (preferred.length > 0) {
    return preferred.map((file) => candidateFromFiles({
      itemId,
      title: titleFromFile(file.name, title),
      systemKey,
      files: [file],
      format: formatFromExtension(file.name),
      requiresExtraction: false,
      confidence: 0.9,
      reason: `Selected ${displayName} ${formatFromExtension(file.name)} file`
    }));
  }

  return archiveFiles.map((file) => candidateFromFiles({
    itemId,
    title: titleFromFile(file.name, title),
    systemKey,
    files: [file],
    format: "Archive",
    requiresExtraction: true,
    confidence: 0.55,
    reason: `Archive may contain ${displayName} files`
  }));
}

function resolvePsx(
  itemId: string,
  title: string,
  systemKey: SystemKey,
  directFiles: SourceFile[],
  archiveFiles: SourceFile[]
): DownloadCandidate[] {
  const chd = directFiles.filter((file) => extensionOf(file.name) === ".chd");
  if (chd.length > 0) {
    return chd.map((file) => candidateFromFiles({
      itemId,
      title: titleFromFile(file.name, title),
      systemKey,
      files: [file],
      format: "CHD",
      requiresExtraction: false,
      confidence: 0.92,
      reason: "Selected preferred CHD file"
    }));
  }

  const cues = directFiles.filter((file) => extensionOf(file.name) === ".cue");
  const bins = directFiles.filter((file) => extensionOf(file.name) === ".bin");
  if (cues.length > 0 && bins.length > 0) {
    const groups = cues.flatMap((cue) => {
      const relatedBins = relatedBinsForCue(cue, bins);
      if (relatedBins.length === 0) {
        return [];
      }
      return candidateFromFiles({
        itemId,
        title: titleFromFile(cue.name, title),
        systemKey,
        files: [cue, ...relatedBins],
        format: "CUE + BIN",
        requiresExtraction: false,
        confidence: relatedBins.length > 0 ? 0.82 : 0.6,
        reason: "Selected CUE with related BIN files"
      });
    });
    if (groups.length > 0) {
      return groups;
    }
  }

  const iso = directFiles.filter((file) => extensionOf(file.name) === ".iso");
  if (iso.length > 0) {
    return iso.map((file) => candidateFromFiles({
      itemId,
      title: titleFromFile(file.name, title),
      systemKey,
      files: [file],
      format: "ISO",
      requiresExtraction: false,
      confidence: 0.78,
      reason: "Selected ISO file"
    }));
  }

  return archiveFiles.map((file) => candidateFromFiles({
    itemId,
    title: titleFromFile(file.name, title),
    systemKey,
    files: [file],
    format: "Archive",
    requiresExtraction: true,
    confidence: 0.5,
    reason: "Archive may contain PlayStation disc files"
  }));
}

function candidateFromFiles(params: {
  itemId: string;
  title: string;
  systemKey: SystemKey;
  files: SourceFile[];
  format: string;
  requiresExtraction: boolean;
  confidence: number;
  reason: string;
}): DownloadCandidate {
  const first = params.files[0];
  const region = regionFromName(first.name);
  const version = versionFromName(first.name);
  return {
    id: makeCandidateId([params.itemId, params.systemKey, ...params.files.map((file) => file.name)]),
    source: "internet-archive",
    itemId: params.itemId,
    title: params.title,
    systemKey: params.systemKey,
    format: params.format,
    region,
    version,
    files: params.files.filter((file) => !isAuxiliaryFile(file.name)).map((file) => ({
      sourceUrl: buildArchiveDownloadUrl(params.itemId, file.name),
      sourceName: file.name,
      targetName: safeTargetName(file.name),
      size: file.size,
      crc32: file.crc32,
      md5: file.md5,
      sha1: file.sha1
    })),
    fileCount: params.files.length,
    totalSize: params.files.reduce((sum, file) => sum + (file.size ?? 0), 0) || undefined,
    requiresExtraction: params.requiresExtraction,
    canDownload: !params.requiresExtraction,
    warnings: params.requiresExtraction ? ["Archive must be inspected before download."] : [],
    confidence: params.confidence,
    reason: params.reason
  };
}

function formatFromExtension(name: string): string {
  const ext = extensionOf(name).replace(".", "");
  return ext ? ext.toUpperCase() : "File";
}

function preferenceRank(systemKey: SystemKey, name: string): number {
  const ext = extensionOf(name);
  const rank = SYSTEMS[systemKey].preferredExtensions.indexOf(ext);
  return rank >= 0 ? rank : 999;
}

function titleFromFile(fileName: string, fallback: string): string {
  const basename = fileName.split("/").pop();
  return basename ? normalizeTitle(basename) : fallback;
}

function comparableDiscBase(name: string): string {
  return name.replace(/\\/g, "/")
    .toLowerCase()
    .split("/")
    .pop()!
    .replace(/\.(cue|bin)$/i, "")
    .replace(/\s*\(track\s*\d+\)/i, "")
    .replace(/\s*track\s*\d+/i, "")
    .replace(/\s*\d+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function relatedBinsForCue(cue: SourceFile, bins: SourceFile[]): SourceFile[] {
  const cueBase = comparableDiscBase(cue.name);
  const cueDirectory = directoryOf(cue.name);
  const sameDirectoryBins = bins.filter((bin) => directoryOf(bin.name) === cueDirectory);
  const candidates = sameDirectoryBins.length > 0 ? sameDirectoryBins : bins;
  return candidates.filter((bin) => {
    const binBase = comparableDiscBase(bin.name);
    return binBase === cueBase || binBase.startsWith(cueBase) || cueBase.startsWith(binBase);
  });
}

function relatedTracksForDescriptor(descriptor: SourceFile, tracks: SourceFile[]): SourceFile[] {
  const descriptorBase = comparableDiscBase(descriptor.name);
  const descriptorDirectory = directoryOf(descriptor.name);
  const sameDirectoryTracks = tracks.filter((track) => directoryOf(track.name) === descriptorDirectory);
  const candidates = sameDirectoryTracks.length > 0 ? sameDirectoryTracks : tracks;
  const related = candidates.filter((track) => {
    const trackBase = comparableDiscBase(track.name);
    return trackBase === descriptorBase || trackBase.startsWith(descriptorBase) || /\btrack\s*\d+\b/i.test(track.name);
  });
  return related.sort((a, b) => a.name.localeCompare(b.name));
}

function directoryOf(name: string): string {
  const normalized = name.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index >= 0 ? normalized.slice(0, index).toLowerCase() : "";
}
