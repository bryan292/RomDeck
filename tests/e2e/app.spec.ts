import { expect, test, type Page, type Route } from "@playwright/test";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

test("configure, search, resolve, and show installed library state", async ({ page }) => {
  await mockRomDeckApi(page);

  await openResolvedCandidate(page);

  await expect(page.getByRole("heading", { name: "Metroid Fusion" })).toBeVisible();
  await expect(page.getByText("Extracts: Metroid Fusion (USA).gba")).toBeVisible();
  await expect(page.getByText(/Already installed: Metroid Fusion/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Download + Extract" })).toBeEnabled();
});

test("minimum desktop viewport keeps candidate and installed panels readable", async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 640 });
  await mockRomDeckApi(page);
  await openResolvedCandidate(page);

  await page.getByRole("button", { name: "All", exact: true }).click();

  const viewport = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  expect(viewport.scrollWidth).toBeLessThanOrEqual(viewport.clientWidth + 1);

  const candidateDetails = await page.locator(".candidate > div").first().boundingBox();
  const candidateActions = await page.locator(".candidate-actions").first().boundingBox();
  const candidateReady = await page.locator(".candidate-title-row .status-badge").first().boundingBox();
  const resultButton = await page.getByRole("button", { name: /Metroid Fusion metroid-fusion/i }).boundingBox();
  const resultBadge = await page.locator(".result-list .status-badge").first().boundingBox();
  expect(candidateDetails).not.toBeNull();
  expect(candidateActions).not.toBeNull();
  expect(candidateReady).not.toBeNull();
  expect(resultButton).not.toBeNull();
  expect(resultBadge).not.toBeNull();
  expect(rectanglesOverlap(candidateDetails!, candidateActions!)).toBe(false);
  expect(rectanglesOverlap(candidateReady!, candidateActions!)).toBe(false);
  expect(isContainedBy(resultBadge!, resultButton!)).toBe(true);

  const listBox = await page.locator(".compact-list").boundingBox();
  const firstRowBox = await page.locator(".installed-row").first().boundingBox();
  expect(listBox).not.toBeNull();
  expect(firstRowBox).not.toBeNull();
  expect(firstRowBox!.y - listBox!.y).toBeLessThan(18);
});

test("saving a destination for another system keeps existing system destinations", async ({ page }) => {
  await mockRomDeckApi(page);
  await page.goto("/");

  await page.getByRole("button", { name: /Nintendo 64/i }).click();
  await page.locator(".folder-form input").fill("/Users/test/ES-DE/ROMs/n64");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Nintendo 64 folder saved.")).toBeVisible();
  await expect(page.locator(".system-list .status-badge", { hasText: "Ready" })).toHaveCount(2);
});

async function openResolvedCandidate(page: Page) {
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
}

function rectanglesOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;
}

function isContainedBy(inner: Rect, outer: Rect): boolean {
  return inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width + 1 &&
    inner.y + inner.height <= outer.y + outer.height + 1;
}

async function mockRomDeckApi(page: Page) {
  const config = {
    version: 1,
    systems: {
      gba: {
        enabled: true,
        destinationUri: "file:///Users/test/ES-DE/ROMs/gba"
      }
    } as Record<string, { enabled: boolean; destinationUri: string }>
  };

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
      await fulfillJson(route, { config });
      return;
    }

    const systemConfigMatch = path.match(/^\/api\/config\/systems\/([^/]+)$/);
    if (systemConfigMatch) {
      const body = request.postDataJSON() as { enabled?: boolean; destinationUri: string };
      config.systems[decodeURIComponent(systemConfigMatch[1])] = {
        enabled: body.enabled ?? true,
        destinationUri: body.destinationUri
      };
      await fulfillJson(route, { config });
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
      const body = request.postDataJSON() as { destinationUri: string };
      await fulfillJson(route, { path: body.destinationUri.replace("file://", "") });
      return;
    }

    if (path === "/api/path-uri") {
      const body = request.postDataJSON() as { path: string };
      await fulfillJson(route, { destinationUri: `file://${body.path}` });
      return;
    }

    if (path === "/api/folders/validate") {
      const body = request.postDataJSON() as { destinationUri?: string; path?: string };
      await fulfillJson(route, { ok: true, destinationUri: body.destinationUri ?? `file://${body.path}` });
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
            format: "Archive",
            files: [
              {
                sourceUrl: "https://archive.org/download/metroid-fusion/Metroid%20Fusion.zip",
                sourceName: "Metroid Fusion.zip",
                targetName: "Metroid Fusion.zip",
                size: 8388608,
                sha1: "7037807198c22a7d2b0807371d763779a84fdfcf"
              }
            ],
            extractedFiles: [
              {
                name: "Metroid Fusion (USA).gba",
                size: 8388608
              }
            ],
            fileCount: 1,
            totalSize: 8388608,
            requiresExtraction: true,
            canDownload: true,
            warnings: [],
            confidence: 0.95,
            reason: "ZIP contains Metroid Fusion (USA).gba"
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
