import { comparableTitle, regionFromName, versionFromName } from "./filenames.js";
import type { InstalledGame, InstalledState, SearchResult } from "./types.js";

export function isInstalled(result: SearchResult, installed: InstalledGame[]): boolean {
  return installedState(result, installed) === "installed";
}

export function installedState(result: SearchResult, installed: InstalledGame[]): InstalledState {
  const target = comparableTitle(result.title);
  const resultRegion = result.region ?? regionFromName(result.title);
  const resultVersion = result.version ?? versionFromName(result.title);
  const sameSystem = installed.filter((game) => game.systemKey === result.systemKey);
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

export function attachInstalledState<T extends SearchResult>(results: T[], installed: InstalledGame[]): Array<T & { installed: boolean; installedState: InstalledState }> {
  return results.map((result) => ({
    ...result,
    installed: isInstalled(result, installed),
    installedState: installedState(result, installed)
  }));
}

function weakTitleMatch(a: string, b: string): boolean {
  if (!a || !b) {
    return false;
  }
  return a.includes(b) || b.includes(a);
}
