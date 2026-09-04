import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { filterInstalledGames, summarizeInstalledSystems } from "@romdeck/core";
import type { AppConfig, DownloadCandidate, InstalledGame, InstalledState, SearchResult, SystemDefinition, SystemKey } from "@romdeck/core";
import {
  canUseNativeDialogs,
  cancelDownload,
  clearDownloadHistory,
  getConfig,
  getDiagnostics,
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
  uriToPath,
  validateFolder,
  type DownloadJob,
  type EsdeFolderSuggestion,
  type HostDiagnostics
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
  const [diagnostics, setDiagnostics] = useState<HostDiagnostics | null>(null);
  const [esdeSuggestions, setEsdeSuggestions] = useState<EsdeFolderSuggestion[]>([]);
  const [completedDownloadIds, setCompletedDownloadIds] = useState<Set<string>>(new Set());
  const [selectedSystem, setSelectedSystem] = useState<SystemKey>("gba");
  const [systemQuery, setSystemQuery] = useState("");
  const [installedScope, setInstalledScope] = useState<"selected" | "all">("selected");
  const [installedQuery, setInstalledQuery] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [destinationPath, setDestinationPath] = useState("");
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
  const destinationPathRequestRef = useRef(0);
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
  const exactEsdeSuggestions = useMemo(() => {
    const unique = new Map<string, EsdeFolderSuggestion>();
    for (const suggestion of esdeSuggestions) {
      if (suggestion.confidence === "exact" && !unique.has(suggestion.systemKey)) {
        unique.set(suggestion.systemKey, suggestion);
      }
    }
    return [...unique.values()];
  }, [esdeSuggestions]);
  const configuredSystemCount = useMemo(
    () => systems.filter((system) => config.systems[system.key]?.destinationUri).length,
    [config.systems, systems]
  );
  const visibleSystems = useMemo(() => {
    const cleanQuery = systemQuery.trim().toLowerCase();
    if (!cleanQuery) {
      return systems;
    }
    return systems.filter((system) => (
      system.displayName.toLowerCase().includes(cleanQuery) ||
      system.key.toLowerCase().includes(cleanQuery) ||
      system.preferredExtensions.some((extension) => extension.includes(cleanQuery))
    ));
  }, [systemQuery, systems]);
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
  const installedSummary = useMemo(() => summarizeInstalledSystems(installed), [installed]);
  const visibleInstalled = useMemo(
    () => filterInstalledGames(installed, {
      systemKey: installedScope === "selected" ? selectedSystem : "all",
      query: installedQuery
    }),
    [installed, installedQuery, installedScope, selectedSystem]
  );

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
    setResults([]);
    setSelectedResult(null);
    setCandidates([]);
  }, [selectedSystem]);

  useEffect(() => {
    void refreshDestinationPath();
  }, [selectedSystem, selectedSystemConfig?.destinationUri]);

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
      void refreshDiagnostics();
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

  async function refreshDiagnostics() {
    try {
      const response = await getDiagnostics();
      setDiagnostics(response.diagnostics);
    } catch {
      setDiagnostics(null);
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

  async function applyExactEsdeSuggestions() {
    if (exactEsdeSuggestions.length === 0) {
      setNotice("No exact ES-DE folders to apply.", "warning");
      return;
    }

    setBusy(true);
    setOperation("saving");
    try {
      const nextSystems = { ...config.systems };
      for (const suggestion of exactEsdeSuggestions) {
        await validateFolder(suggestion.destinationUri);
        nextSystems[suggestion.systemKey] = {
          enabled: true,
          destinationUri: suggestion.destinationUri
        };
      }
      const saved = await saveConfig({ version: 1, systems: nextSystems });
      setConfig(saved.config);
      setNotice(`Applied ${exactEsdeSuggestions.length} ES-DE folder${exactEsdeSuggestions.length === 1 ? "" : "s"}.`, "success");
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

  async function refreshDestinationPath() {
    const requestId = destinationPathRequestRef.current + 1;
    destinationPathRequestRef.current = requestId;
    const destinationUri = selectedSystemConfig?.destinationUri;
    if (!destinationUri) {
      setDestinationPath("");
      setFolderPath("");
      return;
    }
    try {
      const response = await uriToPath(destinationUri);
      if (destinationPathRequestRef.current !== requestId) {
        return;
      }
      setDestinationPath(response.path);
      setFolderPath(response.path);
    } catch {
      if (destinationPathRequestRef.current !== requestId) {
        return;
      }
      setDestinationPath(destinationUri);
      setFolderPath(destinationUri);
    }
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
          <input
            className="system-filter"
            value={systemQuery}
            onChange={(event) => setSystemQuery(event.target.value)}
            placeholder="Filter systems"
          />
          <div className="system-list">
            {visibleSystems.length === 0 ? <div className="empty-state">No systems match this filter.</div> : null}
            {visibleSystems.map((system) => (
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
              <div className="selected-system-title">
                <strong>{selectedSystemInfo?.displayName ?? selectedSystem}</strong>
                <StatusBadge tone={selectedSystemConfig?.destinationUri ? "good" : "amber"}>
                  {selectedSystemConfig?.destinationUri ? "Ready" : "Setup"}
                </StatusBadge>
              </div>
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
                        <StatusBadge tone={candidateStatusTone(candidate, config)}>
                          {candidateStatusLabel(candidate, config)}
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
                    {!hasCandidateDestination(candidate, config) || !candidate.canDownload ? (
                      <small className="candidate-warning">{downloadDisabledReason(candidate, hasCandidateDestination(candidate, config))}</small>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void download(candidate)}
                      disabled={busy || !hasCandidateDestination(candidate, config) || !candidate.canDownload}
                      title={downloadDisabledReason(candidate, hasCandidateDestination(candidate, config))}
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
                <p className="path-readout">{destinationPath || selectedSystemConfig?.destinationUri || "No destination configured"}</p>
                {!selectedSystemConfig?.destinationUri ? (
                  <div className="setup-callout">
                    <strong>{selectedSystemInfo?.displayName ?? selectedSystem} folder required</strong>
                    <small>
                      {selectedEsdeSuggestions.some((suggestion) => suggestion.confidence === "exact")
                        ? "Exact ES-DE folder available."
                        : "Downloads unlock after this folder is saved."}
                    </small>
                  </div>
                ) : null}
                {diagnostics ? (
                  <div className="diagnostics-strip" aria-label="Host diagnostics">
                    <span>{diagnostics.platform} {diagnostics.arch}</span>
                    <span>{diagnostics.node}</span>
                    <span>{diagnostics.sessionProtected ? "Protected" : "Dev open"}</span>
                  </div>
                ) : null}
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
                  <div className="suggestion-actions">
                    <button type="button" onClick={detectEsdeFolders} disabled={busy}>
                      Detect ES-DE
                    </button>
                    <button type="button" onClick={() => void applyExactEsdeSuggestions()} disabled={busy || exactEsdeSuggestions.length === 0}>
                      Apply Exact{exactEsdeSuggestions.length > 0 ? ` (${exactEsdeSuggestions.length})` : ""}
                    </button>
                  </div>
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
                  <StatusBadge tone="blue">{visibleInstalled.length}/{installed.length}</StatusBadge>
                </div>
                <div className="installed-tools">
                  <div className="segmented-control" aria-label="Installed library scope">
                    <button
                      type="button"
                      className={installedScope === "selected" ? "active" : ""}
                      onClick={() => setInstalledScope("selected")}
                    >
                      Selected
                    </button>
                    <button
                      type="button"
                      className={installedScope === "all" ? "active" : ""}
                      onClick={() => setInstalledScope("all")}
                    >
                      All
                    </button>
                  </div>
                  <input
                    value={installedQuery}
                    onChange={(event) => setInstalledQuery(event.target.value)}
                    placeholder="Filter installed"
                  />
                </div>
                {installedSummary.length > 0 ? (
                  <div className="installed-summary-strip" aria-label="Installed count by system">
                    {installedSummary.slice(0, 6).map((summary) => (
                      <span key={summary.systemKey}>
                        <strong>{summary.systemKey.toUpperCase()}</strong>
                        <small>{summary.count}</small>
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="compact-list">
                  {installed.length === 0 ? <div className="empty-state">No installed games scanned.</div> : null}
                  {installed.length > 0 && visibleInstalled.length === 0 ? <div className="empty-state">No installed games match this filter.</div> : null}
                  {visibleInstalled.map((game) => (
                    <div key={`${game.systemKey}:${game.title}`} className="installed-row">
                      <span>
                        <strong>{game.title}</strong>
                        <small>{installedGameDetail(game)}</small>
                      </span>
                      <StatusBadge tone="blue">{game.systemKey.toUpperCase()}</StatusBadge>
                    </div>
                  ))}
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
        <StatusBadge tone={toneForDownload(job.status)}>{labelForDownloadStatus(job.status)}</StatusBadge>
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

function installedGameDetail(game: InstalledGame): string {
  const parts = [game.region ?? "Region unknown"];
  if (game.version) {
    parts.push(game.version);
  }
  parts.push(`${game.files.length} file${game.files.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
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

function labelForDownloadStatus(status: DownloadJob["status"]): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "downloading":
      return "Downloading";
    case "extracting":
      return "Extracting";
    case "complete":
      return "Complete";
    case "skipped":
      return "Skipped";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
  }
}

function hasCandidateDestination(candidate: DownloadCandidate, config: AppConfig): boolean {
  return Boolean(config.systems[candidate.systemKey]?.enabled && config.systems[candidate.systemKey]?.destinationUri);
}

function candidateStatusLabel(candidate: DownloadCandidate, config: AppConfig): string {
  if (!candidate.canDownload) {
    return "Blocked";
  }
  if (!hasCandidateDestination(candidate, config)) {
    return "Needs setup";
  }
  return "Ready";
}

function candidateStatusTone(candidate: DownloadCandidate, config: AppConfig): "good" | "muted" | "blue" | "amber" | "danger" {
  if (!candidate.canDownload) {
    return "danger";
  }
  if (!hasCandidateDestination(candidate, config)) {
    return "amber";
  }
  return "good";
}

function downloadDisabledReason(candidate: DownloadCandidate, hasDestination: boolean): string {
  if (!hasDestination) {
    return "Configure this system folder first.";
  }
  if (!candidate.canDownload) {
    return candidate.warnings[0] ?? "Candidate is unavailable.";
  }
  return "Download";
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
