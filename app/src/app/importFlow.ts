import type { AssetRow, Id } from "../data/db";
import { startImport } from "../media/import";

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
): Promise<AssetRow[]> {
  onProgress({ index: 0, total: files.length });
  try {
    const { assets, failed } = await startImport(projectId, files);
    if (failed.length === 1) toast(`${failed[0].name}: ${failed[0].reason}`, "error");
    else if (failed.length > 1) toast(`${failed.length} arquivos não foram importados. ${failed[0].reason}`, "error");
    return assets;
  } finally {
    onProgress(null);
  }
}
