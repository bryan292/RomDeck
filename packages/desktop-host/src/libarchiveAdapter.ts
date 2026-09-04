import { writeFile } from "node:fs/promises";
import { isDirectSystemFile, safeTargetName, type ArchiveEntry, type SystemKey } from "@romdeck/core";
import { existingFileMatches, finalizePartial, removePartial, resolveInsideDestination } from "./files.js";

const MAX_JS_WASM_ARCHIVE_BYTES = 256 * 1024 * 1024;

interface ArchiveModule {
  Archive: {
    open(file: File): Promise<ArchiveReader>;
  };
}

interface ArchiveReader {
  getFilesArray(): Promise<Array<{ file: CompressedFile | null; path: string }>>;
  close(): Promise<void>;
}

interface CompressedFile {
  name: string;
  size: number;
  extract(): Promise<File>;
}

export function canUseJsWasmArchive(size?: number): boolean {
  return size !== undefined && size <= MAX_JS_WASM_ARCHIVE_BYTES;
}

export function jsWasmArchiveLimitLabel(): string {
  return `${Math.round(MAX_JS_WASM_ARCHIVE_BYTES / 1024 / 1024)} MB`;
}

export async function inspectJsWasmArchive(buffer: Uint8Array, systemKey: SystemKey): Promise<ArchiveEntry[]> {
  const archive = await openArchive(buffer);
  try {
    const entries = await archive.getFilesArray();
    return entries
      .filter((entry) => entry.file && isDirectSystemFile(systemKey, `${entry.path}${entry.file.name}`))
      .map((entry) => ({
        name: `${entry.path}${entry.file!.name}`,
        size: entry.file!.size
      }));
  } finally {
    await archive.close();
  }
}

export async function extractJsWasmArchive(params: {
  buffer: Uint8Array;
  systemKey: SystemKey;
  destinationUri: string;
  onExtractedBytes: (bytes: number, currentFile: string) => void;
}): Promise<number> {
  const archive = await openArchive(params.buffer);
  let extracted = 0;
  try {
    const entries = await archive.getFilesArray();
    for (const entry of entries) {
      if (!entry.file) {
        continue;
      }
      const archiveName = `${entry.path}${entry.file.name}`;
      if (!isDirectSystemFile(params.systemKey, archiveName)) {
        continue;
      }
      const targetName = safeTargetName(archiveName);
      const targetPath = resolveInsideDestination(params.destinationUri, targetName);
      if (await existingFileMatches(targetPath, entry.file.size)) {
        extracted += 1;
        continue;
      }
      const file = await entry.file.extract();
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        await writeFile(`${targetPath}.part`, bytes);
        await finalizePartial(targetPath);
        params.onExtractedBytes(bytes.byteLength, targetName);
      } catch (error) {
        await removePartial(targetPath);
        throw error;
      }
      extracted += 1;
    }
  } finally {
    await archive.close();
  }

  return extracted;
}

async function openArchive(buffer: Uint8Array): Promise<ArchiveReader> {
  const module = await import("libarchive.js/dist/libarchive-node.mjs") as ArchiveModule;
  const copy = buffer.slice();
  return module.Archive.open(new File([copy.buffer], "archive"));
}
