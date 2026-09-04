import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { execFileSync } from "node:child_process";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceFiles = execFileSync("rg", ["--files", "packages/core/src"], {
  cwd: root,
  encoding: "utf8"
}).trim().split("\n").filter(Boolean);

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
