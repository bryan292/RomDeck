import { describe, expect, it } from "vitest";
import { resolveItemFiles } from "./resolver.js";
import { scanInstalledGames } from "./scanner.js";
import { rankSearchResult } from "./searchRanking.js";
import { SYSTEMS, isSystemKey } from "./systems.js";
import { installedState } from "./matching.js";
import { esdeDirectoryNamesForSystem } from "./esde.js";

describe("resolveItemFiles", () => {
  it("returns only direct GBA files and rejects auxiliary files", () => {
    const candidates = resolveItemFiles({
      itemId: "metroid-fusion",
      title: "Metroid Fusion",
      systemKey: "gba",
      files: [
        { name: "Metroid Fusion (USA).gba", size: 8 },
        { name: "Metroid Fusion_meta.xml" },
        { name: "Metroid Fusion_files.xml" },
        { name: "Metroid Fusion_archive.torrent" },
        { name: "cover.jpg" }
      ]
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].files).toHaveLength(1);
    expect(candidates[0].files[0].targetName).toBe("Metroid Fusion (USA).gba");
    expect(candidates[0].requiresExtraction).toBe(false);
  });

  it("groups PSX cue and bin files", () => {
    const candidates = resolveItemFiles({
      itemId: "metal-gear-solid",
      title: "Metal Gear Solid",
      systemKey: "psx",
      files: [
        { name: "Metal Gear Solid (USA).cue" },
        { name: "Metal Gear Solid (USA).bin" },
        { name: "Metal Gear Solid_meta.xml" }
      ]
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].format).toBe("CUE + BIN");
    expect(candidates[0].fileCount).toBe(2);
    expect(candidates[0].files.map((file) => file.targetName)).toEqual([
      "Metal Gear Solid (USA).cue",
      "Metal Gear Solid (USA).bin"
    ]);
  });

  it("does not return incomplete PSX cue groups", () => {
    const candidates = resolveItemFiles({
      itemId: "mixed-psx",
      title: "Mixed PSX",
      systemKey: "psx",
      files: [
        { name: "Disc 1/Game One.cue" },
        { name: "Disc 2/Game Two.bin" },
        { name: "Fallback.iso" }
      ]
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].format).toBe("ISO");
    expect(candidates[0].files[0].targetName).toBe("Fallback.iso");
  });

  it("prefers GameCube RVZ over ISO", () => {
    const candidates = resolveItemFiles({
      itemId: "metroid-prime",
      title: "Metroid Prime",
      systemKey: "gamecube",
      files: [
        { name: "Metroid Prime.iso", size: 10 },
        { name: "Metroid Prime.rvz", size: 5 }
      ]
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0].format).toBe("RVZ");
    expect(candidates[0].totalSize).toBe(5);
    expect(candidates[0].canDownload).toBe(true);
  });

  it("marks unresolved archives as not downloadable until inspected", () => {
    const candidates = resolveItemFiles({
      itemId: "metroid-prime",
      title: "Metroid Prime",
      systemKey: "gamecube",
      files: [
        { name: "Metroid Prime.zip", size: 10 }
      ]
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].requiresExtraction).toBe(true);
    expect(candidates[0].canDownload).toBe(false);
  });

  it("groups Dreamcast GDI with related track files", () => {
    const candidates = resolveItemFiles({
      itemId: "sonic-adventure",
      title: "Sonic Adventure",
      systemKey: "dreamcast",
      files: [
        { name: "Sonic Adventure/Sonic Adventure.gdi" },
        { name: "Sonic Adventure/track01.bin" },
        { name: "Sonic Adventure/track02.raw" },
        { name: "Other Game/track01.bin" }
      ]
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].format).toBe("GDI + TRACKS");
    expect(candidates[0].files.map((file) => file.sourceName)).toEqual([
      "Sonic Adventure/Sonic Adventure.gdi",
      "Sonic Adventure/track01.bin",
      "Sonic Adventure/track02.raw"
    ]);
  });

  it("returns Dreamcast RAR archives as unresolved archive candidates", () => {
    const candidates = resolveItemFiles({
      itemId: "sonic-adventure",
      title: "Sonic Adventure",
      systemKey: "dreamcast",
      files: [
        { name: "Sonic Adventure.rar", size: 10 }
      ]
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].format).toBe("Archive");
    expect(candidates[0].canDownload).toBe(false);
  });

  it("resolves Nintendo DS direct files", () => {
    const candidates = resolveItemFiles({
      itemId: "mario-kart-ds",
      title: "Mario Kart DS",
      systemKey: "nds",
      files: [
        { name: "Mario Kart DS.nds", size: 16 },
        { name: "Mario Kart DS.jpg" }
      ]
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].format).toBe("NDS");
    expect(candidates[0].canDownload).toBe(true);
  });

  it("resolves Nintendo 3DS CIA and 3DS files by preference", () => {
    const candidates = resolveItemFiles({
      itemId: "zelda-3ds",
      title: "Zelda 3DS",
      systemKey: "n3ds",
      files: [
        { name: "Zelda.3ds", size: 20 },
        { name: "Zelda.cia", size: 18 }
      ]
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0].format).toBe("3DS");
    expect(candidates[1].format).toBe("CIA");
  });

  it("prefers Wii RVZ over ISO and WBFS", () => {
    const candidates = resolveItemFiles({
      itemId: "mario-galaxy",
      title: "Super Mario Galaxy",
      systemKey: "wii",
      files: [
        { name: "Super Mario Galaxy.iso", size: 30 },
        { name: "Super Mario Galaxy.wbfs", size: 25 },
        { name: "Super Mario Galaxy.rvz", size: 20 }
      ]
    });

    expect(candidates).toHaveLength(3);
    expect(candidates[0].format).toBe("RVZ");
  });

  it("resolves Wii U WUA files", () => {
    const candidates = resolveItemFiles({
      itemId: "mario-3d-world",
      title: "Super Mario 3D World",
      systemKey: "wiiu",
      files: [
        { name: "Super Mario 3D World.wua", size: 32 }
      ]
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].format).toBe("WUA");
  });

  it("prefers Xbox XISO over ISO", () => {
    const candidates = resolveItemFiles({
      itemId: "halo",
      title: "Halo",
      systemKey: "xbox",
      files: [
        { name: "Halo.iso", size: 50 },
        { name: "Halo.xiso", size: 48 }
      ]
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0].format).toBe("XISO");
  });

  it("resolves Xbox 360 ISO files", () => {
    const candidates = resolveItemFiles({
      itemId: "halo-3",
      title: "Halo 3",
      systemKey: "xbox360",
      files: [
        { name: "Halo 3.iso", size: 60 }
      ]
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].format).toBe("ISO");
  });
});

