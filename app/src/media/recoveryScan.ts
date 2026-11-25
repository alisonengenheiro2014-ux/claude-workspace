// READ-ONLY inspection of local OPFS files, including abandoned imports.
// This must never truncate, delete, modify, or re-import the only original.
import { db, type AssetRow } from "../data/db";
import { readFile } from "../data/opfs";

export type RecoveryStatus = "complete" | "partial" | "unknown";
export interface RecoveryFile {
  path: string;
  name: string;
  project: string;
  file: File;
  size: number;
  expected: number | null;
  mime: string;
  status: RecoveryStatus;
  originalStatus: string;
}
interface KnownOriginal {
  name: string;
  project: string;
  size: number;
  mime: string;
  status: string;
}
export function classifyRecoveredBytes(size: number, expected: number | null): RecoveryStatus {
  return expected === null ? "unknown" : expected === size ? "complete" : "partial";
}

function knownAssets(assets: AssetRow[], projects: Map<string, string>) {
  const known = new Map<string, KnownOriginal>();
  for (const a of assets) {
    known.set(a.opfsPath, {
      name: a.name, project: projects.get(a.projectId) ?? "Projeto sem identificação",
      size: a.sizeBytes, mime: a.mime, status: a.status,
    });
  }
  return known;
}

// Directory traversal uses only handles and getFile() metadata.
// It does NOT read 1.5 GB of video bytes into JS memory.
async function enumerate(directory: FileSystemDirectoryHandle, prefix: string, result: RecoveryFile[],
  known: Map<string, KnownOriginal>, limit: number) {
  // TS's DOM lib omits async iteration even where Safari implements it.
  const iterable = directory as FileSystemDirectoryHandle & { values(): AsyncIterable<FileSystemHandle> };
  for await (const entry of iterable.values()) {
    if (result.length >= limit) throw new Error("Muitos arquivos. Limite seguro de inspeção atingido.");
    const path = prefix + entry.name;
    if (entry.kind === "directory") {
      await enumerate(entry as FileSystemDirectoryHandle, path + "/", result, known, limit);
      continue;
    }
    if (entry.kind !== "file") continue;
    let blob: File;
    try { blob = await (entry as FileSystemFileHandle).getFile(); }
    catch (err) {
      console.warn("Arquivo inacessível durante inspeção de recuperação:", path, err);
      continue; // inspect other files; one corrupt handle must not block rescue
    }
    if (blob.size === 0) continue;
    const info = known.get(path);
    result.push({
      path,
      name: info?.name ?? ("Arquivo sem cadastro (" + entry.name + ")"),
      project: info?.project ?? "Arquivo sem projeto (possível gravação recuperável)",
      file: blob,
      size: blob.size,
      expected: info?.size ?? null,
      mime: info?.mime ?? "application/octet-stream",
      originalStatus: info?.status ?? "sem registro",
      status: classifyRecoveredBytes(blob.size, info?.size ?? null),
    });
  }
}

export async function scanRecoveryFiles(): Promise<RecoveryFile[]> {
  if (!navigator.storage?.getDirectory) throw new Error("Este iPhone não disponibilizou o armazenamento de arquivos do PWA.");
  const [assets, projects, root] = await Promise.all([
    db.assets.toArray(),
    db.projects.toArray(),
    navigator.storage.getDirectory(),
  ]);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const known = knownAssets(assets, names);
  const result: RecoveryFile[] = [];
  // Include orphaned sources from failed imports, untracked media, and
  // videos already safeguarded by the new teleprompter vault.
  for (const name of ["media", "teleprompter-originals"]) {
    let directory: FileSystemDirectoryHandle;
    try { directory = await root.getDirectoryHandle(name); }
    catch (error) {
      if (error instanceof DOMException && error.name === "NotFoundError") continue;
      throw error;
    }
    try {
      await enumerate(directory, name + "/", result, known, 1200);
    } catch (err) {
      // Older WebKit builds may lack FileSystemDirectoryHandle.values().
      // Continue with explicit paths held by IndexedDB, never discard results.
      console.warn("OPFS directory enumeration unavailable; checking known files:", err);
    }
  }
  const found = new Set(result.map((r) => r.path));
  for (const [path, info] of known) {
    if (found.has(path)) continue;
    const blob = await readFile(path);
    if (!blob?.size) continue;
    result.push({
      path, name: info.name, project: info.project, file: blob,
      size: blob.size, expected: info.size, mime: info.mime,
      originalStatus: info.status, status: classifyRecoveredBytes(blob.size, info.size),
    });
  }
  return result.sort((a, b) => b.size - a.size);
}
