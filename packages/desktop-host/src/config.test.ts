import { describe, expect, it } from "vitest";
import { defaultAppDataDirectory } from "./config.js";

describe("desktop config paths", () => {
  it("prefers ROMDECK_CONFIG_DIR for tests and portable overrides", () => {
    expect(defaultAppDataDirectory({
      platform: "linux",
      homeDirectory: "/home/bryan",
      env: { ROMDECK_CONFIG_DIR: "/tmp/romdeck-config" }
    })).toBe("/tmp/romdeck-config");
  });

  it("uses XDG_CONFIG_HOME on Linux when available", () => {
    expect(defaultAppDataDirectory({
      platform: "linux",
      homeDirectory: "/home/bryan",
      env: { XDG_CONFIG_HOME: "/home/bryan/.config-custom" }
    })).toBe("/home/bryan/.config-custom/romdeck");
  });

  it("falls back to ~/.config/romdeck on Linux", () => {
    expect(defaultAppDataDirectory({
      platform: "linux",
      homeDirectory: "/home/bryan",
      env: {}
    })).toBe("/home/bryan/.config/romdeck");
  });

  it("uses the macOS application support directory", () => {
    expect(defaultAppDataDirectory({
      platform: "darwin",
      homeDirectory: "/Users/bryan",
      env: {}
    })).toBe("/Users/bryan/Library/Application Support/RomDeck");
  });

  it("uses APPDATA on Windows when available", () => {
    expect(defaultAppDataDirectory({
      platform: "win32",
      homeDirectory: "C:\\Users\\Bryan",
      env: { APPDATA: "C:\\Users\\Bryan\\AppData\\Roaming" }
    })).toBe("C:\\Users\\Bryan\\AppData\\Roaming\\RomDeck");
  });
});
