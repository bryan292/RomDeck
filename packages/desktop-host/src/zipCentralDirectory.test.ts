import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";
import { parseCentralDirectoryEntries, parseZipCentralDirectory } from "./zipCentralDirectory.js";

describe("parseZipCentralDirectory", () => {
  it("lists entries from a complete ZIP buffer", () => {
    const zip = zipSync({
      "Metroid Prime.iso": new Uint8Array([1, 2, 3]),
      "cover.jpg": new Uint8Array([4])
    });

    const directory = parseZipCentralDirectory(zip, zip.byteLength, 0);

    expect(directory.zip64).toBe(false);
    expect(directory.entries).toEqual([
      { name: "Metroid Prime.iso", size: 3 },
      { name: "cover.jpg", size: 1 }
    ]);
  });

  it("lists entries from central directory bytes", () => {
    const zip = zipSync({
      "Sonic Adventure.gdi": new Uint8Array([1]),
      "track01.bin": new Uint8Array([2, 3])
    });
    const directory = parseZipCentralDirectory(zip, zip.byteLength, 0);
    const centralDirectory = zip.subarray(
      directory.centralDirectoryOffset,
      directory.centralDirectoryOffset + directory.centralDirectorySize
    );

    expect(parseCentralDirectoryEntries(centralDirectory)).toEqual([
      { name: "Sonic Adventure.gdi", size: 1 },
      { name: "track01.bin", size: 2 }
    ]);
  });
});
