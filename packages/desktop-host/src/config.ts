import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix, win32 } from "node:path";
import { homedir, platform } from "node:os";
import type { AppConfig } from "@romdeck/core";

export function configFilePath(): string {
  return join(appDataDirectory(), "config.json");
}

export function downloadsFilePath(): string {
  return join(appDataDirectory(), "downloads.json");
}

export function appDataDirectory(): string {
  return defaultAppDataDirectory({
    platform: platform(),
    homeDirectory: homedir(),
    env: process.env
  });
}

export function defaultAppDataDirectory(options: {
  platform: NodeJS.Platform;
  homeDirectory: string;
  env: NodeJS.ProcessEnv;
}): string {
  if (options.env.ROMDECK_CONFIG_DIR) {
    return options.env.ROMDECK_CONFIG_DIR;
  }
  if (options.platform === "win32") {
    return win32.join(options.env.APPDATA ?? options.homeDirectory, "RomDeck");
  }
  if (options.platform === "darwin") {
    return posix.join(options.homeDirectory, "Library", "Application Support", "RomDeck");
  }
  return posix.join(options.env.XDG_CONFIG_HOME ?? posix.join(options.homeDirectory, ".config"), "romdeck");
}

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await readFile(configFilePath(), "utf8");
    return normalizeConfig(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
    return { version: 1, systems: { gba: { enabled: true } } };
  }
}

export async function saveConfig(config: AppConfig): Promise<AppConfig> {
  const normalized = normalizeConfig(config);
  const filePath = configFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  return normalized;
}

function normalizeConfig(input: unknown): AppConfig {
  const parsed = input as Partial<AppConfig>;
  return {
    version: 1,
    systems: parsed.systems ?? {}
  };
}
