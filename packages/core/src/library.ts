import type { InstalledGame, SystemKey } from "./types.js";

export interface InstalledLibraryFilter {
  systemKey?: SystemKey | "all";
  query?: string;
}

export interface InstalledSystemSummary {
  systemKey: SystemKey;
  count: number;
}

export interface InstalledDuplicateGroup {
  systemKey: SystemKey;
  comparableTitle: string;
  games: InstalledGame[];
  fileCount: number;
}

export function filterInstalledGames(installed: InstalledGame[], filter: InstalledLibraryFilter = {}): InstalledGame[] {
  const systemKey = filter.systemKey === "all" ? undefined : filter.systemKey;
  const query = normalizeLibraryQuery(filter.query ?? "");

  return installed
    .filter((game) => !systemKey || game.systemKey === systemKey)
    .filter((game) => {
      if (!query) {
        return true;
      }
      const haystack = [
        game.title,
        game.normalizedTitle,
        game.comparableTitle,
        game.region ?? "",
        game.version ?? "",
        ...game.files.flatMap((file) => [file.name, file.relativePath ?? ""])
      ].join(" ");
      const normalizedHaystack = normalizeLibraryQuery(haystack);
      return query.split(/\s+/).every((term) => normalizedHaystack.includes(term));
    })
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

export function findDuplicateInstalledGroups(installed: InstalledGame[]): InstalledDuplicateGroup[] {
  const groups = new Map<string, InstalledGame[]>();

  for (const game of installed) {
    if (!game.comparableTitle) {
      continue;
    }
    const key = `${game.systemKey}:${game.comparableTitle}`;
    groups.set(key, [...(groups.get(key) ?? []), game]);
  }

  return [...groups.values()]
    .filter((games) => games.length > 1)
    .map((games) => ({
      systemKey: games[0].systemKey,
      comparableTitle: games[0].comparableTitle,
      games: [...games].sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" })),
      fileCount: games.reduce((count, game) => count + game.files.length, 0)
    }))
    .sort((a, b) => a.systemKey.localeCompare(b.systemKey) || a.comparableTitle.localeCompare(b.comparableTitle));
}

export function summarizeInstalledSystems(installed: InstalledGame[]): InstalledSystemSummary[] {
  const counts = new Map<SystemKey, number>();
  for (const game of installed) {
    counts.set(game.systemKey, (counts.get(game.systemKey) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([systemKey, count]) => ({ systemKey, count }))
    .sort((a, b) => b.count - a.count || a.systemKey.localeCompare(b.systemKey));
}

function normalizeLibraryQuery(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
