import { expect, test, type Route } from "@playwright/test";

test("configure, search, resolve, and show installed library state", async ({ page }) => {
  await mockRomDeckApi(page);

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "RomDeck" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Systems" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Game Boy Advance/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Installed" })).toBeVisible();
  await expect(page.getByText("1 dup")).toBeVisible();
  await expect(page.getByText("Duplicate").first()).toBeVisible();

  await page.locator(".search-row input").fill("Metroid Fusion");
  await page.locator(".search-row input").press("Enter");

  await expect(page.getByRole("button", { name: /Metroid Fusion/i })).toBeVisible();
  await page.getByRole("button", { name: /Metroid Fusion/i }).click();

  await expect(page.getByRole("heading", { name: "Metroid Fusion" })).toBeVisible();
  await expect(page.getByText("Metroid Fusion (USA).gba")).toBeVisible();
  await expect(page.getByRole("button", { name: "Download" })).toBeEnabled();
});

async function mockRomDeckApi(page: { route: typeof import("@playwright/test").Page.prototype.route }) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/systems") {
      await fulfillJson(route, {
        systems: [
          {
            key: "gba",
            displayName: "Game Boy Advance",
            extensions: [".gba"],
            archiveExtensions: [".zip", ".7z", ".rar"],
            preferredExtensions: [".gba"],
            esdeDirectoryNames: ["gba"]
          },
          {
            key: "n64",
            displayName: "Nintendo 64",
            extensions: [".z64", ".n64", ".v64"],
            archiveExtensions: [".zip", ".7z", ".rar"],
            preferredExtensions: [".z64", ".n64", ".v64"],
            esdeDirectoryNames: ["n64"]
          }
        ]
      });
      return;
    }

    if (path === "/api/config") {
      await fulfillJson(route, {
        config: {
          version: 1,
          systems: {
            gba: {
              enabled: true,
              destinationUri: "file:///Users/test/ES-DE/ROMs/gba"
            }
          }
        }
      });
      return;
    }

    if (path === "/api/library") {
      await fulfillJson(route, {
        installed: [
          installedGame("Metroid Fusion (USA)", "Metroid Fusion (USA).gba"),
          installedGame("Metroid Fusion (Europe)", "Metroid Fusion (Europe).gba")
        ]
      });
      return;
    }

    if (path === "/api/downloads") {
      await fulfillJson(route, { jobs: [] });
      return;
    }

    if (path === "/api/diagnostics") {
      await fulfillJson(route, {
        diagnostics: {
          host: "desktop-node",
          platform: "darwin",
          arch: "arm64",
          node: "v24.0.0",
          appDataDirectory: "/Users/test/Library/Application Support/RomDeck",
          logFile: "/tmp/RomDeck/romdeck-host.log",
          sessionProtected: true
        }
      });
      return;
    }

    if (path === "/api/file-path") {
      await fulfillJson(route, { path: "/Users/test/ES-DE/ROMs/gba" });
      return;
    }

    if (path === "/api/search") {
      await fulfillJson(route, {
        results: [
          {
            source: "internet-archive",
            itemId: "metroid-fusion",
            title: "Metroid Fusion",
            systemKey: "gba",
            year: 2002,
            confidence: 0.97,
            installed: true,
            installedState: "installed"
          }
        ]
      });
      return;
    }

    if (path === "/api/items/metroid-fusion/resolve") {
      await fulfillJson(route, {
        candidates: [
          {
            id: "metroid-fusion|gba|metroid-fusion-usa.gba",
            source: "internet-archive",
            itemId: "metroid-fusion",
            title: "Metroid Fusion",
            systemKey: "gba",
            format: "GBA",
            files: [
              {
                sourceUrl: "https://archive.org/download/metroid-fusion/Metroid%20Fusion%20%28USA%29.gba",
                sourceName: "Metroid Fusion (USA).gba",
                targetName: "Metroid Fusion (USA).gba",
                size: 8388608,
                sha1: "7037807198c22a7d2b0807371d763779a84fdfcf"
              }
            ],
            fileCount: 1,
            totalSize: 8388608,
            requiresExtraction: false,
            canDownload: true,
            warnings: [],
            confidence: 0.95,
            reason: "Selected direct .gba file"
          }
        ]
      });
      return;
    }

    await fulfillJson(route, { error: `Unhandled test API route: ${path}` }, 404);
  });
}

function installedGame(title: string, fileName: string) {
  return {
    systemKey: "gba",
    title,
    normalizedTitle: title.toLowerCase(),
    comparableTitle: "metroid fusion",
    region: title.includes("Europe") ? "Europe" : "USA",
    files: [
      {
        name: fileName,
        relativePath: fileName,
        size: 8388608,
        modifiedAt: "2026-09-04T00:00:00.000Z"
      }
    ]
  };
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body)
  });
}
