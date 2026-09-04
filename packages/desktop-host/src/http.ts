import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

export async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  response.end(JSON.stringify(body));
}

export function sendError(response: ServerResponse, status: number, error: unknown): void {
  sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
}

export async function serveStatic(response: ServerResponse, root: string, pathname: string): Promise<boolean> {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const target = resolve(join(root, safePath));
  if (!target.startsWith(resolve(root))) {
    return false;
  }

  try {
    const info = await stat(target);
    if (!info.isFile()) {
      return false;
    }
    response.writeHead(200, {
      "content-type": MIME_TYPES[extname(target)] ?? "application/octet-stream"
    });
    createReadStream(target).pipe(response);
    return true;
  } catch {
    return false;
  }
}
