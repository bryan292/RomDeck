import { comparableTitle, isPrimarySystemFile, normalizeTitle, regionFromName, versionFromName } from "./filenames.js";
import type { InstalledGame, LocalFileEntry, SystemKey } from "./types.js";

export function scanInstalledGames(systemKey: SystemKey, files: LocalFileEntry[]): InstalledGame[] {
  const groups = new Map<string, LocalFileEntry[]>();

  for (const file of files) {
    const path = file.relativePath ?? file.name;
    if (!isPrimarySystemFile(systemKey, path)) {
      continue;
    }
    const title = normalizeTitle(path.split(/[\\/]/).pop() ?? path);
    const existing = groups.get(title) ?? [];
    existing.push(file);
    groups.set(title, existing);
  }

  return [...groups.entries()].map(([title, groupFiles]) => ({
    systemKey,
    title,
    normalizedTitle: title.toLowerCase(),
    comparableTitle: comparableTitle(title),
    region: regionFromName(title),
    version: versionFromName(title),
    files: groupFiles
  }));
}
