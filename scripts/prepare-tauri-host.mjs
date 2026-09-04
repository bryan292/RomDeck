import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const resourcesRoot = join(root, "packages/desktop-tauri/src-tauri/resources/host");
const nodeModulesRoot = join(resourcesRoot, "node_modules");

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
