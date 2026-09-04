import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { cancelDownload, clearDownloadHistory, getConfig, getDownloads, getEsdeSuggestions, getLibrary, getSystems, pathToUri, resolveItem, saveConfig, scanLibrary, searchArchive, startDownload, validateFolder } from "./api";
import "./styles.css";
function App() {
    const [systems, setSystems] = useState([]);
    const [config, setConfig] = useState({ version: 1, systems: {} });
    const [installed, setInstalled] = useState([]);
    const [downloads, setDownloads] = useState([]);
    const [esdeSuggestions, setEsdeSuggestions] = useState([]);
    const [completedDownloadIds, setCompletedDownloadIds] = useState(new Set());
    const [selectedSystem, setSelectedSystem] = useState("gba");
    const [folderPath, setFolderPath] = useState("");
    const [query, setQuery] = useState("Metroid Fusion");
    const [results, setResults] = useState([]);
    const [selectedResult, setSelectedResult] = useState(null);
    const [candidates, setCandidates] = useState([]);
    const [status, setStatus] = useState("Ready");
    const [busy, setBusy] = useState(false);
    const completedDownloadIdsRef = useRef(completedDownloadIds);
    const queryRef = useRef(query);
    const selectedSystemRef = useRef(selectedSystem);
    const selectedSystemConfig = config.systems[selectedSystem];
    const selectedSystemInfo = useMemo(() => systems.find((system) => system.key === selectedSystem), [selectedSystem, systems]);
    const selectedEsdeSuggestions = useMemo(() => esdeSuggestions.filter((suggestion) => suggestion.systemKey === selectedSystem), [esdeSuggestions, selectedSystem]);
    const configuredSystemCount = useMemo(() => systems.filter((system) => config.systems[system.key]?.destinationUri).length, [config.systems, systems]);
    const activeDownloadCount = useMemo(() => downloads.filter((job) => !isTerminalDownload(job)).length, [downloads]);
    const installedCountBySystem = useMemo(() => {
        const counts = new Map();
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
        }
        catch (error) {
            setStatus(messageFromError(error));
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
        }
        catch {
            // The status bar is reserved for user-triggered actions.
        }
    }
    async function configureFolder() {
        if (!folderPath.trim()) {
            setStatus("Enter a folder path first.");
            return;
        }
        setBusy(true);
        try {
            const uri = await pathToUri(folderPath.trim());
            await validateFolder(uri.destinationUri);
            const nextConfig = {
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
            setStatus(`${selectedSystemInfo?.displayName ?? selectedSystem} folder saved.`);
        }
        catch (error) {
            setStatus(messageFromError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function configureDestination(destinationUri, label) {
        setBusy(true);
        try {
            await validateFolder(destinationUri);
            const nextConfig = {
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
            setStatus(`${selectedSystemInfo?.displayName ?? selectedSystem} folder saved from ${label}.`);
        }
        catch (error) {
            setStatus(messageFromError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function detectEsdeFolders() {
        setBusy(true);
        try {
            const response = await getEsdeSuggestions();
            setEsdeSuggestions(response.suggestions);
            setStatus(`Found ${response.suggestions.length} ES-DE folder suggestion${response.suggestions.length === 1 ? "" : "s"}.`);
        }
        catch (error) {
            setStatus(messageFromError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function runScan() {
        setBusy(true);
        try {
            const response = await scanLibrary();
            setInstalled(response.installed);
            setStatus(`Scanned ${response.installed.length} installed game${response.installed.length === 1 ? "" : "s"}.`);
        }
        catch (error) {
            setStatus(messageFromError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function runSearch() {
        setBusy(true);
        setSelectedResult(null);
        setCandidates([]);
        try {
            const response = await searchArchive(selectedSystem, query);
            setResults(response.results);
            setStatus(`Found ${response.results.length} result${response.results.length === 1 ? "" : "s"}.`);
        }
        catch (error) {
            setStatus(messageFromError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function selectResult(result) {
        setSelectedResult(result);
        setCandidates([]);
        setBusy(true);
        try {
            const response = await resolveItem(result.itemId, result.systemKey, result.title);
            setCandidates(response.candidates);
            setStatus(`Resolved ${response.candidates.length} candidate${response.candidates.length === 1 ? "" : "s"}.`);
        }
        catch (error) {
            setStatus(messageFromError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function download(candidate) {
        setBusy(true);
        try {
            const response = await startDownload(candidate);
            setDownloads((current) => [response.job, ...current.filter((job) => job.id !== response.job.id)]);
            setStatus(`Queued ${candidate.title}.`);
        }
        catch (error) {
            setStatus(messageFromError(error));
        }
        finally {
            setBusy(false);
        }
    }
    async function cancel(jobId) {
        try {
            const response = await cancelDownload(jobId);
            setDownloads((current) => current.map((job) => job.id === jobId ? response.job : job));
            setStatus("Download canceled.");
        }
        catch (error) {
            setStatus(messageFromError(error));
        }
    }
    async function clearHistory() {
        try {
            const response = await clearDownloadHistory();
            setDownloads(response.jobs);
            setStatus("Download history cleared.");
        }
        catch (error) {
            setStatus(messageFromError(error));
        }
    }
    return (_jsxs("main", { className: "app", children: [_jsxs("header", { className: "app-chrome", children: [_jsxs("div", { className: "brand-block", children: [_jsx("img", { className: "brand-mark", src: "/romdeck-icon.png", alt: "", "aria-hidden": "true" }), _jsxs("div", { children: [_jsx("h1", { children: "RomDeck" }), _jsxs("p", { className: "status-line", children: [_jsx("span", { className: "pulse-dot" }), status] })] })] }), _jsx("button", { className: "primary-action", type: "button", onClick: runScan, disabled: busy || !selectedSystemConfig?.destinationUri, children: "Scan Library" })] }), _jsxs("section", { className: "app-body", children: [_jsxs("aside", { className: "sidebar", children: [_jsxs("div", { className: "sidebar-heading", children: [_jsx("h2", { children: "Systems" }), _jsxs("span", { children: [configuredSystemCount, "/", systems.length] })] }), _jsx("div", { className: "system-list", children: systems.map((system) => (_jsxs("button", { type: "button", className: system.key === selectedSystem ? "selected" : "", onClick: () => setSelectedSystem(system.key), children: [_jsxs("span", { children: [_jsx("strong", { children: system.displayName }), _jsx("small", { children: system.preferredExtensions.join(" ") })] }), _jsxs("span", { className: "system-side", children: [_jsx(StatusBadge, { tone: config.systems[system.key]?.destinationUri ? "good" : "muted", children: config.systems[system.key]?.destinationUri ? "Ready" : "Setup" }), _jsx("small", { children: installedCountBySystem.get(system.key) ?? 0 })] })] }, system.key))) })] }), _jsxs("section", { className: "workbench", children: [_jsxs("section", { className: "overview-strip", children: [_jsx(MetricCard, { label: "Configured", value: `${configuredSystemCount}/${systems.length || 0}`, tone: "green" }), _jsx(MetricCard, { label: "Installed", value: String(installed.length), tone: "blue" }), _jsx(MetricCard, { label: "Active", value: String(activeDownloadCount), tone: "amber" }), _jsx(MetricCard, { label: "History", value: String(downloads.length), tone: "rose" })] }), _jsxs("section", { className: "command-bar", children: [_jsxs("div", { className: "selected-system", children: [_jsx("small", { children: "Selected system" }), _jsx("strong", { children: selectedSystemInfo?.displayName ?? selectedSystem }), _jsx("div", { className: "extension-row", children: selectedSystemInfo?.preferredExtensions.map((extension) => (_jsx("span", { children: extension }, extension))) })] }), _jsxs("div", { className: "search-row", children: [_jsx("input", { value: query, onChange: (event) => setQuery(event.target.value) }), _jsx("button", { type: "button", onClick: runSearch, disabled: busy || !query.trim(), children: "Search" })] })] }), _jsxs("section", { className: "content-grid", children: [_jsxs("section", { className: "panel results-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h2", { children: "Search Results" }), _jsx(StatusBadge, { tone: "blue", children: results.length })] }), _jsxs("div", { className: "result-list", children: [results.length === 0 ? _jsx("div", { className: "empty-state", children: "Search results will appear here." }) : null, results.map((result) => (_jsxs("button", { type: "button", className: selectedResult?.itemId === result.itemId ? "selected-result" : "", onClick: () => void selectResult(result), children: [_jsxs("span", { children: [_jsx("strong", { children: result.title }), _jsx("small", { children: result.itemId }), _jsx(ConfidenceMeter, { value: result.confidence, compact: true })] }), _jsx(StatusBadge, { tone: toneForInstalledState(result), children: labelForResult(result) })] }, result.itemId)))] })] }), _jsxs("section", { className: "panel candidate-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h2", { children: selectedResult ? selectedResult.title : "Resolved Files" }), _jsx(StatusBadge, { tone: selectedResult ? "blue" : "muted", children: candidates.length })] }), _jsxs("div", { className: "candidate-list", children: [!selectedResult ? _jsx("div", { className: "empty-state", children: "Select a result to inspect compatible files." }) : null, selectedResult && candidates.length === 0 ? _jsx("div", { className: "empty-state", children: "Compatible files will appear after resolution." }) : null, candidates.map((candidate) => (_jsxs("article", { className: "candidate", children: [_jsxs("div", { children: [_jsxs("div", { className: "candidate-title-row", children: [_jsx("strong", { children: candidate.title }), _jsx(StatusBadge, { tone: candidate.canDownload ? "good" : "danger", children: candidate.canDownload ? "Downloadable" : "Blocked" })] }), _jsxs("div", { className: "candidate-meta", children: [_jsx("span", { children: candidate.format }), _jsxs("span", { children: [candidate.fileCount, " file", candidate.fileCount === 1 ? "" : "s"] }), _jsx("span", { children: formatBytes(candidate.totalSize) })] }), _jsx(ConfidenceMeter, { value: candidate.confidence }), _jsx("span", { children: candidate.reason }), _jsx("small", { children: candidate.files.map((file) => file.targetName).join(", ") }), candidate.extractedFiles ? (_jsxs("small", { children: ["Extracts: ", candidate.extractedFiles.map((file) => file.name).join(", ")] })) : null, candidate.warnings.length > 0 ? _jsx("small", { children: candidate.warnings.join(" ") }) : null] }), _jsx("button", { type: "button", onClick: () => void download(candidate), disabled: busy || !selectedSystemConfig?.destinationUri || !candidate.canDownload, children: !candidate.canDownload ? "Unavailable" : candidate.requiresExtraction ? "Download + Extract" : "Download" })] }, candidate.id)))] })] }), _jsxs("aside", { className: "inspector", children: [_jsxs("section", { className: "panel destination-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h2", { children: "Destination" }), _jsx(StatusBadge, { tone: selectedSystemConfig?.destinationUri ? "good" : "amber", children: selectedSystemConfig?.destinationUri ? "Ready" : "Required" })] }), _jsx("p", { className: "path-readout", children: selectedSystemConfig?.destinationUri ?? "No destination configured" }), _jsxs("div", { className: "folder-form", children: [_jsx("input", { value: folderPath, onChange: (event) => setFolderPath(event.target.value), placeholder: "/home/user/Emulation/roms/gba" }), _jsx("button", { type: "button", onClick: configureFolder, disabled: busy, children: "Save" })] }), _jsxs("div", { className: "suggestions-row", children: [_jsx("button", { type: "button", onClick: detectEsdeFolders, disabled: busy, children: "Detect ES-DE" }), _jsx("div", { className: "suggestion-list", children: selectedEsdeSuggestions.map((suggestion) => (_jsxs("button", { type: "button", onClick: () => void configureDestination(suggestion.destinationUri, "ES-DE"), disabled: busy || suggestion.confidence !== "exact", title: suggestion.reason, children: [_jsx("span", { children: suggestion.confidence === "exact" ? "Use" : "Expected" }), _jsx("small", { children: suggestion.path })] }, `${suggestion.systemKey}:${suggestion.destinationUri}`))) })] })] }), _jsxs("section", { className: "panel downloads-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h2", { children: "Downloads" }), _jsx("button", { type: "button", onClick: () => void clearHistory(), children: "Clear" })] }), _jsxs("div", { className: "download-list", children: [downloads.length === 0 ? _jsx("div", { className: "empty-state", children: "No downloads yet." }) : null, downloads.map((job) => (_jsx(DownloadRow, { job: job, onCancel: cancel }, job.id)))] })] }), _jsxs("section", { className: "panel installed-panel", children: [_jsxs("div", { className: "panel-heading", children: [_jsx("h2", { children: "Installed" }), _jsx(StatusBadge, { tone: "blue", children: installed.length })] }), _jsxs("div", { className: "compact-list", children: [installed.length === 0 ? _jsx("div", { className: "empty-state", children: "No installed games scanned." }) : null, installed.slice(0, 8).map((game) => (_jsxs("div", { className: "installed-row", children: [_jsxs("span", { children: [_jsx("strong", { children: game.title }), _jsx("small", { children: game.region ?? "Region unknown" })] }), _jsx(StatusBadge, { tone: "blue", children: game.systemKey.toUpperCase() })] }, `${game.systemKey}:${game.title}`)))] })] })] })] })] })] }), _jsx("footer", { className: "content-boundary", children: "Download only content you have the right to use." })] }));
}
function MetricCard({ label, value, tone }) {
    return (_jsxs("div", { className: `metric-card ${tone}`, children: [_jsx("small", { children: label }), _jsx("strong", { children: value })] }));
}
function ConfidenceMeter({ value, compact = false }) {
    const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
    return (_jsxs("div", { className: `confidence-meter ${compact ? "compact" : ""}`, children: [_jsx("div", { className: "confidence-track", children: _jsx("div", { className: "confidence-fill", style: { width: `${percent}%` } }) }), !compact ? _jsxs("small", { children: [percent, "% confidence"] }) : null] }));
}
function DownloadRow({ job, onCancel }) {
    const progress = downloadProgress(job);
    return (_jsxs("article", { className: `download-row ${job.status}`, children: [_jsxs("div", { className: "download-row-head", children: [_jsxs("span", { children: [_jsx("strong", { children: job.title }), _jsx("small", { children: downloadSummary(job) })] }), _jsx(StatusBadge, { tone: toneForDownload(job.status), children: job.status })] }), _jsx("div", { className: "progress-track", role: "progressbar", "aria-label": `Download progress ${progress}%`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": progress, children: _jsx("div", { className: "progress-fill", style: { width: `${progress}%` } }) }), _jsxs("div", { className: "download-row-foot", children: [_jsxs("small", { children: [formatBytes(job.downloadedBytes), " / ", formatBytes(job.bytesTotal)] }), _jsx("small", { children: job.extractedBytes > 0 ? `Extracted ${formatBytes(job.extractedBytes)}` : job.currentFile ?? "Waiting" }), !isTerminalDownload(job) ? (_jsx("button", { type: "button", onClick: () => void onCancel(job.id), children: "Cancel" })) : null] })] }));
}
function StatusBadge({ children, tone }) {
    return _jsx("small", { className: `status-badge ${tone}`, children: children });
}
function messageFromError(error) {
    return error instanceof Error ? error.message : String(error);
}
function labelForResult(result) {
    if (result.installedState === "installed" || result.installed) {
        return "Installed";
    }
    if (result.installedState === "possible") {
        return "Possible match";
    }
    return String(result.year ?? result.itemId);
}
function toneForInstalledState(result) {
    if (result.installedState === "installed" || result.installed) {
        return "good";
    }
    if (result.installedState === "possible") {
        return "amber";
    }
    return "muted";
}
function formatBytes(value) {
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
function downloadSummary(job) {
    const parts = [];
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
function downloadProgress(job) {
    if (job.status === "complete" || job.status === "skipped") {
        return 100;
    }
    if (!job.bytesTotal) {
        return job.downloadedBytes > 0 || job.extractedBytes > 0 ? 12 : 0;
    }
    return Math.max(0, Math.min(100, Math.round((job.downloadedBytes / job.bytesTotal) * 100)));
}
function toneForDownload(status) {
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
function isTerminalDownload(job) {
    return ["complete", "failed", "skipped", "canceled"].includes(job.status);
}
createRoot(document.getElementById("root")).render(_jsx(App, {}));
//# sourceMappingURL=main.js.map