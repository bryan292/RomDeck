import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  fileUriToPath,
  listDirectoryFiles,
  pathToFileUri,
  resolveInsideDestination,
  validateWritableDirectory
} from "./files.js";

describe("file adapter", () => {
  it("round-trips paths through file URIs", async () => {
    const directory = await makeTempDir("romdeck files uri");
    const uri = pathToFileUri(directory);

    expect(uri).toMatch(/^file:\/\//);
    expect(fileUriToPath(uri)).toBe(directory);
  });

  it("recursively lists files while skipping media and metadata directories", async () => {
    const directory = await makeTempDir("romdeck-scan-");
    await mkdir(join(directory, "nested"), { recursive: true });
    await mkdir(join(directory, "media"), { recursive: true });
    await mkdir(join(directory, "gamelists"), { recursive: true });
    await writeFile(join(directory, "nested", "Metroid Fusion.gba"), Buffer.from([1]));
    await writeFile(join(directory, "media", "cover.jpg"), Buffer.from([2]));
    await writeFile(join(directory, "gamelists", "gamelist.xml"), Buffer.from([3]));

    const files = await listDirectoryFiles(pathToFileUri(directory));

    expect(files.map((file) => file.relativePath)).toEqual(["nested/Metroid Fusion.gba"]);
  });

  it("validates writable directories and rejects regular files", async () => {
    const directory = await makeTempDir("romdeck-validate-");
    const filePath = join(directory, "not-a-directory.txt");
    await writeFile(filePath, "");

    await expect(validateWritableDirectory(pathToFileUri(directory))).resolves.toBeUndefined();
    await expect(validateWritableDirectory(pathToFileUri(filePath))).rejects.toThrow("Destination is not a directory.");
  });

  it("keeps resolved download targets inside the destination", async () => {
    const directory = await makeTempDir("romdeck-target-");

    expect(resolveInsideDestination(pathToFileUri(directory), "../Escape.gba")).toBe(join(directory, "Escape.gba"));
    await expect(stat(resolveInsideDestination(pathToFileUri(directory), "Escape.gba"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });
});

async function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}
