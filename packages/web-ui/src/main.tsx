import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppConfig, DownloadCandidate, InstalledGame, InstalledState, SearchResult, SystemDefinition } from "@romdeck/core";
import {
  canUseNativeDialogs,
  cancelDownload,
  clearDownloadHistory,
  getConfig,
  getDownloads,
  getEsdeSuggestions,
  getLibrary,
  getSystems,
  pathToUri,
  pickDirectoryPath,
  resolveItem,
  saveConfig,
  scanLibrary,
  searchArchive,
  startDownload,
  validateFolder,
  type DownloadJob,
  type EsdeFolderSuggestion
} from "./api";
import "./styles.css";

type SearchResultWithState = SearchResult & { installed: boolean; installedState?: InstalledState };
type Operation = "initializing" | "idle" | "saving" | "detecting" | "scanning" | "searching" | "resolving" | "queueing";
type NoticeTone = "ready" | "busy" | "success" | "warning" | "error";

function App() {
  const [systems, setSystems] = useState<SystemDefinition[]>([]);
  const [config, setConfig] = useState<AppConfig>({ version: 1, systems: {} });
  const [installed, setInstalled] = useState<InstalledGame[]>([]);
  const [downloads, setDownloads] = useState<DownloadJob[]>([]);
  const [esdeSuggestions, setEsdeSuggestions] = useState<EsdeFolderSuggestion[]>([]);
  const [completedDownloadIds, setCompletedDownloadIds] = useState<Set<string>>(new Set());
  const [selectedSystem, setSelectedSystem] = useState("gba");
  const [folderPath, setFolderPath] = useState("");
  const [query, setQuery] = useState("Metroid Fusion");
  const [results, setResults] = useState<SearchResultWithState[]>([]);
  const [selectedResult, setSelectedResult] = useState<SearchResultWithState | null>(null);
  const [candidates, setCandidates] = useState<DownloadCandidate[]>([]);
  const [status, setStatus] = useState("Ready");
  const [statusTone, setStatusTone] = useState<NoticeTone>("ready");
  const [operation, setOperation] = useState<Operation>("initializing");
  const [busy, setBusy] = useState(false);
  const completedDownloadIdsRef = useRef(completedDownloadIds);
  const queryRef = useRef(query);
  const selectedSystemRef = useRef(selectedSystem);
  const searchRequestRef = useRef(0);
  const resolveRequestRef = useRef(0);
  const nativeDialogsAvailable = canUseNativeDialogs();

  const selectedSystemConfig = config.systems[selectedSystem as keyof AppConfig["systems"]];
  const selectedSystemInfo = useMemo(
    () => systems.find((system) => system.key === selectedSystem),
    [selectedSystem, systems]
  );
  const selectedEsdeSuggestions = useMemo(
    () => esdeSuggestions.filter((suggestion) => suggestion.systemKey === selectedSystem),
    [esdeSuggestions, selectedSystem]
  );
  const configuredSystemCount = useMemo(
    () => systems.filter((system) => config.systems[system.key]?.destinationUri).length,
    [config.systems, systems]
  );
  const activeDownloadCount = useMemo(
    () => downloads.filter((job) => !isTerminalDownload(job)).length,
    [downloads]
  );
  const installedCountBySystem = useMemo(() => {
    const counts = new Map<string, number>();
    for (const game of installed) {
      counts.set(game.systemKey, (counts.get(game.systemKey) ?? 0) + 1);
    }
    return counts;
  }, [installed]);

  useEffect(() => {
    void initialize();
    const timer = window.setInterval(() => {
      void refreshDownloads();
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    completedDownloadIdsRef.current = completedDownloadIds;
  }, [completedDownloadIds]);

  useEffect(() => {
    queryRef.current = query;
  }, [query]);

  useEffect(() => {
    selectedSystemRef.current = selectedSystem;
  }, [selectedSystem]);

  async function initialize() {
    setOperation("initializing");
    setBusy(true);
    try {
      const [systemResponse, configResponse, libraryResponse, downloadResponse] = await Promise.all([
        getSystems(),
        getConfig(),
        getLibrary(),
        getDownloads()
      ]);
      setSystems(systemResponse.systems);
      setConfig(configResponse.config);
      setInstalled(libraryResponse.installed);
      setDownloads(downloadResponse.jobs);
      setNotice("Ready", "ready");
    } catch (error) {
      setNotice(messageFromError(error), "error");
    } finally {
      setOperation("idle");
      setBusy(false);
    }
  }

  async function refreshDownloads() {
    try {
      const response = await getDownloads();
      setDownloads(response.jobs);
      const completed = response.jobs.filter((job) => job.status === "complete" || job.status === "skipped");
      const hasNewCompletion = completed.some((job) => !completedDownloadIdsRef.current.has(job.id));
      const nextCompletedIds = new Set(completed.map((job) => job.id));
      completedDownloadIdsRef.current = nextCompletedIds;
      setCompletedDownloadIds(nextCompletedIds);
      if (hasNewCompletion) {
        const library = await scanLibrary();
        setInstalled(library.installed);
        if (queryRef.current.trim()) {
          const refreshedResults = await searchArchive(selectedSystemRef.current, queryRef.current);
          setResults(refreshedResults.results);
        }
      }
    } catch {
      // The status bar is reserved for user-triggered actions.
    }
  }

  async function configureFolder() {
    if (!folderPath.trim()) {
      setNotice("Enter a folder path first.", "warning");
      return;
    }

    setBusy(true);
    setOperation("saving");
    try {
      const uri = await pathToUri(folderPath.trim());
      await validateFolder(uri.destinationUri);
      const nextConfig: AppConfig = {
        version: 1,
        systems: {
          ...config.systems,
          [selectedSystem]: {
            enabled: true,
            destinationUri: uri.destinationUri
          }
        }
      };
      const saved = await saveConfig(nextConfig);
      setConfig(saved.config);
      setNotice(`${selectedSystemInfo?.displayName ?? selectedSystem} folder saved.`, "success");
    } catch (error) {
      setNotice(messageFromError(error), "error");
    } finally {
      setOperation("idle");
      setBusy(false);
    }
  }

  async function chooseFolder() {
    setBusy(true);
    setOperation("saving");
    try {
      const path = await pickDirectoryPath(`Choose ${selectedSystemInfo?.displayName ?? selectedSystem} ROM folder`);
      if (!path) {
        setNotice("Folder selection canceled.", "warning");
        return;
      }
      setFolderPath(path);
      const uri = await pathToUri(path);
      await validateFolder(uri.destinationUri);
      const nextConfig: AppConfig = {
        version: 1,
        systems: {
          ...config.systems,
          [selectedSystem]: {
            enabled: true,
            destinationUri: uri.destinationUri
          }
        }
      };
      const saved = await saveConfig(nextConfig);
      setConfig(saved.config);
      setNotice(`${selectedSystemInfo?.displayName ?? selectedSystem} folder saved.`, "success");
    } catch (error) {
      setNotice(messageFromError(error), "error");
    } finally {
      setOperation("idle");
      setBusy(false);
    }
  }

  async function configureDestination(destinationUri: string, label: string) {
    setBusy(true);
    setOperation("saving");
    try {
      await validateFolder(destinationUri);
      const nextConfig: AppConfig = {
        version: 1,
        systems: {
          ...config.systems,
          [selectedSystem]: {
            enabled: true,
            destinationUri
          }
        }
      };
      const saved = await saveConfig(nextConfig);
      setConfig(saved.config);
      setNotice(`${selectedSystemInfo?.displayName ?? selectedSystem} folder saved from ${label}.`, "success");
    } catch (error) {
      setNotice(messageFromError(error), "error");
    } finally {
      setOperation("idle");
      setBusy(false);
    }
  }

  async function detectEsdeFolders() {
    setBusy(true);
    setOperation("detecting");
    try {
      const response = await getEsdeSuggestions();
      setEsdeSuggestions(response.suggestions);
      setNotice(`Found ${response.suggestions.length} ES-DE folder suggestion${response.suggestions.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
      setNotice(messageFromError(error), "error");
    } finally {
      setOperation("idle");
      setBusy(false);
    }
  }

  async function runScan() {
    setBusy(true);
    setOperation("scanning");
    try {
      const response = await scanLibrary();
      setInstalled(response.installed);
      setNotice(`Scanned ${response.installed.length} installed game${response.installed.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
      setNotice(messageFromError(error), "error");
    } finally {
      setOperation("idle");
      setBusy(false);
    }
  }

  async function runSearch() {
    if (busy || !query.trim()) {
      return;
    }
    const requestId = searchRequestRef.current + 1;
    searchRequestRef.current = requestId;
    resolveRequestRef.current += 1;
    setBusy(true);
    setOperation("searching");
    setSelectedResult(null);
    setCandidates([]);
    setNotice(`Searching ${selectedSystemInfo?.displayName ?? selectedSystem}...`, "busy");
    try {
      const response = await searchArchive(selectedSystem, query);
      if (searchRequestRef.current !== requestId) {
        return;
      }
      setResults(response.results);
      setNotice(`Found ${response.results.length} result${response.results.length === 1 ? "" : "s"}.`, response.results.length > 0 ? "success" : "warning");
    } catch (error) {
      if (searchRequestRef.current !== requestId) {
        return;
      }
      setNotice(messageFromError(error), "error");
    } finally {
      if (searchRequestRef.current === requestId) {
        setOperation("idle");
        setBusy(false);
      }
    }
  }

  async function selectResult(result: SearchResultWithState) {
    const requestId = resolveRequestRef.current + 1;
    resolveRequestRef.current = requestId;
    setSelectedResult(result);
    setCandidates([]);
    setBusy(true);
    setOperation("resolving");
    setNotice(`Inspecting compatible files for ${result.title}...`, "busy");
    try {
      const response = await resolveItem(result.itemId, result.systemKey, result.title);
      if (resolveRequestRef.current !== requestId) {
        return;
      }
      setCandidates(response.candidates);
      setNotice(`Resolved ${response.candidates.length} candidate${response.candidates.length === 1 ? "" : "s"}.`, response.candidates.length > 0 ? "success" : "warning");
    } catch (error) {
      if (resolveRequestRef.current !== requestId) {
        return;
      }
      setNotice(messageFromError(error), "error");
    } finally {
      if (resolveRequestRef.current === requestId) {
        setOperation("idle");
        setBusy(false);
      }
    }
  }

  async function download(candidate: DownloadCandidate) {
    setBusy(true);
    setOperation("queueing");
    try {
      const response = await startDownload(candidate);
      setDownloads((current) => [response.job, ...current.filter((job) => job.id !== response.job.id)]);
      setNotice(`Queued ${candidate.title}.`, "success");
    } catch (error) {
      setNotice(messageFromError(error), "error");
    } finally {
      setOperation("idle");
      setBusy(false);
    }
  }

  async function cancel(jobId: string) {
    try {
      const response = await cancelDownload(jobId);
      setDownloads((current) => current.map((job) => job.id === jobId ? response.job : job));
      setNotice("Download canceled.", "warning");
    } catch (error) {
      setNotice(messageFromError(error), "error");
    }
  }

  async function clearHistory() {
    try {
      const response = await clearDownloadHistory();
      setDownloads(response.jobs);
      setNotice("Download history cleared.", "success");
    } catch (error) {
      setNotice(messageFromError(error), "error");
    }
  }

  function setNotice(message: string, tone: NoticeTone): void {
    setStatus(message);
    setStatusTone(tone);
  }

  return (
    <main className="app">
      <header className="app-chrome">
        <div className="brand-block">
          <img className="brand-mark" src="/romdeck-icon.png" alt="" aria-hidden="true" />
          <div>
            <h1>RomDeck</h1>
            <p className={`status-line ${statusTone}`}><span className="pulse-dot" />{status}</p>
          </div>
        </div>
        <button className="primary-action" type="button" onClick={runScan} disabled={busy || !selectedSystemConfig?.destinationUri}>
          Scan Library
        </button>
      </header>

      <section className="app-body">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <h2>Systems</h2>
            <span>{configuredSystemCount}/{systems.length}</span>
          </div>
          <div className="system-list">
            {systems.map((system) => (
              <button
                key={system.key}
                type="button"
                className={system.key === selectedSystem ? "selected" : ""}
                onClick={() => setSelectedSystem(system.key)}
              >
                <span>
                  <strong>{system.displayName}</strong>
                  <small>{system.preferredExtensions.join(" ")}</small>
                </span>
                <span className="system-side">
                  <StatusBadge tone={config.systems[system.key]?.destinationUri ? "good" : "muted"}>
                    {config.systems[system.key]?.destinationUri ? "Ready" : "Setup"}
                  </StatusBadge>
                  <small>{installedCountBySystem.get(system.key) ?? 0}</small>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="workbench">
          <section className="overview-strip">
            <MetricCard label="Configured" value={`${configuredSystemCount}/${systems.length || 0}`} tone="green" />
            <MetricCard label="Installed" value={String(installed.length)} tone="blue" />
            <MetricCard label="Active" value={String(activeDownloadCount)} tone="amber" />
            <MetricCard label="History" value={String(downloads.length)} tone="rose" />
          </section>

          <section className="command-bar">
            <div className="selected-system">
              <small>Selected system</small>
              <strong>{selectedSystemInfo?.displayName ?? selectedSystem}</strong>
              <div className="extension-row">
                {selectedSystemInfo?.preferredExtensions.map((extension) => (
                  <span key={extension}>{extension}</span>
                ))}
              </div>
            </div>
            <form className="search-row" onSubmit={(event) => {
              event.preventDefault();
              void runSearch();
            }}>
              <input value={query} onChange={(event) => setQuery(event.target.value)} />
              <button type="submit" disabled={busy || !query.trim()}>
                Search
              </button>
            </form>
          </section>

          <section className="content-grid">
            <section className="panel results-panel">
              <div className="panel-heading">
                <h2>Search Results</h2>
                <StatusBadge tone="blue">{results.length}</StatusBadge>
              </div>
              <div className="result-list">
                {results.length === 0 ? (
                  <div className={`empty-state ${operation === "searching" ? "working" : ""}`}>
                    {operation === "searching" ? "Searching provider..." : "Search results will appear here."}
                  </div>
                ) : null}
                {results.map((result) => (
                  <button
                    key={result.itemId}
                    type="button"
                    className={selectedResult?.itemId === result.itemId ? "selected-result" : ""}
                    onClick={() => void selectResult(result)}
                  >
                    <span>
                      <strong>{result.title}</strong>
                      <small>{result.itemId}</small>
                      <ConfidenceMeter value={result.confidence} compact />
                    </span>
                    <StatusBadge tone={toneForInstalledState(result)}>
                      {labelForResult(result)}
                    </StatusBadge>
                  </button>
                ))}
              </div>
            </section>

            <section className="panel candidate-panel">
              <div className="panel-heading">
                <h2>{selectedResult ? selectedResult.title : "Resolved Files"}</h2>
                <StatusBadge tone={selectedResult ? "blue" : "muted"}>{candidates.length}</StatusBadge>
              </div>
              <div className="candidate-list">
                {!selectedResult ? <div className="empty-state">Select a result to inspect compatible files.</div> : null}
                {selectedResult && candidates.length === 0 ? (
                  <div className={`empty-state ${operation === "resolving" ? "working" : ""}`}>
                    {operation === "resolving" ? "Resolving compatible files..." : "Compatible files will appear after resolution."}
                  </div>
                ) : null}
                {candidates.map((candidate) => (
                  <article key={candidate.id} className="candidate">
                    <div>
                      <div className="candidate-title-row">
                        <strong>{candidate.title}</strong>
                        <StatusBadge tone={candidate.canDownload ? "good" : "danger"}>
                          {candidate.canDownload ? "Downloadable" : "Blocked"}
                        </StatusBadge>
                      </div>
                      <div className="candidate-meta">
                        <span>{candidate.format}</span>
                        <span>{candidate.fileCount} file{candidate.fileCount === 1 ? "" : "s"}</span>
                        <span>{formatBytes(candidate.totalSize)}</span>
                      </div>
                      <ConfidenceMeter value={candidate.confidence} />
                      <span>{candidate.reason}</span>
                      <small>
                        {candidate.files.map((file) => file.targetName).join(", ")}
                      </small>
                      {candidate.extractedFiles ? (
                        <small>
                          Extracts: {candidate.extractedFiles.map((file) => file.name).join(", ")}
                        </small>
                      ) : null}
                      {candidate.warnings.length > 0 ? <small>{candidate.warnings.join(" ")}</small> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => void download(candidate)}
                      disabled={busy || !selectedSystemConfig?.destinationUri || !candidate.canDownload}
                    >
                      {!candidate.canDownload ? "Unavailable" : candidate.requiresExtraction ? "Download + Extract" : "Download"}
                    </button>
                  </article>
                ))}
              </div>
            </section>

            <aside className="inspector">
              <section className="panel destination-panel">
                <div className="panel-heading">
                  <h2>Destination</h2>
                  <StatusBadge tone={selectedSystemConfig?.destinationUri ? "good" : "amber"}>
                    {selectedSystemConfig?.destinationUri ? "Ready" : "Required"}
                  </StatusBadge>
                </div>
                <p className="path-readout">{selectedSystemConfig?.destinationUri ?? "No destination configured"}</p>
                <div className="folder-form">
                  <input
                    value={folderPath}
                    onChange={(event) => setFolderPath(event.target.value)}
                    placeholder="/home/user/Emulation/roms/gba"
                  />
                  <button
                    type="button"
                    onClick={() => void chooseFolder()}
                    disabled={busy || !nativeDialogsAvailable}
                    title={nativeDialogsAvailable ? "Choose folder" : "Available in the desktop app"}
                  >
                    Browse
                  </button>
                  <button type="button" onClick={configureFolder} disabled={busy}>
                    Save
                  </button>
                </div>
                <div className="suggestions-row">
                  <button type="button" onClick={detectEsdeFolders} disabled={busy}>
                    Detect ES-DE
                  </button>
                  <div className="suggestion-list">
                    {selectedEsdeSuggestions.map((suggestion) => (
                      <button
                        key={`${suggestion.systemKey}:${suggestion.destinationUri}`}
                        type="button"
                        onClick={() => void configureDestination(suggestion.destinationUri, "ES-DE")}
                        disabled={busy || suggestion.confidence !== "exact"}
                        title={suggestion.reason}
                      >
                        <span>{suggestion.confidence === "exact" ? "Use" : "Expected"}</span>
                        <small>{suggestion.path}</small>
                      </button>
                    ))}
                  </div>
                </div>
              </section>

              <section className="panel downloads-panel">
                <div className="panel-heading">
                  <h2>Downloads</h2>
                  <button type="button" onClick={() => void clearHistory()}>
                    Clear
                  </button>
                </div>
                <div className="download-list">
                  {downloads.length === 0 ? <div className="empty-state">No downloads yet.</div> : null}
                  {downloads.map((job) => (
                    <DownloadRow key={job.id} job={job} onCancel={cancel} />
                  ))}
                </div>
              </section>

              <section className="panel installed-panel">
                <div className="panel-heading">
                  <h2>Installed</h2>
                  <StatusBadge tone="blue">{installed.length}</StatusBadge>
                </div>
                <div className="compact-list">
                  {installed.length === 0 ? <div className="empty-state">No installed games scanned.</div> : null}
                  {installed.slice(0, 8).map((game) => (
                    <div key={`${game.systemKey}:${game.title}`} className="installed-row">
                      <span>
                        <strong>{game.title}</strong>
                        <small>{game.region ?? "Region unknown"}</small>
                      </span>
                      <StatusBadge tone="blue">{game.systemKey.toUpperCase()}</StatusBadge>
                    </div>
                  ))}
                  {installed.length > 8 ? (
                    <div className="installed-row installed-summary">
                      <span>
                        <strong>{installed.length - 8} more installed</strong>
                        <small>Use scan/search to refresh matches.</small>
                      </span>
                    </div>
                  ) : null}
                </div>
              </section>
            </aside>
          </section>
        </section>
      </section>
      <footer className="content-boundary">
        Download only content you have the right to use.
      </footer>
    </main>
  );
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: "green" | "blue" | "amber" | "rose" }) {
  return (
    <div className={`metric-card ${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
    </div>
  );
}

function ConfidenceMeter({ value, compact = false }: { value: number; compact?: boolean }) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  return (
    <div className={`confidence-meter ${compact ? "compact" : ""}`}>
      <div className="confidence-track">
        <div className="confidence-fill" style={{ width: `${percent}%` }} />
      </div>
      {!compact ? <small>{percent}% confidence</small> : null}
    </div>
  );
}

function DownloadRow({ job, onCancel }: { job: DownloadJob; onCancel: (jobId: string) => Promise<void> }) {
  const progress = downloadProgress(job);
  return (
    <article className={`download-row ${job.status}`}>
      <div className="download-row-head">
        <span>
          <strong>{job.title}</strong>
          <small>{downloadSummary(job)}</small>
        </span>
        <StatusBadge tone={toneForDownload(job.status)}>{job.status}</StatusBadge>
      </div>
      <div
        className="progress-track"
        role="progressbar"
        aria-label={`Download progress ${progress}%`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
      >
        <div className="progress-fill" style={{ width: `${progress}%` }} />
      </div>
      <div className="download-row-foot">
        <small>{formatBytes(job.downloadedBytes)} / {formatBytes(job.bytesTotal)}</small>
        <small>{downloadDetail(job)}</small>
        {!isTerminalDownload(job) ? (
          <button type="button" onClick={() => void onCancel(job.id)}>
            Cancel
          </button>
        ) : null}
      </div>
    </article>
  );
}

function StatusBadge({ children, tone }: { children: React.ReactNode; tone: "good" | "muted" | "blue" | "amber" | "danger" }) {
  return <small className={`status-badge ${tone}`}>{children}</small>;
}

function messageFromError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return "RomDeck host is not reachable. Reopen the app or check romdeck-host.log.";
  }
  return error.message;
}

function labelForResult(result: SearchResultWithState): string {
  if (result.installedState === "installed" || result.installed) {
    return "Installed";
  }
  if (result.installedState === "possible") {
    return "Possible match";
  }
  return String(result.year ?? result.itemId);
}

function toneForInstalledState(result: SearchResultWithState): "good" | "amber" | "muted" {
  if (result.installedState === "installed" || result.installed) {
    return "good";
  }
  if (result.installedState === "possible") {
    return "amber";
  }
  return "muted";
}

function formatBytes(value: number | undefined): string {
  if (!value) {
    return "Unknown size";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size >= 10 || unit === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unit]}`;
}

function downloadSummary(job: DownloadJob): string {
  const parts: string[] = [];
  if (job.bytesTotal) {
    parts.push(`${Math.round((job.downloadedBytes / job.bytesTotal) * 100)}%`);
  }
  if (job.speedBytesPerSecond > 0 && !isTerminalDownload(job)) {
    parts.push(`${formatBytes(job.speedBytesPerSecond)}/s`);
  }
  if (job.extractedBytes > 0) {
    parts.push(`extracted ${formatBytes(job.extractedBytes)}`);
  }
  if (job.currentFile) {
    parts.push(job.currentFile);
  }
  if (job.error) {
    parts.push(job.error);
  }
  return parts.join(" · ");
}

function downloadDetail(job: DownloadJob): string {
  if (job.status === "complete") {
    return job.extractedBytes > 0 ? `Extracted ${formatBytes(job.extractedBytes)}` : "Complete";
  }
  if (job.status === "skipped") {
    return "Already installed";
  }
  if (job.status === "failed") {
    return job.error ?? "Failed";
  }
  if (job.status === "canceled") {
    return "Canceled";
  }
  if (job.extractedBytes > 0) {
    return `Extracted ${formatBytes(job.extractedBytes)}`;
  }
  return job.currentFile ?? "Waiting";
}

function downloadProgress(job: DownloadJob): number {
  if (job.status === "complete" || job.status === "skipped") {
    return 100;
  }
  if (!job.bytesTotal) {
    return job.downloadedBytes > 0 || job.extractedBytes > 0 ? 12 : 0;
  }
  return Math.max(0, Math.min(100, Math.round((job.downloadedBytes / job.bytesTotal) * 100)));
}

function toneForDownload(status: DownloadJob["status"]): "good" | "muted" | "blue" | "amber" | "danger" {
  if (status === "complete" || status === "skipped") {
    return "good";
  }
  if (status === "failed" || status === "canceled") {
    return status === "failed" ? "danger" : "muted";
  }
  if (status === "extracting") {
    return "blue";
  }
  return "amber";
}

function isTerminalDownload(job: DownloadJob): boolean {
  return ["complete", "failed", "skipped", "canceled"].includes(job.status);
}

createRoot(document.getElementById("root")!).render(<App />);
