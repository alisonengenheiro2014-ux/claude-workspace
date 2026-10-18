import type { AssetRow, Id } from "../data/db";
import { startImport } from "../media/import";

// Timing of the last "Novo projeto", shown once when the editor opens, so a
// slow import on the iPhone can be pinned down. Starts when iOS hands over
// the files, so the wait inside the photo picker is not included.
export let lastImport: { projectId: Id; startedAt: number; label: string | null } | null = null;
export function markImport(projectId: Id, startedAt: number, label: string | null = null) {
  lastImport = { projectId, startedAt, label };
}
export function takeImport(projectId: Id) {
  const l = lastImport;
  if (!l || l.projectId !== projectId) return null;
  lastImport = null;
  return { secs: (performance.now() - l.startedAt) / 1000, label: l.label };
}

// "HEVC 3840×2160 60 fps HDR, 612 MB"
export function describeAsset(a: AssetRow) {
  const codec = a.codec?.startsWith("avc") ? "H.264" : a.codec?.match(/^(hvc|hev)/) ? "HEVC" : (a.codec?.split(".")[0] ?? "?");
  const mb = Math.round(a.sizeBytes / 1e6);
  return `${codec} ${a.width}×${a.height}${a.fps ? ` ${a.fps} fps` : ""}${a.hdr ? " HDR" : ""}, ${mb} MB`;
}

export interface ImportProgress {
  index: number; // 0-based file being read
  total: number;
}

// Reads the picked files' metadata (fast) and starts the background copy.
// Failures become one readable message.
export async function runImport(
  projectId: Id,
  files: File[],
  onProgress: (p: ImportProgress | null) => void,
  toast: (text: string, tone?: "info" | "error") => void,
  options: { only?: "audio" } = {},
): Promise<AssetRow[]> {
  onProgress({ index: 0, total: files.length });
  try {
    const { assets, failed } = await startImport(projectId, files, options);
    if (failed.length === 1) toast(`${failed[0].name}: ${failed[0].reason}`, "error");
    else if (failed.length > 1) toast(`${failed.length} arquivos não foram importados. ${failed[0].reason}`, "error");
    return assets;
  } finally {
    onProgress(null);
  }
}
