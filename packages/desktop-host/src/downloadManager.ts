import { randomUUID } from "node:crypto";
import { statSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { Unzip, UnzipInflate } from "fflate";
import {
  extensionOf,
  isDirectSystemFile,
  planDownloadJob,
  safeTargetName,
  type DownloadCandidate,
  type PlannedDownloadJob
} from "@romdeck/core";
import {
  ensureDirectory,
  existingFileMatches,
  finalizePartial,
  openPartialWriteStream,
  removePartial,
  resolveInsideDestination,
  validateWritableDirectory
} from "./files.js";
import { downloadsFilePath } from "./config.js";
import { canUseJsWasmArchive, extractJsWasmArchive } from "./libarchiveAdapter.js";
import { logError, logInfo, logWarn } from "./logger.js";

export interface RuntimeDownloadJob extends Omit<PlannedDownloadJob, "status"> {
  status: "queued" | "downloading" | "extracting" | "complete" | "failed" | "skipped" | "canceled";
  bytesReceived: number;
  bytesTotal?: number;
  downloadedBytes: number;
  extractedBytes: number;
  speedBytesPerSecond: number;
  currentFile?: string;
  error?: string;
  requiresExtraction: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

const jobs = new Map<string, RuntimeDownloadJob>();
const controllers = new Map<string, AbortController>();
const completionListeners = new Set<(job: RuntimeDownloadJob) => void | Promise<void>>();
let historyLoaded = false;
const MAX_TRANSFER_ATTEMPTS = 3;

export async function initializeDownloadHistory(): Promise<void> {
  if (historyLoaded) {
    return;
  }
  historyLoaded = true;
  try {
    const raw = await readFile(downloadsFilePath(), "utf8");
    const parsed = JSON.parse(raw) as RuntimeDownloadJob[];
    for (const job of parsed) {
      jobs.set(job.id, {
        ...job,
        status: isTerminalStatus(job.status) ? job.status : "failed",
        error: isTerminalStatus(job.status) ? job.error : "Job was interrupted by app shutdown.",
        speedBytesPerSecond: 0
      });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

export async function listDownloadJobs(): Promise<RuntimeDownloadJob[]> {
  await initializeDownloadHistory();
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function enqueueDownload(candidate: DownloadCandidate, destinationUri: string): Promise<RuntimeDownloadJob> {
  await initializeDownloadHistory();
  if (!candidate.canDownload) {
    throw new Error(candidate.warnings[0] ?? "Candidate is not downloadable.");
  }
  const planned = planDownloadJob({ candidate, destinationUri, id: randomUUID() });
  const existing = findEquivalentActiveJob(planned);
  if (existing) {
    logInfo("Download already queued", {
      jobId: existing.id,
      systemKey: existing.systemKey,
      title: existing.title
    });
    return existing;
  }
  const now = new Date().toISOString();
  const job: RuntimeDownloadJob = {
    ...planned,
    status: "queued",
    bytesReceived: 0,
    bytesTotal: planned.files.reduce((sum, file) => sum + (file.size ?? 0), 0) || undefined,
    downloadedBytes: 0,
    extractedBytes: 0,
    speedBytesPerSecond: 0,
    requiresExtraction: candidate.requiresExtraction,
    createdAt: now,
    updatedAt: now
  };
  jobs.set(job.id, job);
  logInfo("Download queued", {
    jobId: job.id,
    systemKey: job.systemKey,
    title: job.title,
    files: job.files.length,
    bytesTotal: job.bytesTotal
  });
  await persistJobs();
  void runJob(job);
  return job;
}

export function onDownloadComplete(listener: (job: RuntimeDownloadJob) => void | Promise<void>): void {
  completionListeners.add(listener);
}

export async function cancelDownload(jobId: string): Promise<RuntimeDownloadJob> {
  await initializeDownloadHistory();
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error("Download job was not found.");
  }
  if (isTerminalStatus(job.status)) {
    return job;
  }
  controllers.get(jobId)?.abort();
  job.status = "canceled";
  job.error = "Canceled by user.";
  job.completedAt = new Date().toISOString();
  touch(job);
  await persistJobs();
  return job;
}

export async function clearDownloadHistory(): Promise<RuntimeDownloadJob[]> {
  await initializeDownloadHistory();
  for (const [jobId, job] of jobs.entries()) {
    if (isTerminalStatus(job.status)) {
      jobs.delete(jobId);
    }
  }
  await persistJobs();
  return [...jobs.values()];
}

async function runJob(job: RuntimeDownloadJob): Promise<void> {
  const controller = new AbortController();
  controllers.set(job.id, controller);
  try {
    logInfo("Download started", { jobId: job.id, systemKey: job.systemKey, title: job.title });
    job.status = "downloading";
    touch(job);
    await ensureDirectory(job.destinationUri);
    await validateWritableDirectory(job.destinationUri);

    let skippedAll = true;
    for (const file of job.files) {
      job.currentFile = file.targetName;
      touch(job);
      const targetPath = resolveInsideDestination(job.destinationUri, file.targetName);
      logInfo("Download file started", {
        jobId: job.id,
        systemKey: job.systemKey,
        title: job.title,
        targetName: file.targetName,
        sourceName: file.sourceName,
        size: file.size
      });

      const extension = extensionOf(file.targetName);
      if (job.requiresExtraction && extension === ".zip") {
        skippedAll = false;
        await runTransferWithRetries(job, controller.signal, () => downloadAndExtractZip(file.sourceUrl, file.size, job, controller.signal));
      } else if (job.requiresExtraction && [".7z", ".rar"].includes(extension)) {
        skippedAll = false;
        await runTransferWithRetries(job, controller.signal, () => downloadAndExtractJsWasmArchive(file.sourceUrl, file.size, job, controller.signal));
      } else {
        if (await existingFileMatches(targetPath, file.size)) {
          logInfo("Download file skipped", {
            jobId: job.id,
            targetName: file.targetName,
            reason: "matching file already exists"
          });
          continue;
        }
        skippedAll = false;
        await runTransferWithRetries(job, controller.signal, () => downloadFile(file.sourceUrl, targetPath, file.size, job, controller.signal));
      }
    }

    job.status = skippedAll ? "skipped" : "complete";
    job.currentFile = undefined;
    job.completedAt = new Date().toISOString();
    touch(job);
    await persistJobs();
    logInfo("Download completed", {
      jobId: job.id,
      status: job.status,
      downloadedBytes: job.downloadedBytes,
      extractedBytes: job.extractedBytes
    });
    notifyCompletion(job);
  } catch (error) {
    if (controller.signal.aborted || job.status === "canceled") {
      job.status = "canceled";
      job.error = "Canceled by user.";
    } else {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : String(error);
    }
    job.completedAt = new Date().toISOString();
    touch(job);
    await persistJobs();
    logError("Download failed", error, {
      jobId: job.id,
      status: job.status,
      currentFile: job.currentFile,
      downloadedBytes: job.downloadedBytes,
      extractedBytes: job.extractedBytes
    });
  } finally {
    controllers.delete(job.id);
  }
}

async function downloadAndExtractJsWasmArchive(url: string, size: number | undefined, job: RuntimeDownloadJob, signal: AbortSignal): Promise<void> {
  if (!canUseJsWasmArchive(size)) {
    throw new Error("Archive exceeds JS/WASM extraction limit.");
  }
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }

  const chunks: Uint8Array[] = [];
  for await (const chunk of Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>)) {
    throwIfAborted(signal);
    const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
    chunks.push(data);
    job.bytesReceived += data.byteLength;
    job.downloadedBytes += data.byteLength;
    touch(job);
  }

  job.status = "extracting";
  touch(job);
  const buffer = concatChunks(chunks, job.downloadedBytes);
  const extracted = await extractJsWasmArchive({
    buffer,
    systemKey: job.systemKey,
    destinationUri: job.destinationUri,
    onExtractedBytes: (bytes, currentFile) => {
      job.extractedBytes += bytes;
      job.currentFile = currentFile;
      touch(job);
    }
  });

  if (extracted === 0) {
    throw new Error("Archive did not contain a compatible ROM file.");
  }
}

async function downloadAndExtractZip(url: string, size: number | undefined, job: RuntimeDownloadJob, signal: AbortSignal): Promise<void> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed with HTTP ${response.status}`);
  }

  const total = Number(response.headers.get("content-length")) || size;
  if (total && !job.bytesTotal) {
    job.bytesTotal = total;
  }

  const unzip = new Unzip();
  unzip.register(UnzipInflate);
  const fileWrites: Array<Promise<void>> = [];
  const partialTargets: string[] = [];
  let extracted = 0;

  try {
    unzip.onfile = (file) => {
      if (!isDirectSystemFile(job.systemKey, file.name)) {
        return;
      }
      const targetName = safeTargetName(file.name);
      const targetPath = resolveInsideDestination(job.destinationUri, targetName);

      if (existingFileMatchesSync(targetPath, file.originalSize)) {
        extracted += 1;
        return;
      }
      if (existingFileExistsSync(targetPath)) {
        throw new Error(`Target file already exists with different size: ${targetName}`);
      }

      job.status = "extracting";
      job.currentFile = targetName;
      touch(job);

      partialTargets.push(targetPath);
      const stream = openPartialWriteStream(targetPath);
      const write = new Promise<void>((resolve, reject) => {
        stream.on("error", reject);
        file.ondata = (error, data, final) => {
          if (error) {
            stream.destroy(error);
            reject(error);
            return;
          }
          if (data) {
            job.extractedBytes += data.byteLength;
            touch(job);
            stream.write(data);
          }
          if (final) {
            stream.end(async () => {
              try {
                await finalizePartial(targetPath);
                extracted += 1;
                resolve();
              } catch (finalizeError) {
                reject(finalizeError);
              }
            });
          }
        };
      });
      fileWrites.push(write);
      file.start();
    };

    for await (const chunk of Readable.fromWeb(response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>)) {
      throwIfAborted(signal);
      const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBuffer);
      job.bytesReceived += data.byteLength;
      job.downloadedBytes += data.byteLength;
      touch(job);
      unzip.push(data, false);
    }
    unzip.push(new Uint8Array(), true);
    await Promise.all(fileWrites);

    if (extracted === 0) {
      throw new Error("Archive did not contain a compatible ROM file.");
    }
  } catch (error) {
    await Promise.all(partialTargets.map((path) => removePartial(path)));
    throw error;
  }
}

async function downloadFile(url: string, targetPath: string, size: number | undefined, job: RuntimeDownloadJob, signal: AbortSignal): Promise<void> {
  await removePartial(targetPath);
  try {
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with HTTP ${response.status}`);
    }
    const total = Number(response.headers.get("content-length")) || size;
    if (total && !job.bytesTotal) {
      job.bytesTotal = total;
    }

    const progressStream = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        throwIfAborted(signal);
        job.bytesReceived += chunk.byteLength;
        job.downloadedBytes += chunk.byteLength;
        touch(job);
        controller.enqueue(chunk);
      }
    });

    const readable = Readable.fromWeb(response.body.pipeThrough(progressStream) as unknown as import("node:stream/web").ReadableStream);
    await pipeline(readable, openPartialWriteStream(targetPath));
    await finalizePartial(targetPath);
  } catch (error) {
    await removePartial(targetPath);
    throw error;
  }
}

