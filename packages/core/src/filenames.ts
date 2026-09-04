import { REJECTED_EXTENSIONS, REJECTED_SUFFIXES, SYSTEMS } from "./systems.js";
import type { SystemKey } from "./types.js";

export function extensionOf(name: string): string {
  const last = name.split("/").pop() ?? name;
  const index = last.lastIndexOf(".");
  return index >= 0 ? last.slice(index).toLowerCase() : "";
}

export function isAuxiliaryFile(name: string): boolean {
  const lower = name.toLowerCase();
  return REJECTED_SUFFIXES.some((suffix) => lower.endsWith(suffix)) || REJECTED_EXTENSIONS.has(extensionOf(name));
}

export function isDirectSystemFile(systemKey: SystemKey, name: string): boolean {
  if (isAuxiliaryFile(name)) {
    return false;
  }
  return SYSTEMS[systemKey].extensions.includes(extensionOf(name));
}

export function isPrimarySystemFile(systemKey: SystemKey, name: string): boolean {
  if (isAuxiliaryFile(name)) {
    return false;
  }
  return SYSTEMS[systemKey].preferredExtensions.includes(extensionOf(name));
}

export function isArchiveForSystem(systemKey: SystemKey, name: string): boolean {
  if (isAuxiliaryFile(name)) {
    return false;
  }
  return SYSTEMS[systemKey].archiveExtensions.includes(extensionOf(name));
}

export function normalizeTitle(input: string): string {
  return input
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_\.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function comparableTitle(input: string): string {
  return normalizeTitle(input)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(pokemon)\b/g, "pokemon")
    .replace(/\((usa|europe|japan|world|rev\s*\d+|en|fr|de|es|it|australia)\)/gi, "")
    .replace(/\b(usa|europe|japan|world|rev\s*\d+|australia)\b/gi, "")
    .replace(/\b(version|rom|gba|gameboy advance|game boy advance)\b/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function regionFromName(name: string): string | undefined {
  const lower = name.toLowerCase();
  const regions = [
    ["USA", /\busa\b|\(u\)|\(usa/i],
    ["Europe", /\beurope\b|\(e\)|\(eur/i],
    ["Japan", /\bjapan\b|\(j\)|\(jp/i],
    ["World", /\bworld\b/i],
    ["Australia", /\baustralia\b/i]
  ] as const;
  const match = regions.find(([, pattern]) => pattern.test(lower));
  return match?.[0];
}

export function versionFromName(name: string): string | undefined {
  const match = name.match(/\((Rev\s*\d+|v\d+(?:\.\d+)*)\)/i);
  return match ? match[1].replace(/\s+/g, " ") : undefined;
}

export function safeTargetName(name: string): string {
  const basename = name.split(/[\\/]/).pop() ?? name;
  return basename.replace(/[<>:"|?*\x00-\x1F]/g, "_").trim();
}

export function makeCandidateId(parts: string[]): string {
  return parts.join("|").toLowerCase().replace(/[^a-z0-9|._-]+/g, "-");
}
