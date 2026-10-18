// Writes a File into OPFS with a sync access handle. Safari only allows
// sync handles inside workers, and they let us stream a large video to disk
// in chunks instead of holding it in memory.
// Only in the worker lib types, which this project does not load.
interface SyncAccessHandle {
  truncate(size: number): void;
  write(buffer: BufferSource, options?: { at?: number }): number;
  flush(): void;
  close(): void;
}

export interface WriteRequest {
  id: number;
  path: string;
  file: Blob;
}

self.onmessage = async (e: MessageEvent<WriteRequest>) => {
  const { id, path, file } = e.data;
  try {
    const parts = path.split("/");
    const name = parts.pop()!;
    let dir = await navigator.storage.getDirectory();
    for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
    const handle = await dir.getFileHandle(name, { create: true });
    const access: SyncAccessHandle = await (
      handle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> }
    ).createSyncAccessHandle();
    try {
      access.truncate(0);
      const reader = file.stream().getReader();
      let at = 0;
      let lastReport = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        access.write(value, { at });
        at += value.byteLength;
        if (at - lastReport > 2 * 1024 * 1024) {
          lastReport = at;
          self.postMessage({ id, progress: at / file.size });
        }
      }
      access.flush();
    } finally {
      access.close();
    }
    self.postMessage({ id, done: true });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};
