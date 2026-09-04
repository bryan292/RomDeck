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
  if (!response.ok) {
    throw new Error(`${options.label} failed with HTTP ${response.status}`);
  }
  return await response.json() as T;
}

export async function fetchWithRetries(url: string | URL, options: FetchJsonOptions & RequestInit): Promise<Response> {
  const { attempts = DEFAULT_ATTEMPTS, label, timeoutMs = DEFAULT_TIMEOUT_MS, ...requestInit } = options;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...requestInit,
        signal: combineSignals(requestInit.signal, controller.signal)
      });
      clearTimeout(timeout);
      if (!response.ok && isRetryableStatus(response.status) && attempt < attempts) {
        logWarn(`${label} retrying after HTTP ${response.status}`, { attempt, url: String(url) });
        await delay(attempt * 400, requestInit.signal);
        continue;
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (requestInit.signal?.aborted || attempt === attempts) {
        break;
      }
      logWarn(`${label} retrying after network error`, { attempt, url: String(url), error: formatError(error) });
      await delay(attempt * 400, requestInit.signal);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function combineSignals(signal: AbortSignal | null | undefined, timeoutSignal: AbortSignal): AbortSignal {
  if (!signal) {
    return timeoutSignal;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted || timeoutSignal.aborted) {
    abort();
    return controller.signal;
  }
  signal.addEventListener("abort", abort, { once: true });
  timeoutSignal.addEventListener("abort", abort, { once: true });
  return controller.signal;
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
