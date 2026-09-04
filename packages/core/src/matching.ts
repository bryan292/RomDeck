import { comparableTitle, regionFromName, versionFromName } from "./filenames.js";
import type { DownloadCandidate, InstalledGame, InstalledState, SearchResult } from "./types.js";

export function isInstalled(result: SearchResult, installed: InstalledGame[]): boolean {
  return installedState(result, installed) === "installed";
}

export function installedState(result: SearchResult, installed: InstalledGame[]): InstalledState {
  return matchInstalledState(result, installed);
}

export function attachInstalledState<T extends SearchResult>(results: T[], installed: InstalledGame[]): Array<T & { installed: boolean; installedState: InstalledState }> {
  return results.map((result) => ({
    ...result,
    installed: isInstalled(result, installed),
    installedState: installedState(result, installed)
  }));
}

export function candidateInstalledState(candidate: DownloadCandidate, installed: InstalledGame[]): InstalledState {
  return matchInstalledState({
    systemKey: candidate.systemKey,
    title: candidate.title,
    region: candidate.region,
    version: candidate.version
  }, installed);
}

export function matchingInstalledGamesForCandidate(candidate: DownloadCandidate, installed: InstalledGame[]): InstalledGame[] {
  const target = comparableTitle(candidate.title);
  if (!target) {
    return [];
  }
  return installed
    .filter((game) => game.systemKey === candidate.systemKey)
    .filter((game) => game.comparableTitle === target || comparableTitle(game.title) === target || weakTitleMatch(game.comparableTitle, target))
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
}

function matchInstalledState(input: {
  systemKey: SearchResult["systemKey"];
  title: string;
  region?: string;
  version?: string;
}, installed: InstalledGame[]): InstalledState {
  const target = comparableTitle(input.title);
  const resultRegion = input.region ?? regionFromName(input.title);
  const resultVersion = input.version ?? versionFromName(input.title);
  const sameSystem = installed.filter((game) => game.systemKey === input.systemKey);
  let hasPossibleRegionOrVersionMatch = false;

  for (const game of sameSystem) {
    if (game.comparableTitle !== target && comparableTitle(game.title) !== target) {
      continue;
    }
    if (resultRegion && game.region && resultRegion !== game.region) {
      hasPossibleRegionOrVersionMatch = true;
      continue;
    }
    if (resultVersion && game.version && resultVersion !== game.version) {
      hasPossibleRegionOrVersionMatch = true;
      continue;
    }
    return "installed";
  }

  if (hasPossibleRegionOrVersionMatch) {
    return "possible";
  }

  return sameSystem.some((game) => weakTitleMatch(game.comparableTitle, target)) ? "possible" : "missing";
}

function weakTitleMatch(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  return a.includes(b) || b.includes(a);
}
