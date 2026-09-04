import { comparableTitle } from "./filenames.js";
import type { SearchResult, SystemKey } from "./types.js";

const POSITIVE_TERMS: Record<SystemKey, string[]> = {
  gba: ["game boy advance", "gba"],
  gb: ["game boy", " dmg "],
  gbc: ["game boy color", "gbc"],
  nes: ["nes", "nintendo entertainment system"],
  snes: ["snes", "super nintendo"],
  n64: ["nintendo 64", "n64"],
  nds: ["nintendo ds", "nds"],
  n3ds: ["nintendo 3ds", "3ds"],
  wii: ["nintendo wii", " wii "],
  wiiu: ["wii u", "wiiu", "nintendo wii u"],
  psx: ["playstation", "psx", "ps1"],
  ps2: ["playstation 2", "ps2"],
  psp: ["playstation portable", "psp"],
  psvita: ["playstation vita", "ps vita", "psvita", "vita"],
  gamecube: ["gamecube", "game cube", "gcn"],
  dreamcast: ["dreamcast"],
  xbox: ["original xbox", " xbox "],
  xbox360: ["xbox 360", "xbox360"]
};

const NEGATIVE_TERMS: Partial<Record<SystemKey, string[]>> = {
  gba: ["gamecube", "game cube", "wii", "nintendo ds", "nds", "3ds", "switch", "playstation", "ps2", "psp"],
  gb: ["game boy advance", "gba", "gamecube", "game cube", "nintendo ds", "nds", "3ds"],
  gbc: ["game boy advance", "gba", "gamecube", "game cube", "nintendo ds", "nds", "3ds"],
  nds: ["nintendo 3ds", "3ds", "wii", "switch"],
  n3ds: ["nintendo ds", "nds", "wii", "switch"],
  wii: ["wii u", "wiiu", "gamecube", "game cube", "switch"],
  wiiu: [" wii ", "gamecube", "game cube", "switch"],
  psx: ["playstation 2", "ps2", "psp", "playstation portable", "playstation 3", "ps3", "playstation vita", "ps vita"],
  ps2: ["playstation portable", "psp", "playstation vita", "ps vita", "playstation 3", "ps3"],
  psp: ["playstation vita", "ps vita", "playstation 2", "ps2", "playstation 3", "ps3"],
  psvita: ["playstation portable", "psp", "playstation 2", "ps2", "playstation 3", "ps3"],
  gamecube: ["game boy", "game boy advance", "gba", "nintendo ds", "nds", "wii", "wii u", "switch"],
  xbox: ["xbox 360", "xbox360", "windows"],
  xbox360: ["original xbox", "windows"]
};

const VARIANT_TERMS = ["debug", "prototype", "beta", "alpha", "sample", "demo", "hack", "special edition", "translation", "patch"];
const NON_GAME_TERMS = ["emulator", "animated", "desktop", "browser", "screensaver", "wallpaper", "manual", "soundtrack", "program", "pc build", "for pc", "windows"];

export function rankSearchResult(params: {
  query: string;
  systemKey: SystemKey;
  title: string;
  identifier: string;
  metadataText?: string;
}): number {
  const query = comparableTitle(params.query);
  const title = comparableTitle(params.title);
  const identifier = comparableTitle(params.identifier);
  const haystack = ` ${params.title} ${params.identifier} ${params.metadataText ?? ""} `.toLowerCase().replace(/[_-]+/g, " ");
  const titleAndId = `${title} ${identifier}`;
  const tokens = query.split(" ").filter(Boolean);

  let score = 0.15;

  if (title === query) {
    score += 0.45;
  } else if (title.includes(query)) {
    score += 0.3;
  }

  const matchedTitleTokens = tokens.filter((token) => titleAndId.includes(token)).length;
  if (tokens.length > 0 && matchedTitleTokens === 0) {
    return 0.2;
  }

  const matchedTokens = tokens.filter((token) => titleAndId.includes(token) || haystack.includes(token)).length;
  score += tokens.length > 0 ? (matchedTokens / tokens.length) * 0.25 : 0;
  score += tokens.length > 0 ? (matchedTitleTokens / tokens.length) * 0.12 : 0;

  if (POSITIVE_TERMS[params.systemKey].some((term) => haystack.includes(term))) {
    score += 0.22;
  }

  const negatives = NEGATIVE_TERMS[params.systemKey] ?? [];
  for (const term of negatives) {
    if (haystack.includes(term)) {
      score -= 0.35;
    }
  }

  for (const term of VARIANT_TERMS) {
    if (haystack.includes(term) && !query.includes(term)) {
      score -= 0.18;
    }
  }

  for (const term of NON_GAME_TERMS) {
    if (haystack.includes(term) && !query.includes(term)) {
      score -= 0.24;
    }
  }

  if (haystack.includes("rom") || haystack.includes("roms")) {
    score += 0.05;
  }

  return Math.max(0, Math.min(0.98, Number(score.toFixed(3))));
}

export function sortAndFilterSearchResults(results: SearchResult[]): SearchResult[] {
  return [...results]
    .filter((result) => result.confidence >= 0.35)
    .sort((a, b) => b.confidence - a.confidence || a.title.localeCompare(b.title));
}
