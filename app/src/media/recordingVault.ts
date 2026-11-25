// The recorder stores every original take independently of the editor.
// No server uploads. Saved takes survive a PWA reload while the browser's
// local IndexedDB and OPFS data remain available.
import { db, type Id, type RecordingRow } from "../data/db";
import { readFile, writeFile } from "../data/opfs";

export interface TakeToSave {
  file: File;
  sessionId: Id;
  scriptId: Id;
  seconds: number;
  scrollStart: number;
  horizontal: boolean;
}

export async function storeRecordedTake(take: TakeToSave): Promise<RecordingRow> {
  const id = crypto.randomUUID();
  const now = Date.now();
  const row: RecordingRow = {
    id, sessionId: take.sessionId, scriptId: take.scriptId,
    opfsPath: "teleprompter-originals/" + id,
    name: take.file.name,
    mime: take.file.type,
    sizeBytes: take.file.size,
    seconds: take.seconds,
    scrollStart: take.scrollStart,
    horizontal: take.horizontal,
    status: "saving",
    error: null,
    createdAt: now,
  };
  // Record the file's location *before* copying. If Safari terminates
  // mid-copy the user can still find whatever bytes the worker wrote.
  await db.recordings.put(row);
  try {
    if (!take.file.size) throw new Error("A gravação não contém dados.");
    await writeFile(row.opfsPath, take.file);
    const onDisk = await readFile(row.opfsPath);
    if (!onDisk || onDisk.size !== take.file.size) {
      throw new Error("Arquivo incompleto no armazenamento do iPhone.");
    }
    await db.recordings.update(id, { status: "ready", error: null });
    return { ...row, status: "ready" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    try { await db.recordings.update(id, { status: "error", error: reason }); } catch { /* preserve caller's File */ }
    throw new Error("Não consegui guardar este trecho no iPhone: " + reason);
  }
}

export async function savedTakeFile(row: RecordingRow): Promise<File | null> {
  const existing = await readFile(row.opfsPath);
  if (!existing?.size) return null;
  const mime = row.mime || "video/mp4";
  // A failed/partial MP4 may need external repair. Never discard it.
  return new File([existing.slice(0, existing.size, mime)], row.name, { type: mime });
}

export async function listSavedTakes(): Promise<RecordingRow[]> {
  return db.recordings.orderBy("createdAt").reverse().toArray();
}
