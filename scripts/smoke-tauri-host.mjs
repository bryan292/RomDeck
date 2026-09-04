import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const hostRoot = process.env.ROMDECK_SMOKE_HOST_ROOT ?? join(root, "packages/desktop-tauri/src-tauri/resources/host");
const targetPlatform = normalizedTargetPlatform();
const targetArch = process.env.ROMDECK_NODE_ARCH ?? process.arch;
const bundledNode = bundledNodePath();
const nodePath = runnableNodePath(bundledNode);
const serverDir = join(hostRoot, "desktop-host/dist");
const serverEntry = join(serverDir, "server.js");
const webEntry = join(hostRoot, "web-ui/dist/index.html");
const port = Number(process.env.ROMDECK_SMOKE_PORT ?? await availablePort());
const sessionToken = "smoke-token";
const configDir = mkdtempSync(join(tmpdir(), "romdeck-smoke-config-"));
const logFile = join(configDir, "romdeck-host.log");

verify(bundledNode, "bundled Node runtime");
verify(serverEntry, "desktop host entrypoint");
verify(webEntry, "web UI entrypoint");

const child = spawn(nodePath, ["server.js"], {
  cwd: serverDir,
  env: {
    ...process.env,
    PORT: String(port),
    ROMDECK_CONFIG_DIR: configDir,
    ROMDECK_HOST_LOG_FILE: logFile,
    ROMDECK_SESSION_TOKEN: sessionToken
  },
  stdio: ["ignore", "pipe", "pipe"]
});

const output = [];
let spawnError;
child.stdout.on("data", (chunk) => output.push(chunk.toString()));
child.stderr.on("data", (chunk) => output.push(chunk.toString()));
child.on("error", (error) => {
  spawnError = error;
  output.push(error instanceof Error ? error.message : String(error));
});

try {
  await waitForHealth();
  await assertJson("/api/health", undefined, (body) => body.ok === true);
  await assertJson("/api/systems", { "x-romdeck-session": sessionToken }, (body) => Array.isArray(body.systems) && body.systems.length > 0);
  await assertUnauthorizedSystems();
  await assertStaticIndex();
} finally {
  await stopChild();
}

function bundledNodePath() {
  const windowsNode = join(hostRoot, "node-runtime/node.exe");
  const posixNode = join(hostRoot, "node-runtime/bin/node");
  if (existsSync(windowsNode)) {
    return windowsNode;
  }
  return posixNode;
}

function runnableNodePath(targetNodePath) {
  if (targetPlatform === normalizedCurrentPlatform() && targetArch === process.arch) {
    return targetNodePath;
  }
  console.warn(
    `Packaged Node runtime is ${targetPlatform}-${targetArch}; runner is ${normalizedCurrentPlatform()}-${process.arch}. ` +
    "Using current Node runtime for host smoke after verifying packaged runtime exists."
  );
  return process.execPath;
}

function normalizedTargetPlatform() {
  const platform = process.env.ROMDECK_NODE_PLATFORM ?? process.platform;
  return platform === "win32" ? "win" : platform;
}

function normalizedCurrentPlatform() {
  return process.platform === "win32" ? "win" : process.platform;
}

function verify(path, label) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${label}: ${path}`);
  }
}

async function waitForHealth() {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (spawnError) {
      throw new Error(`Host could not be started with ${nodePath}.\n${output.join("")}`);
    }
    if (child.exitCode !== null) {
      throw new Error(`Host exited early with code ${child.exitCode}.\n${output.join("")}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(150);
    }
  }
  throw new Error(`Timed out waiting for host health.\n${output.join("")}`);
}

async function assertJson(path, headers, predicate) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`${path} failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  if (!predicate(body)) {
    throw new Error(`${path} returned unexpected body: ${JSON.stringify(body)}`);
  }
}

async function assertUnauthorizedSystems() {
  const response = await fetch(`http://127.0.0.1:${port}/api/systems`);
  if (response.status !== 401) {
    throw new Error(`Expected /api/systems without token to return 401, got ${response.status}`);
  }
}

async function assertStaticIndex() {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  if (!response.ok) {
    throw new Error(`Static index failed with HTTP ${response.status}`);
  }
  const body = await response.text();
  if (!body.includes("RomDeck")) {
    throw new Error("Static index did not include RomDeck content.");
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Could not allocate smoke test port.")));
        return;
      }
      const selectedPort = address.port;
      server.close((error) => error ? reject(error) : resolve(selectedPort));
    });
  });
}

function stopChild() {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill();
    setTimeout(resolve, 1000);
  });
}
