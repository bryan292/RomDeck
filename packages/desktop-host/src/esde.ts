import { stat } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { SYSTEM_LIST, esdeDirectoryNamesForSystem, type SystemKey } from "@romdeck/core";
import { pathToFileUri } from "./files.js";

export interface EsdeFolderSuggestion {
  systemKey: SystemKey;
  systemName: string;
  path: string;
  destinationUri: string;
  confidence: "exact" | "expected";
  reason: string;
}

export interface EsdeDetectionOptions {
  homeDirectory?: string;
  candidateRoots?: string[];
}

export async function detectEsdeFolderSuggestions(options: EsdeDetectionOptions = {}): Promise<EsdeFolderSuggestion[]> {
  const roots = options.candidateRoots ?? commonEsdeRomRoots(options.homeDirectory ?? homedir());
  const rootStates = await Promise.all(roots.map(async (root) => ({
    root,
    exists: await isDirectory(root)
  })));
  const suggestions: EsdeFolderSuggestion[] = [];

  for (const system of SYSTEM_LIST) {
    for (const rootState of rootStates) {
      for (const directoryName of esdeDirectoryNamesForSystem(system.key)) {
        const systemPath = join(rootState.root, directoryName);
        const systemExists = await isDirectory(systemPath);
        if (!systemExists && !rootState.exists) {
          continue;
        }
        suggestions.push({
          systemKey: system.key,
          systemName: system.displayName,
          path: systemPath,
          destinationUri: pathToFileUri(systemPath),
          confidence: systemExists ? "exact" : "expected",
          reason: systemExists
            ? `Found existing ES-DE ${directoryName} folder.`
            : `Found ES-DE ROM root; ${directoryName} is the expected folder for ${system.displayName}.`
        });
        break;
      }
    }
  }

  return suggestions.sort((a, b) => suggestionScore(b) - suggestionScore(a) || a.systemName.localeCompare(b.systemName));
}

export function commonEsdeRomRoots(homeDirectory: string): string[] {
  const roots = [
    join(homeDirectory, "ES-DE", "ROMs"),
    join(homeDirectory, "ES-DE", "roms"),
    join(homeDirectory, "Emulation", "roms"),
    join(homeDirectory, "ROMs"),
    join(homeDirectory, ".emulationstation", "roms")
  ];

  if (platform() === "linux") {
    roots.push(
      "/run/media/mmcblk0p1/Emulation/roms",
      "/run/media/deck/mmcblk0p1/Emulation/roms"
    );
  }

  return [...new Set(roots)];
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    return false;
  }
}

function suggestionScore(suggestion: EsdeFolderSuggestion): number {
  return suggestion.confidence === "exact" ? 2 : 1;
}
