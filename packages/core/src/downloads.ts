import type { DownloadCandidate, PlannedDownloadJob } from "./types.js";

export function planDownloadJob(params: {
  candidate: DownloadCandidate;
  destinationUri: string;
  id: string;
}): PlannedDownloadJob {
  if (!params.destinationUri) {
    throw new Error("A destination URI is required.");
  }

  return {
    id: params.id,
    systemKey: params.candidate.systemKey,
    title: params.candidate.title,
    destinationUri: params.destinationUri,
    files: params.candidate.files,
    status: "queued"
  };
}
