import type { SystemDefinition, SystemKey } from "./types.js";

export const SYSTEMS: Record<SystemKey, SystemDefinition> = {
  gba: {
    key: "gba",
    displayName: "Game Boy Advance",
    extensions: [".gba"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".gba"],
    esdeDirectoryNames: ["gba"]
  },
  gb: {
    key: "gb",
    displayName: "Game Boy",
    extensions: [".gb"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".gb"],
    esdeDirectoryNames: ["gb"]
  },
  gbc: {
    key: "gbc",
    displayName: "Game Boy Color",
    extensions: [".gbc"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".gbc"],
    esdeDirectoryNames: ["gbc"]
  },
  nes: {
    key: "nes",
    displayName: "Nintendo Entertainment System",
    extensions: [".nes"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".nes"],
    esdeDirectoryNames: ["nes"]
  },
  snes: {
    key: "snes",
    displayName: "Super Nintendo",
    extensions: [".sfc", ".smc"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".sfc", ".smc"],
    esdeDirectoryNames: ["snes"]
  },
  n64: {
    key: "n64",
    displayName: "Nintendo 64",
    extensions: [".z64", ".n64", ".v64"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".z64", ".n64", ".v64"],
    esdeDirectoryNames: ["n64"]
  },
  nds: {
    key: "nds",
    displayName: "Nintendo DS",
    extensions: [".nds"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".nds"],
    esdeDirectoryNames: ["nds"]
  },
  n3ds: {
    key: "n3ds",
    displayName: "Nintendo 3DS",
    extensions: [".3ds", ".cia", ".cci", ".cxi"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".3ds", ".cia", ".cci", ".cxi"],
    esdeDirectoryNames: ["n3ds", "3ds"]
  },
  wii: {
    key: "wii",
    displayName: "Wii",
    extensions: [".rvz", ".iso", ".wbfs", ".ciso", ".wad"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".rvz", ".iso", ".wbfs", ".ciso", ".wad"],
    esdeDirectoryNames: ["wii"]
  },
  wiiu: {
    key: "wiiu",
    displayName: "Wii U",
    extensions: [".wua", ".wux", ".wud", ".rpx"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".wua", ".wux", ".wud", ".rpx"],
    esdeDirectoryNames: ["wiiu", "wiiuapps"]
  },
  psx: {
    key: "psx",
    displayName: "PlayStation",
    extensions: [".chd", ".cue", ".bin", ".iso"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".chd", ".cue", ".iso"],
    esdeDirectoryNames: ["psx"]
  },
  ps2: {
    key: "ps2",
    displayName: "PlayStation 2",
    extensions: [".chd", ".iso", ".gz"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".chd", ".iso", ".gz"],
    esdeDirectoryNames: ["ps2"]
  },
  psp: {
    key: "psp",
    displayName: "PlayStation Portable",
    extensions: [".iso", ".cso", ".chd"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".iso", ".cso", ".chd"],
    esdeDirectoryNames: ["psp"]
  },
  psvita: {
    key: "psvita",
    displayName: "PlayStation Vita",
    extensions: [".vpk"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".vpk"],
    esdeDirectoryNames: ["psvita"]
  },
  gamecube: {
    key: "gamecube",
    displayName: "GameCube",
    extensions: [".rvz", ".iso", ".gcm", ".ciso", ".wbfs"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".rvz", ".iso", ".gcm", ".ciso", ".wbfs"],
    esdeDirectoryNames: ["gc", "gamecube"]
  },
  dreamcast: {
    key: "dreamcast",
    displayName: "Dreamcast",
    extensions: [".chd", ".gdi", ".cdi", ".bin", ".raw"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".chd", ".gdi", ".cdi"],
    esdeDirectoryNames: ["dreamcast"]
  },
  xbox: {
    key: "xbox",
    displayName: "Xbox",
    extensions: [".iso", ".xiso"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".xiso", ".iso"],
    esdeDirectoryNames: ["xbox"]
  },
  xbox360: {
    key: "xbox360",
    displayName: "Xbox 360",
    extensions: [".iso"],
    archiveExtensions: [".zip", ".7z", ".rar"],
    preferredExtensions: [".iso"],
    esdeDirectoryNames: ["xbox360"]
  }
};

export const SYSTEM_LIST = Object.values(SYSTEMS);

export function isSystemKey(value: unknown): value is SystemKey {
  return typeof value === "string" && value in SYSTEMS;
}

export const REJECTED_EXTENSIONS = new Set([
  ".xml",
  ".sqlite",
  ".torrent",
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".txt",
  ".nfo",
  ".sfv",
  ".md5"
]);

export const REJECTED_SUFFIXES = ["_meta.xml", "_files.xml", "_reviews.xml"];
