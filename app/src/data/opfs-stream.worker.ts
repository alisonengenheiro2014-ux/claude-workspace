// Streams the export straight into an OPFS file (S17): each chunk is written
// at its position with a sync access handle, so a long video never sits in
// memory as a whole.
interface SyncAccessHandle {
  truncate(size: number): void;
  write(buffer: BufferSource, options?: { at?: number }): number;
  flush(): void;
  close(): void;
}

export type StreamMsg =
  | { op: "open"; path: string }
  | { op: "write"; data: Uint8Array<ArrayBuffer>; position: number }
  | { op: "close" }
  | { op: "abort" };

let access: SyncAccessHandle | null = null;

self.onmessage = async (e: MessageEvent<StreamMsg & { id: number }>) => {
  const m = e.data;
  try {
    if (m.op === "open") {
      const parts = m.path.split("/");
      const name = parts.pop()!;
      let dir = await navigator.storage.getDirectory();
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const handle = await dir.getFileHandle(name, { create: true });
      access = await (handle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncAccessHandle> }).createSyncAccessHandle();
      access.truncate(0);
    } else if (m.op === "write") access!.write(m.data, { at: m.position });
    else if (m.op === "close" || m.op === "abort") {
      access?.flush();
      access?.close();
      access = null;
    }
    self.postMessage({ id: m.id, ok: true });
  } catch (err) {
    self.postMessage({ id: m.id, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};
