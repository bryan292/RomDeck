import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { LocalFileEntry } from "@romdeck/core";

const IGNORED_SCAN_DIRECTORIES = new Set([
  "media",
  "images",
  "image",
  "videos",
  "video",
  "manuals",
  "manual",
  "screenshots",
  "covers",
  "cover",
  "marquees",
  "metadata",
  "gamelists",
  ".git",
  ".romdeck"
]);

export function fileUriToPath(destinationUri: string): string {
  if (destinationUri.startsWith("file://")) {
    return fileURLToPath(destinationUri);
  }
  return destinationUri;
}

export function pathToFileUri(path: string): string {
  return pathToFileURL(resolve(path)).toString();
}

export async function validateWritableDirectory(destinationUri: string): Promise<void> {
  const directory = fileUriToPath(destinationUri);
  const info = await stat(directory);
  if (!info.isDirectory()) {
    throw new Error("Destination is not a directory.");
  }
  await access(directory, constants.W_OK);
}

export async function listDirectoryFiles(destinationUri: string): Promise<LocalFileEntry[]> {
  const directory = fileUriToPath(destinationUri);
  const files: LocalFileEntry[] = [];
  await collectFiles(directory, directory, files);
  return files;
}

async function collectFiles(root: string, current: string, files: LocalFileEntry[]): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_SCAN_DIRECTORIES.has(entry.name.toLowerCase())) {
        await collectFiles(root, fullPath, files);
      }
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    const info = await stat(fullPath);
    files.push({
      name: entry.name,
      relativePath: relative(root, fullPath).split(sep).join("/"),
      size: info.size,
      modifiedAt: info.mtime.toISOString()
    });
  }
}

export function resolveInsideDestination(destinationUri: string, targetName: string): string {
  const directory = resolve(fileUriToPath(destinationUri));
  const safeName = basename(targetName);
  const targetPath = resolve(directory, safeName);
  const escapeCheck = relative(directory, targetPath);
  if (escapeCheck.startsWith("..") || resolve(escapeCheck) === escapeCheck) {
    throw new Error("Target path escapes destination.");
  }
  return targetPath;
}

export async function ensureDirectory(destinationUri: string): Promise<void> {
  await mkdir(fileUriToPath(destinationUri), { recursive: true });
}

export async function existingFileMatches(path: string, size?: number): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile() && (size === undefined || info.size === size);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function openPartialWriteStream(path: string) {
  return createWriteStream(`${path}.part`);
}

export async function finalizePartial(path: string): Promise<void> {
  await rename(`${path}.part`, path);
}

export async function removePartial(path: string): Promise<void> {
  await rm(`${path}.part`, { force: true });
}