async function runTransferWithRetries(job: RuntimeDownloadJob, signal: AbortSignal, transfer: () => Promise<void>): Promise<void> {
  const checkpoint = {
    bytesReceived: job.bytesReceived,
    downloadedBytes: job.downloadedBytes,
    extractedBytes: job.extractedBytes
  };

  for (let attempt = 1; attempt <= MAX_TRANSFER_ATTEMPTS; attempt += 1) {
    try {
      await transfer();
      job.error = undefined;
      return;
    } catch (error) {
      if (signal.aborted || attempt === MAX_TRANSFER_ATTEMPTS || !isRetryableTransferError(error)) {
        throw error;
      }
      job.bytesReceived = checkpoint.bytesReceived;
      job.downloadedBytes = checkpoint.downloadedBytes;
      job.extractedBytes = checkpoint.extractedBytes;
      job.status = "downloading";
      job.error = `Retrying transfer after ${formatError(error)}.`;
      touch(job);
      await persistJobs();
      logWarn("Download transfer retrying", {
        jobId: job.id,
        currentFile: job.currentFile,
        failedAttempt: attempt,
        nextAttempt: attempt + 1,
        maxAttempts: MAX_TRANSFER_ATTEMPTS,
        error: formatError(error)
      });
      await delay(attempt * 750, signal);
    }
  }
}

