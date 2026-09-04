import { unzipSync } from "fflate";
import { extensionOf, isDirectSystemFile, type ArchiveEntry, type DownloadCandidate, type SystemKey } from "@romdeck/core";
import { canUseJsWasmArchive, inspectJsWasmArchive, jsWasmArchiveLimitLabel } from "./libarchiveAdapter.js";
import { parseZipCentralDirectory } from "./zipCentralDirectory.js";

const MAX_INSPECT_BYTES = 64 * 1024 * 1024;
const ZIP_TAIL_BYTES = 128 * 1024;

export async function enrichArchiveCandidates(candidates: DownloadCandidate[]): Promise<DownloadCandidate[]> {
  const enriched: DownloadCandidate[] = [];

  for (const candidate of candidates) {
    const archiveExtension = candidate.files.length === 1 ? extensionOf(candidate.files[0].targetName) : "";
    if (!candidate.requiresExtraction) {
      enriched.push(candidate);
      continue;
    }

    if (archiveExtension !== ".zip") {
      const label = archiveExtension ? archiveExtension.toUpperCase().slice(1) : "Archive";
      if ([".7z", ".rar"].includes(archiveExtension) && canUseJsWasmArchive(candidate.files[0].size)) {
        const inspected = await inspectBufferedArchive(candidate.files[0].sourceUrl, candidate.systemKey);
        if (inspected.length > 0) {
          enriched.push({
            ...candidate,
            title: titleFromEntry(inspected[0].name, candidate.title),
            extractedFiles: inspected,
            fileCount: inspected.length,
            totalSize: inspected.reduce((sum, entry) => sum + (entry.size ?? 0), 0) || candidate.totalSize,
            canDownload: true,
            warnings: [],
            confidence: Math.min(0.82, candidate.confidence + 0.22),
            reason: inspected.length === 1
              ? `${label} contains ${inspected[0].name}`
              : `${label} contains ${inspected.length} compatible files`
          });
          continue;
        }
      }

      enriched.push({
        ...candidate,
        canDownload: false,
        warnings: [`${label} extraction uses JS/WASM and is currently limited to ${jsWasmArchiveLimitLabel()}.`],
        reason: `${label} extraction uses JS/WASM and is currently limited to ${jsWasmArchiveLimitLabel()}.`
      });
      continue;
    }

    const inspected = await inspectZipUrl(candidate.files[0].sourceUrl, candidate.systemKey, candidate.files[0].size);
    if (!inspected.inspected) {
      enriched.push({
        ...candidate,
        reason: inspected.reason ?? candidate.reason,
        canDownload: false,
        warnings: [inspected.reason ?? "Archive could not be inspected before download."]
      });
      continue;
    }

    if (inspected.entries.length === 0) {
      continue;
    }

    const inspectedReason = inspected.entries.length === 1
      ? `ZIP contains ${inspected.entries[0].name}`
      : `ZIP contains ${inspected.entries.length} compatible files`;

    enriched.push({
      ...candidate,
      title: titleFromEntry(inspected.entries[0].name, candidate.title),
      extractedFiles: inspected.entries,
      fileCount: inspected.entries.length,
      totalSize: inspected.entries.reduce((sum, entry) => sum + (entry.size ?? 0), 0) || candidate.totalSize,
      canDownload: true,
      warnings: [],
      confidence: Math.min(0.88, candidate.confidence + 0.25),
      reason: inspectedReason
    });
  }

  return enriched;
}

async function inspectBufferedArchive(url: string, systemKey: SystemKey): Promise<ArchiveEntry[]> {
  const response = await fetch(url);
  if (!response.ok) {
    return [];
  }
  return inspectJsWasmArchive(new Uint8Array(await response.arrayBuffer()), systemKey);
}

async function inspectZipUrl(
  url: string,
  systemKey: SystemKey,
  knownSize?: number
): Promise<{ inspected: boolean; entries: ArchiveEntry[]; reason?: string }> {
  if (knownSize && knownSize > MAX_INSPECT_BYTES) {
    const rangeInspection = await inspectZipCentralDirectory(url, systemKey, knownSize);
    if (rangeInspection.inspected) {
      return rangeInspection;
    }
    return { inspected: false, entries: [], reason: rangeInspection.reason ?? "ZIP is too large for pre-download inspection" };
  }

  const response = await fetch(url);
  if (!response.ok) {
    return { inspected: false, entries: [], reason: `ZIP inspection failed with HTTP ${response.status}` };
  }

  const contentLength = Number(response.headers.get("content-length")) || knownSize;
  if (contentLength && contentLength > MAX_INSPECT_BYTES) {
    return { inspected: false, entries: [], reason: "ZIP is too large for pre-download inspection" };
  }

  const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const entries = Object.entries(archive)
    .filter(([name]) => isDirectSystemFile(systemKey, name))
    .map(([name, data]) => ({ name, size: data.byteLength }));

  return { inspected: true, entries };
}

