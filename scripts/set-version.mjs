import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2]?.replace(/^v/, "");

if (!version || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
  console.error("Usage: node scripts/set-version.mjs <semver>");
  process.exit(1);
}

const jsonFiles = [
  "package.json",
  "packages/core/package.json",
  "packages/desktop-host/package.json",
  "packages/web-ui/package.json",
  "packages/desktop-tauri/package.json",
  "packages/desktop-tauri/src-tauri/tauri.conf.json"
];

for (const file of jsonFiles) {
  const document = JSON.parse(readFileSync(file, "utf8"));
  document.version = version;
  for (const dependencyType of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const dependencies = document[dependencyType];
    if (!dependencies) {
      continue;
    }
    for (const dependencyName of Object.keys(dependencies)) {
      if (dependencyName.startsWith("@romdeck/")) {
        dependencies[dependencyName] = version;
      }
    }
  }
  writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
}

const cargoFile = "packages/desktop-tauri/src-tauri/Cargo.toml";
const cargo = readFileSync(cargoFile, "utf8").replace(
  /^version = ".+"$/m,
  `version = "${version}"`
);
writeFileSync(cargoFile, cargo);