describe("SYSTEMS", () => {
  it("includes PlayStation Vita and GameCube", () => {
    expect(SYSTEMS.psvita.extensions).toContain(".vpk");
    expect(SYSTEMS.gamecube.preferredExtensions).toEqual([".rvz", ".iso", ".gcm", ".ciso", ".wbfs"]);
  });

  it("includes DS, 3DS, Wii, Wii U, Xbox, and Xbox 360", () => {
    expect(SYSTEMS.nds.extensions).toContain(".nds");
    expect(SYSTEMS.n3ds.extensions).toContain(".cia");
    expect(SYSTEMS.wii.preferredExtensions[0]).toBe(".rvz");
    expect(SYSTEMS.wiiu.extensions).toContain(".wua");
    expect(SYSTEMS.xbox.preferredExtensions[0]).toBe(".xiso");
    expect(SYSTEMS.xbox360.extensions).toContain(".iso");
  });

  it("exposes ES-DE directory aliases", () => {
    expect(esdeDirectoryNamesForSystem("gamecube")).toEqual(["gc", "gamecube"]);
    expect(esdeDirectoryNamesForSystem("psvita")).toEqual(["psvita"]);
  });

  it("validates supported system keys at runtime", () => {
    expect(isSystemKey("gba")).toBe(true);
    expect(isSystemKey("gamecube")).toBe(true);
    expect(isSystemKey("nds")).toBe(true);
    expect(isSystemKey("n3ds")).toBe(true);
    expect(isSystemKey("wii")).toBe(true);
    expect(isSystemKey("wiiu")).toBe(true);
    expect(isSystemKey("xbox")).toBe(true);
    expect(isSystemKey("xbox360")).toBe(true);
    expect(isSystemKey("switch")).toBe(false);
    expect(isSystemKey(undefined)).toBe(false);
  });
});

