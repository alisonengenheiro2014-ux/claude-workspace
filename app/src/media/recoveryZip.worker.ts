// Dedicated worker for ZIP recovery. Reads all original Files without
// holding them in RAM, writes a *new* ZIP within recovery-zip/ only.
import { writeRecoveryZip, type RecoveryZipEntry } from "./recoveryZip";

interface SyncAccessHandle {
  truncate(size: number): void;
  write(buffer: BufferSource, options?: { at?: number }): number;
  flush(): void;
  close(): void;
}
type Start = { entries: RecoveryZipEntry[]; name: string };
self.onmessage = async (event: MessageEvent<Start>) => {
  const { entries, name } = event.data;
  let access: SyncAccessHandle | null = null;
  let directory: FileSystemDirectoryHandle | null = null;
  let position = 0;
  let lastReport = 0;
  try {
    if (!/^garagem-resgate-[a-z0-9-]+\.zip$/.test(name)) throw new Error("Nome do ZIP inválido.");
    const root = await navigator.storage.getDirectory();
    directory = await root.getDirectoryHandle("recovery-zip", { create: true });
    const handle = await directory.getFileHandle(name, { create: true });
    access = await (handle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> }).createSyncAccessHandle();
    access.truncate(0);
    const result = await writeRecoveryZip(entries, (bytes) => {
      // OPFS write() is allowed to write fewer bytes than requested.
      let consumed = 0;
      while (consumed < bytes.length) {
        const n = access!.write(bytes.subarray(consumed) as Uint8Array<ArrayBuffer>, { at: position + consumed });
        if (n <= 0) throw new Error("O iPhone não conseguiu escrever todos os bytes do ZIP.");
        consumed += n;
      }
      position += bytes.length;
    }, (progress) => {
      if (progress.readBytes - lastReport > 4 * 1024 * 1024 || progress.readBytes === progress.totalBytes) {
        lastReport = progress.readBytes;
        self.postMessage({ type: "progress", ...progress });
      }
    });
    access.flush();
    access.close();
    access = null;
    self.postMessage({ type: "done", bytes: position, count: result.files, name });
  } catch (err) {
    try { access?.close(); } catch { /* may already be closed */ }
    // This directory only contains generated ZIPs. Never remove "media" or
    // "teleprompter-originals", even when there is an I/O failure.
    try { await directory?.removeEntry(name); } catch { /* keep partial ZIP */ }
    self.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