function notifyCompletion(job: RuntimeDownloadJob): void {
  for (const listener of completionListeners) {
    void listener(job);
  }
}

async function persistJobs(): Promise<void> {
  const filePath = downloadsFilePath();
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify([...jobs.values()], null, 2)}\n`, "utf8");
}

function isTerminalStatus(status: RuntimeDownloadJob["status"]): boolean {
  return ["complete", "failed", "skipped", "canceled"].includes(status);
}

function findEquivalentActiveJob(planned: PlannedDownloadJob): RuntimeDownloadJob | undefined {
  return [...jobs.values()].find((job) => (
    !isTerminalStatus(job.status) &&
    job.systemKey === planned.systemKey &&
    job.destinationUri === planned.destinationUri &&
    job.files.length === planned.files.length &&
    job.files.every((file, index) => {
      const plannedFile = planned.files[index];
      return file.sourceUrl === plannedFile.sourceUrl && file.targetName === plannedFile.targetName;
    })
  ));
}

function existingFileMatchesSync(path: string, size?: number): boolean {
  try {
    const info = statSync(path);
    return info.isFile() && (size === undefined || info.size === size);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function existingFileExistsSync(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function touch(job: RuntimeDownloadJob): void {
  updateSpeed(job);
  job.updatedAt = new Date().toISOString();
}

function updateSpeed(job: RuntimeDownloadJob): void {
  const elapsedSeconds = Math.max(1, (Date.now() - Date.parse(job.createdAt)) / 1000);
  job.speedBytesPerSecond = Math.round(job.downloadedBytes / elapsedSeconds);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error("Download canceled.");
  }
}

function isRetryableTransferError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  const httpStatus = error.message.match(/HTTP (\d{3})/)?.[1];
  if (!httpStatus) {
    return true;
  }
  const status = Number(httpStatus);
  return status === 408 || status === 429 || status >= 500;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      reject(new Error("Download canceled."));
    }, { once: true });
  });
}

function concatChunks(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}
