import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  cpSync,
  mkdirSync,
  rmSync
} from "node:fs";
import { execFileSync } from "node:child_process";
import { get } from "node:https";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cacheRoot = join(root, ".cache/node-runtime");
const resourcesRoot = join(root, "packages/desktop-tauri/src-tauri/resources/host");
const nodeModulesRoot = join(resourcesRoot, "node_modules");
const nodeRuntimeRoot = join(resourcesRoot, "node-runtime");

function copy(source, destination) {
  cpSync(join(root, source), join(resourcesRoot, destination), {
    recursive: true,
    force: true,
    dereference: true
  });
}

function copyPackage(source, destination) {
  cpSync(join(root, source), join(nodeModulesRoot, destination), {
    recursive: true,
    force: true,
    dereference: true
  });
}

function nodePlatform() {
  const platform = process.env.ROMDECK_NODE_PLATFORM ?? process.platform;
  if (platform === "win32" || platform === "win") {
    return "win";
  }
  if (platform === "darwin" || platform === "linux") {
    return platform;
  }
  throw new Error(`Unsupported Node runtime platform: ${platform}`);
}

function nodeArch() {
  const arch = process.env.ROMDECK_NODE_ARCH ?? process.arch;
  if (arch === "x64" || arch === "arm64") {
    return arch;
  }
  throw new Error(`Unsupported Node runtime architecture: ${arch}`);
}

function archiveExtension(platform) {
  if (platform === "win") {
    return "zip";
  }
  if (platform === "darwin") {
    return "tar.gz";
  }
  return "tar.xz";
}

function download(url, destination) {
  if (existsSync(destination)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    mkdirSync(dirname(destination), { recursive: true });
    const request = get(url, (response) => {
      if (
        response.statusCode &&
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        download(response.headers.location, destination).then(resolve, reject);
        return;
      }

      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });
    request.on("error", reject);
  });
}

function expandArchive(archivePath, destination, platform) {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });

  if (platform === "win") {
    const command = process.platform === "win32" ? "powershell.exe" : "pwsh";
    const literalArchivePath = archivePath.replaceAll("'", "''");
    const literalDestination = destination.replaceAll("'", "''");
    execFileSync(command, [
      "-NoProfile",
      "-Command",
      `Expand-Archive -LiteralPath '${literalArchivePath}' -DestinationPath '${literalDestination}' -Force`
    ], { stdio: "inherit" });
    return;
  }

  execFileSync("tar", ["-xf", archivePath, "-C", destination], { stdio: "inherit" });
}

async function copyNodeRuntime() {
  const version = process.env.ROMDECK_NODE_VERSION ?? process.versions.node;
  const platform = nodePlatform();
  const arch = nodeArch();
  const extension = archiveExtension(platform);
  const packageName = `node-v${version}-${platform}-${arch}`;
  const archivePath = join(cacheRoot, `${packageName}.${extension}`);
  const extractRoot = join(cacheRoot, `${packageName}-extract`);
  const url = `https://nodejs.org/dist/v${version}/${packageName}.${extension}`;

  await download(url, archivePath);
  expandArchive(archivePath, extractRoot, platform);

  const extractedPackage = join(extractRoot, packageName);
  mkdirSync(nodeRuntimeRoot, { recursive: true });
  copyFileSync(join(extractedPackage, "LICENSE"), join(nodeRuntimeRoot, "LICENSE.node"));

  if (platform === "win") {
    copyFileSync(join(extractedPackage, "node.exe"), join(nodeRuntimeRoot, "node.exe"));
    return;
  }

  mkdirSync(join(nodeRuntimeRoot, "bin"), { recursive: true });
  copyFileSync(join(extractedPackage, "bin/node"), join(nodeRuntimeRoot, "bin/node"));
  chmodSync(join(nodeRuntimeRoot, "bin/node"), 0o755);
}

rmSync(resourcesRoot, { recursive: true, force: true });
mkdirSync(nodeModulesRoot, { recursive: true });

copy("packages/desktop-host/dist", "desktop-host/dist");
copy("packages/desktop-host/package.json", "desktop-host/package.json");
copy("packages/web-ui/dist", "web-ui/dist");

copyPackage("packages/core/dist", "@romdeck/core/dist");
copyPackage("packages/core/package.json", "@romdeck/core/package.json");
copyPackage("node_modules/fflate", "fflate");
copyPackage("node_modules/libarchive.js", "libarchive.js");
copyPackage("node_modules/comlink", "comlink");

await copyNodeRuntime();