async function inspectZipCentralDirectory(
  url: string,
  systemKey: SystemKey,
  archiveSize: number
): Promise<{ inspected: boolean; entries: ArchiveEntry[]; reason?: string }> {
  const tailStart = Math.max(0, archiveSize - ZIP_TAIL_BYTES);
  const tail = await fetchRange(url, tailStart, archiveSize - 1);
  if (!tail) {
    return { inspected: false, entries: [], reason: "ZIP server did not provide range inspection." };
  }

  try {
    const directory = parseZipCentralDirectory(tail, archiveSize, tailStart);
    if (directory.zip64) {
      return { inspected: false, entries: [], reason: "ZIP64 central directory is not supported yet." };
    }
    return {
      inspected: true,
      entries: directory.entries.filter((entry) => isDirectSystemFile(systemKey, entry.name)),
      reason: "ZIP central directory inspected without downloading archive."
    };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("incomplete")) {
      return { inspected: false, entries: [], reason: error instanceof Error ? error.message : String(error) };
    }
  }

  const metadata = parseZipCentralDirectoryMetadata(tail, archiveSize, tailStart);
  if (!metadata || metadata.zip64) {
    return { inspected: false, entries: [], reason: metadata?.zip64 ? "ZIP64 central directory is not supported yet." : "ZIP central directory metadata was not found." };
  }

  const centralDirectory = await fetchRange(
    url,
    metadata.centralDirectoryOffset,
    metadata.centralDirectoryOffset + metadata.centralDirectorySize - 1
  );
  if (!centralDirectory) {
    return { inspected: false, entries: [], reason: "ZIP central directory range could not be fetched." };
  }

  return {
    inspected: true,
    entries: parseZipCentralDirectory(mergeCentralDirectoryAndTail(centralDirectory, tail), archiveSize, metadata.centralDirectoryOffset)
      .entries
      .filter((entry) => isDirectSystemFile(systemKey, entry.name)),
    reason: "ZIP central directory inspected without downloading archive."
  };
}

async function fetchRange(url: string, start: number, end: number): Promise<Uint8Array | null> {
  const response = await fetch(url, {
    headers: {
      range: `bytes=${start}-${end}`
    }
  });
  if (response.status !== 206) {
    return null;
  }
  return new Uint8Array(await response.arrayBuffer());
}

function parseZipCentralDirectoryMetadata(
  tail: Uint8Array,
  archiveSize: number,
  tailStart: number
): { centralDirectoryOffset: number; centralDirectorySize: number; zip64: boolean } | null {
  try {
    const parsed = parseZipCentralDirectory(tail, archiveSize, tailStart);
    return {
      centralDirectoryOffset: parsed.centralDirectoryOffset,
      centralDirectorySize: parsed.centralDirectorySize,
      zip64: parsed.zip64
    };
  } catch {
    const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    for (let offset = view.byteLength - 22; offset >= 0; offset -= 1) {
      if (view.getUint32(offset, true) !== 0x06054b50) {
        continue;
      }
      const centralDirectorySize = view.getUint32(offset + 12, true);
      const centralDirectoryOffset = view.getUint32(offset + 16, true);
      return {
        centralDirectoryOffset,
        centralDirectorySize,
        zip64: centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff
      };
    }
    return null;
  }
}

function mergeCentralDirectoryAndTail(centralDirectory: Uint8Array, tail: Uint8Array): Uint8Array {
  const merged = new Uint8Array(centralDirectory.byteLength + tail.byteLength);
  merged.set(centralDirectory, 0);
  merged.set(tail, centralDirectory.byteLength);
  return merged;
}

function titleFromEntry(entryName: string, fallback: string): string {
  const name = entryName.split(/[\\/]/).pop();
  return name ? name.replace(/\.[a-z0-9]+$/i, "") : fallback;
}
