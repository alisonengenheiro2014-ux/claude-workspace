import type { AssetRow, Id } from "../data/db";
import { importFiles, type ImportProgress } from "../media/import";

// Runs an import and turns the failures into one readable message.
export async function runImport(
  projectId: Id,
  files: File[],
  onProgress: (p: ImportProgress | null) => void,
  toast: (text: string, tone?: "info" | "error") => void,
): Promise<AssetRow[]> {
  onProgress({ index: 0, total: files.length, fraction: 0 });
  try {
    const { assets, failed } = await importFiles(projectId, files, onProgress);
    if (failed.length === 1) toast(`${failed[0].name}: ${failed[0].reason}`, "error");
    else if (failed.length > 1) toast(`${failed.length} arquivos não foram importados. ${failed[0].reason}`, "error");
    return assets;
  } finally {
    onProgress(null);
  }
}
