import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commonEsdeRomRoots, detectEsdeFolderSuggestions } from "./esde.js";

describe("ES-DE folder detection", () => {
  it("builds common ROM roots from a home directory", () => {
    const roots = commonEsdeRomRoots("/home/tester");

    expect(roots).toContain("/home/tester/ES-DE/ROMs");
    expect(roots).toContain("/home/tester/Emulation/roms");
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
});
