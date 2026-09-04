import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRoot = join(root, "packages/core/src");
const sourceFiles = collectSourceFiles(sourceRoot);

const forbiddenImportPatterns = [
  /\bfrom\s+["']node:/,
  /\bimport\s+["']node:/,
  /\bfrom\s+["'](?:fs|path|os|crypto|stream|url|http|https|child_process)["']/,
  /\bfrom\s+["']@tauri-apps\//,
  /\bfrom\s+["']\.\.\/\.\.\/desktop-/,
  /\bfrom\s+["']\.\.\/\.\.\/web-ui/
];

const forbiddenGlobals = [
  /\bwindow\./,
  /\bdocument\./,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bprocess\.env\b/
];

const failures = [];
for (const relativeFile of sourceFiles) {
  const file = join(root, relativeFile);
  const contents = readFileSync(file, "utf8");
  for (const pattern of [...forbiddenImportPatterns, ...forbiddenGlobals]) {
    if (pattern.test(contents)) {
      failures.push(`${relativeFile}: ${pattern}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Core platform-neutral check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

function collectSourceFiles(directory) {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(absolutePath));
      continue;
    }

    if (/\.(?:ts|tsx|js|mjs)$/.test(entry.name)) {
      files.push(relative(root, absolutePath));
    }
  }

  return files.sort();
}
