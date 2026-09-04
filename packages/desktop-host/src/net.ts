import { logWarn } from "./logger.js";

export interface FetchJsonOptions {
  label: string;
  timeoutMs?: number;
  attempts?: number;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_ATTEMPTS = 2;

export async function fetchJson<T>(url: string | URL, options: FetchJsonOptions): Promise<T> {
  const response = await fetchWithRetries(url, options);
  return await response.json() as T;
}

export async function fetchWithRetries(url: string | URL, options: FetchJsonOptions & RequestInit): Promise<Response> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...options,
        signal: options.signal ?? controller.signal
      });
      clearTimeout(timeout);
      if (!response.ok && isRetryableStatus(response.status) && attempt < attempts) {
        logWarn(`${options.label} retrying after HTTP ${response.status}`, { attempt, url: String(url) });
        await delay(attempt * 400, options.signal);
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (options.signal?.aborted || attempt === attempts) {
        break;
      }
      logWarn(`${options.label} retrying after network error`, { attempt, url: String(url), error: formatError(error) });
      await delay(attempt * 400, options.signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function delay(milliseconds: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("Request canceled."));
    }, { once: true });
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
