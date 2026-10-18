// Media files live in OPFS (the browser's private file system), not in
// IndexedDB, because videos are too large to hold as one blob.

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: () => void; reject: (e: Error) => void; onProgress?: (p: number) => void }>();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./opfs.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; done?: boolean; error?: string; progress?: number }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      if (e.data.progress !== undefined) p.onProgress?.(e.data.progress);
      else if (e.data.error) {
        pending.delete(e.data.id);
        p.reject(new Error(e.data.error));
      } else if (e.data.done) {
        pending.delete(e.data.id);
        p.resolve();
      }
    };
  }
  return worker;
}

export function writeFile(path: string, file: Blob, onProgress?: (p: number) => void): Promise<void> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, path, file });
  });
}

async function resolveFile(path: string, create = false) {
  const parts = path.split("/");
  const name = parts.pop()!;
  let dir = await navigator.storage.getDirectory();
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return { dir, name };
}

export async function readFile(path: string): Promise<File | null> {
  try {
    const { dir, name } = await resolveFile(path);
    return await (await dir.getFileHandle(name)).getFile();
  } catch {
    return null;
  }
}

export async function removeFile(path: string): Promise<void> {
  try {
    const { dir, name } = await resolveFile(path);
    await dir.removeEntry(name);
  } catch {
    // already gone
  }
}

export async function storageInfo() {
  const est = await navigator.storage?.estimate?.();
  const persisted = (await navigator.storage?.persisted?.()) ?? false;
  return { usage: est?.usage ?? 0, quota: est?.quota ?? 0, persisted };
}

// Ask once; Safari tends to grant it to a home-screen web app.
export async function requestPersistence() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // not supported; the backup feature is the safety net
  }
}

// A WritableStream into an OPFS file, for the export (mediabunny's
// StreamTarget writes { data, position } chunks). Each write waits for the
// worker, which keeps memory flat and lets the encoder slow down to the disk.
export async function openStreamFile(path: string) {
  const w = new Worker(new URL("./opfs-stream.worker.ts", import.meta.url), { type: "module" });
  let next = 1;
  const calls = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  w.onmessage = (e: MessageEvent<{ id: number; ok?: boolean; error?: string }>) => {
    const c = calls.get(e.data.id);
    if (!c) return;
    calls.delete(e.data.id);
    if (e.data.error) c.reject(new Error(e.data.error));
    else c.resolve();
  };
  const call = (msg: object, transfer: Transferable[] = []) =>
    new Promise<void>((resolve, reject) => {
      const id = next++;
      calls.set(id, { resolve, reject });
      w.postMessage({ ...msg, id }, transfer);
    });
  await call({ op: "open", path });
  const stream = new WritableStream<{ type: "write"; data: Uint8Array; position: number }>({
    write: (chunk) => {
      const copy = chunk.data.slice(); // the encoder may reuse its buffer
      return call({ op: "write", data: copy, position: chunk.position }, [copy.buffer]);
    },
    close: async () => {
      await call({ op: "close" });
      w.terminate();
    },
    abort: async () => {
      await call({ op: "abort" }).catch(() => {});
      w.terminate();
    },
  });
  return stream;
}

// Old exports are deleted when a new one starts: only the latest is kept.
export async function clearDir(name: string) {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(name, { recursive: true });
  } catch {
    // nothing there
  }
}
