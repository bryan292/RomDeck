import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commonEsdeRomRoots, detectEsdeFolderSuggestions } from "./esde.js";

describe("ES-DE folder detection", () => {
  it("builds common ROM roots from a home directory", () => {
    const roots = commonEsdeRomRoots("/home/tester");

    expect(roots).toContain(join("/home/tester", "ES-DE", "ROMs"));
    expect(roots).toContain(join("/home/tester", "Emulation", "roms"));
  });

  it("builds common Windows ROM roots", () => {
    const roots = commonEsdeRomRoots({
      homeDirectory: "C:\\Users\\Bryan",
      platform: "win32",
      env: {
        APPDATA: "C:\\Users\\Bryan\\AppData\\Roaming",
        OneDrive: "C:\\Users\\Bryan\\OneDrive",
        SystemDrive: "C:"
      }
    });

    expect(roots).toContain(join("C:\\Users\\Bryan", "Documents", "ES-DE", "ROMs"));
    expect(roots).toContain(join("C:\\Users\\Bryan", "Saved Games", "ES-DE", "ROMs"));
    expect(roots).toContain(join("C:\\Users\\Bryan\\OneDrive", "Documents", "ROMs"));
    expect(roots).toContain(join("C:", "Emulation", "roms"));
  });

  it("builds common macOS ROM roots from Documents and home folders", () => {
    const roots = commonEsdeRomRoots({
      homeDirectory: "/Users/bryan",
      platform: "darwin",
      env: {}
    });

    expect(roots).toContain(join("/Users/bryan", "ES-DE", "ROMs"));
    expect(roots).toContain(join("/Users/bryan", "Documents", "ES-DE", "ROMs"));
    expect(roots).toContain(join("/Users/bryan", "Documents", "Emulation", "roms"));
  });

  it("builds common Linux ROM roots for Flatpak and removable media", () => {
    const roots = commonEsdeRomRoots({
      homeDirectory: "/home/deck",
      platform: "linux",
      env: { USER: "deck" }
    });

    expect(roots).toContain(join("/home/deck", ".var", "app", "org.es_de.EmulationStation-DE", "data", "ES-DE", "ROMs"));
    expect(roots).toContain("/run/media/deck/Emulation/roms");
    expect(roots).toContain("/media/deck/Emulation/roms");
    expect(roots).toContain("/mnt/SDCARD/Emulation/roms");
  });

  it("suggests exact system folders when they exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "romdeck-esde-root-"));
    await mkdir(join(root, "gba"), { recursive: true });

    const suggestions = await detectEsdeFolderSuggestions({ candidateRoots: [root] });

    expect(suggestions).toContainEqual(expect.objectContaining({
      systemKey: "gba",
      path: join(root, "gba"),
      confidence: "exact"
    }));
  });

  it("suggests expected system folders when only the ROM root exists", async () => {
    const root = await mkdtemp(join(tmpdir(), "romdeck-esde-root-"));

    const suggestions = await detectEsdeFolderSuggestions({ candidateRoots: [root] });

    expect(suggestions).toContainEqual(expect.objectContaining({
      systemKey: "psvita",
      path: join(root, "psvita"),
      confidence: "expected"
    }));
  });

  it("prefers the ES-DE gc alias for GameCube", async () => {
    const root = await mkdtemp(join(tmpdir(), "romdeck-esde-root-"));
    await mkdir(join(root, "gc"), { recursive: true });

    const suggestions = await detectEsdeFolderSuggestions({ candidateRoots: [root] });

    expect(suggestions).toContainEqual(expect.objectContaining({
      systemKey: "gamecube",
      path: join(root, "gc"),
      confidence: "exact"
    }));
  });

  it("detects exact system folders from macOS-style ES-DE roots", async () => {
    const home = await mkdtemp(join(tmpdir(), "romdeck-esde-macos-"));
    const root = join(home, "Documents", "ES-DE", "ROMs");
    await mkdir(join(root, "nds"), { recursive: true });

    const suggestions = await detectEsdeFolderSuggestions({
      homeDirectory: home,
      platform: "darwin",
      env: {}
    });

    expect(suggestions).toContainEqual(expect.objectContaining({
      systemKey: "nds",
      path: join(root, "nds"),
      confidence: "exact"
    }));
  });

  it("detects expected system folders from Linux-style ROM roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "romdeck-esde-linux-"));
    const suggestions = await detectEsdeFolderSuggestions({
      homeDirectory: "/home/deck",
      candidateRoots: [root],
      platform: "linux",
      env: { USER: "deck" }
    });

    expect(suggestions).toContainEqual(expect.objectContaining({
      systemKey: "wiiu",
      path: join(root, "wiiu"),
      confidence: "expected"
    }));
  });
});
