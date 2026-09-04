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
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export async function detectEsdeFolderSuggestions(options: EsdeDetectionOptions = {}): Promise<EsdeFolderSuggestion[]> {
  const roots = options.candidateRoots ?? commonEsdeRomRoots({
    env: options.env ?? process.env,
    homeDirectory: options.homeDirectory ?? homedir(),
    platform: options.platform ?? platform()
  });
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

export function commonEsdeRomRoots(input: string | {
  env?: NodeJS.ProcessEnv;
  homeDirectory: string;
  platform?: NodeJS.Platform;
}): string[] {
  const homeDirectory = typeof input === "string" ? input : input.homeDirectory;
  const operatingSystem = typeof input === "string" ? platform() : input.platform ?? platform();
  const env = typeof input === "string" ? process.env : input.env ?? process.env;
  const roots = [
    join(homeDirectory, "ES-DE", "ROMs"),
    join(homeDirectory, "ES-DE", "roms"),
    join(homeDirectory, "Emulation", "roms"),
    join(homeDirectory, "ROMs"),
    join(homeDirectory, ".emulationstation", "roms")
  ];

  if (operatingSystem === "win32") {
    const documents = env.USERPROFILE ? join(env.USERPROFILE, "Documents") : join(homeDirectory, "Documents");
    const oneDriveDocuments = env.OneDrive ? join(env.OneDrive, "Documents") : undefined;
    const appData = env.APPDATA;
    const systemDrive = env.SystemDrive ?? "C:";

    roots.push(
      join(documents, "ES-DE", "ROMs"),
      join(documents, "ES-DE", "roms"),
      join(documents, "Emulation", "roms"),
      join(documents, "ROMs"),
      join(homeDirectory, "Saved Games", "ES-DE", "ROMs"),
      join(homeDirectory, "Saved Games", "ES-DE", "roms"),
      join(systemDrive, "ES-DE", "ROMs"),
      join(systemDrive, "Emulation", "roms"),
      join(systemDrive, "ROMs")
    );

    if (oneDriveDocuments) {
      roots.push(
        join(oneDriveDocuments, "ES-DE", "ROMs"),
        join(oneDriveDocuments, "ES-DE", "roms"),
        join(oneDriveDocuments, "Emulation", "roms"),
        join(oneDriveDocuments, "ROMs")
      );
    }

    if (appData) {
      roots.push(
        join(appData, "ES-DE", "ROMs"),
        join(appData, "ES-DE", "roms")
      );
    }
  }

  if (operatingSystem === "darwin") {
    roots.push(
      join(homeDirectory, "Documents", "ES-DE", "ROMs"),
      join(homeDirectory, "Documents", "ES-DE", "roms"),
      join(homeDirectory, "Documents", "Emulation", "roms"),
      join(homeDirectory, "Documents", "ROMs")
    );
  }

  if (operatingSystem === "linux") {
    const user = env.USER || env.LOGNAME;
    roots.push(
      join(homeDirectory, ".var", "app", "org.es_de.EmulationStation-DE", "data", "ES-DE", "ROMs"),
      join(homeDirectory, ".var", "app", "org.es_de.EmulationStation-DE", "data", "ES-DE", "roms"),
      "/mnt/SDCARD/Emulation/roms",
      "/run/media/mmcblk0p1/Emulation/roms",
      "/run/media/deck/mmcblk0p1/Emulation/roms"
    );
    if (user) {
      roots.push(
        `/run/media/${user}/Emulation/roms`,
        `/media/${user}/Emulation/roms`
      );
    }
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
