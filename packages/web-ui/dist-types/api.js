const API_BASE = typeof window !== "undefined" && window.__TAURI_INTERNALS__
    ? "http://127.0.0.1:5137"
    : "";
async function request(path, options) {
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            "content-type": "application/json",
            ...options?.headers
        }
    });
    const body = await response.json();
    if (!response.ok) {
        throw new Error(body.error ?? "Request failed.");
    }
    return body;
}
export function getSystems() {
    return request("/api/systems");
}
export function getEsdeSuggestions() {
    return request("/api/esde/suggestions");
}
export function getConfig() {
    return request("/api/config");
}
export function saveConfig(config) {
    return request("/api/config", {
        method: "PUT",
        body: JSON.stringify({ config })
    });
}
export function pathToUri(path) {
    return request("/api/path-uri", {
        method: "POST",
        body: JSON.stringify({ path })
    });
}
export function validateFolder(destinationUri) {
    return request("/api/folders/validate", {
        method: "POST",
        body: JSON.stringify({ destinationUri })
    });
}
export function scanLibrary() {
    return request("/api/library/scan", { method: "POST" });
}
export function getLibrary() {
    return request("/api/library");
}
export function searchArchive(systemKey, query) {
    return request("/api/search", {
        method: "POST",
        body: JSON.stringify({ systemKey, query })
    });
}
export function resolveItem(itemId, systemKey, title) {
    const params = new URLSearchParams({ systemKey, title });
    return request(`/api/items/${encodeURIComponent(itemId)}/resolve?${params}`);
}
export function startDownload(candidate) {
    return request("/api/downloads", {
        method: "POST",
        body: JSON.stringify({ candidate })
    });
}
export function getDownloads() {
    return request("/api/downloads");
}
export function cancelDownload(jobId) {
    return request(`/api/downloads/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST"
    });
}
export function clearDownloadHistory() {
    return request("/api/downloads/clear-history", {
        method: "POST"
    });
}
//# sourceMappingURL=api.js.map