describe("rankSearchResult", () => {
  it("penalizes cross-system GBA noise", () => {
    const gbaScore = rankSearchResult({
      query: "Metroid Fusion",
      systemKey: "gba",
      title: "Metroid Fusion (USA)",
      identifier: "metroid-fusion-usa",
      metadataText: "Game Boy Advance GBA ROM"
    });
    const gameCubeScore = rankSearchResult({
      query: "Metroid Fusion",
      systemKey: "gba",
      title: "Metroid Prime (Game Cube)",
      identifier: "metroid-prime-game-cube",
      metadataText: "GameCube ISO"
    });

    expect(gbaScore).toBeGreaterThan(gameCubeScore);
    expect(gameCubeScore).toBeLessThan(0.35);
  });

  it("does not rank metadata-only matches as good game results", () => {
    const score = rankSearchResult({
      query: "Metroid Fusion",
      systemKey: "gba",
      title: "Ares Multi System emulator for Windows",
      identifier: "aresemuwinbuilds",
      metadataText: "supports Game Boy Advance and Metroid games"
    });

    expect(score).toBeLessThan(0.35);
  });

  it("penalizes debug variants unless requested", () => {
    const releaseScore = rankSearchResult({
      query: "Metroid Fusion",
      systemKey: "gba",
      title: "Metroid Fusion (USA)",
      identifier: "metroid-fusion-usa",
      metadataText: "Game Boy Advance GBA ROM"
    });
    const debugScore = rankSearchResult({
      query: "Metroid Fusion",
      systemKey: "gba",
      title: "Metroid Fusion Debug Sep 11 2002",
      identifier: "metroid-fusion-debug",
      metadataText: "Game Boy Advance GBA ROM debug"
    });

    expect(releaseScore).toBeGreaterThan(debugScore);
  });

  it("ranks GameCube terms positively for GameCube searches", () => {
    const score = rankSearchResult({
      query: "Metroid Prime",
      systemKey: "gamecube",
      title: "Metroid Prime (GameCube)",
      identifier: "metroid-prime-gamecube",
      metadataText: "Nintendo GameCube RVZ ISO"
    });

    expect(score).toBeGreaterThan(0.75);
  });

  it("penalizes non-game software matches", () => {
    const score = rankSearchResult({
      query: "Metroid Prime",
      systemKey: "gamecube",
      title: "Metroid Prime 2 Echoes Desktop Animated Samus Program",
      identifier: "metroid-prime-desktop-program",
      metadataText: "GameCube desktop animation"
    });

    expect(score).toBeLessThan(0.75);
  });

  it("penalizes patches and PC builds unless requested", () => {
    const score = rankSearchResult({
      query: "Sonic Adventure",
      systemKey: "dreamcast",
      title: "Brazilian Portuguese translation for Sonic Adventure DX for PC builds",
      identifier: "sonicadventuredxpcptbr",
      metadataText: "Dreamcast translation patch"
    });

    expect(score).toBeLessThan(0.75);
  });

  it("ranks Nintendo DS above 3DS noise for DS searches", () => {
    const dsScore = rankSearchResult({
      query: "Mario Kart DS",
      systemKey: "nds",
      title: "Mario Kart DS",
      identifier: "mario-kart-ds",
      metadataText: "Nintendo DS NDS ROM"
    });
    const threeDsScore = rankSearchResult({
      query: "Mario Kart DS",
      systemKey: "nds",
      title: "Mario Kart 7 Nintendo 3DS",
      identifier: "mario-kart-7-3ds",
      metadataText: "Nintendo 3DS"
    });

    expect(dsScore).toBeGreaterThan(threeDsScore);
  });

  it("penalizes Xbox 360 results for original Xbox searches", () => {
    const xboxScore = rankSearchResult({
      query: "Halo",
      systemKey: "xbox",
      title: "Halo Combat Evolved",
      identifier: "halo-original-xbox",
      metadataText: "Original Xbox XISO"
    });
    const xbox360Score = rankSearchResult({
      query: "Halo",
      systemKey: "xbox",
      title: "Halo 3 Xbox 360",
      identifier: "halo-3-xbox-360",
      metadataText: "Xbox 360 ISO"
    });

    expect(xboxScore).toBeGreaterThan(xbox360Score);
  });
});

describe("scanInstalledGames", () => {
  it("detects installed GBA files recursively and ignores images", () => {
    const installed = scanInstalledGames("gba", [
      { name: "Metroid Fusion (USA).gba", relativePath: "Action/Metroid Fusion (USA).gba" },
      { name: "Metroid Fusion (USA).jpg" }
    ]);

    expect(installed).toHaveLength(1);
    expect(installed[0].title).toBe("Metroid Fusion (USA)");
    expect(installed[0].region).toBe("USA");
  });

  it("returns possible instead of installed when regions conflict", () => {
    const installed = scanInstalledGames("gba", [
      { name: "Metroid Fusion (Europe).gba" }
    ]);

    expect(installedState({
      source: "internet-archive",
      itemId: "metroid-fusion-usa",
      title: "Metroid Fusion (USA)",
      systemKey: "gba",
      confidence: 0.9
    }, installed)).toBe("possible");
  });

  it("does not mark Dreamcast track files alone as installed games", () => {
    const installed = scanInstalledGames("dreamcast", [
      { name: "track01.bin" },
      { name: "Sonic Adventure.gdi" }
    ]);

    expect(installed).toHaveLength(1);
    expect(installed[0].title).toBe("Sonic Adventure");
  });
});
