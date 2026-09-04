export function logInfo(message: string, details?: Record<string, unknown>): void {
  writeLog("info", message, details);
}

export function logWarn(message: string, details?: Record<string, unknown>): void {
  writeLog("warn", message, details);
}

export function logError(message: string, error?: unknown, details?: Record<string, unknown>): void {
  writeLog("error", message, {
    ...details,
    error: error instanceof Error ? error.message : error === undefined ? undefined : String(error)
  });
}

function writeLog(level: "info" | "warn" | "error", message: string, details?: Record<string, unknown>): void {
  if (process.env.VITEST === "true") {
    return;
  }
  const payload = details ? ` ${JSON.stringify(compact(details))}` : "";
  console.log(`${new Date().toISOString()} ${level.toUpperCase()} ${message}${payload}`);
}

function compact(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}
