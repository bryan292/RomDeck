# RomDeck

RomDeck is a local-first ROM library manager for EmulationStation/ES-DE setups.
The intended architecture is platform agnostic: a shared core contains catalog,
provider, resolver, scanner, and download rules, while each host platform
provides its own filesystem, networking, storage, and UI adapters. Desktop
targets should include Windows, Linux, and macOS; Android should be able to reuse
the same core later.

## Current MVP

The current vertical slice supports:

1. Configure per-system destination folders.
2. Search Internet Archive by system.
3. Resolve direct ROM files and supported archive candidates while ignoring
   metadata and auxiliary files.
4. Download direct files with progress, cancellation, transient retries, and
   persistent history.
5. Stream ZIP extraction into the configured ROM folder without leaving the
   archive file behind.
6. Inspect ZIP archives with HTTP range requests when possible.
7. Extract small `.7z` and `.rar` archives through a JS/WASM adapter when they
   are under the configured memory limit.
8. Detect installed games on later scans.

Systems currently modeled in the catalog include Game Boy, Game Boy Color, Game
Boy Advance, NES, SNES, Nintendo 64, Nintendo DS, Nintendo 3DS, Wii, Wii U,
PlayStation, PlayStation 2, PSP, PS Vita, GameCube, Dreamcast, Xbox, and Xbox
360.

## Development

```bash
npm install
npm run build
npm test
npm run typecheck
npm run dev
npm run dev:tauri
npm run build:tauri
```

The desktop host serves the web UI at `http://localhost:5137` by default.
`npm run dev:tauri` starts the Tauri shell and points it at the desktop host.
Building native bundles requires Rust and Cargo to be installed.

## Packaging

The current macOS package is built with Tauri:

```bash
npm run build:tauri
```

Build outputs are written to:

- `packages/desktop-tauri/src-tauri/target/release/bundle/macos/RomDeck.app`
- `packages/desktop-tauri/src-tauri/target/release/bundle/dmg/RomDeck_0.1.0_aarch64.dmg`

For this MVP, the Tauri bundle includes the compiled web UI, desktop host, and
minimal runtime `node_modules`, then starts the host with the local Node runtime
installed on the machine. A future production package should replace that with a
self-contained sidecar binary or native Tauri commands.

## GitHub Automation

GitHub Actions workflows are included for:

- CI on pull requests and pushes to `main`/`develop`.
- Manual package builds for macOS, Linux, and Windows artifacts.
- Manual version preparation through a GitHub pull request.
- Automatic draft GitHub Releases after a version PR is merged and CI passes.

Release flow:

1. Run the `Prepare Version` workflow with the next semver.
2. Review and merge the generated version pull request in GitHub.
3. Wait for CI on `main` to pass.
4. The `Release` workflow creates the matching tag, builds desktop packages, and
   attaches installers to a draft release.
5. Review and publish the generated draft release.

## JavaScript Libraries

The MVP intentionally uses JS/TypeScript libraries that can be reused by future
desktop and Android hosts where practical:

- `react` and `vite` for the web UI.
- `fflate` for streaming ZIP extraction and ZIP test fixtures.
- `libarchive.js` for bounded JS/WASM archive inspection/extraction of `.7z`
  and `.rar`.
- `vitest` for core and host tests.

The app must not depend on external archive binaries such as `7z`, `unrar`,
shell scripts, or Wine.
