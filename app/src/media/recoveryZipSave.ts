// Creates ONE ZIP in separate OPFS recovery-zip directory, using a dedicated
// worker so 1 GB+ of source video never enters main-thread JS memory.
import { readFile } from "../data/opfs";
import { estimateZipSize, recoveryZipEntries, type RecoveryZipEntry, type ZipProgress } from "./recoveryZip";
import type { RecoveryFile } from "./recoveryScan";

export interface PreparedRecoveryZip {
  name: string;
  path: string;
  file: File;
  size: number;
  count: number;
  signature: string;
}
export function recoveryZipSignature(files: RecoveryFile[]) {
  return files.map((f) => f.path + ":" + f.size).join("\n");
}
const LAST_KEY = "g100:recovery-zip:last:v1";
const archiveNameOk = (name: string) => /^garagem-resgate-[a-z0-9-]+\.zip$/.test(name);
export async function lastRecoveryZip(): Promise<PreparedRecoveryZip | null> {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    if (!raw) return null;
    const data: { name: string; bytes: number; count: number; signature: string } = JSON.parse(raw);
    if (!archiveNameOk(data.name) || !Number.isFinite(data.bytes) || !Number.isInteger(data.count) || typeof data.signature !== "string") return null;
    const file = await readFile("recovery-zip/" + data.name);
    if (!file || file.size !== data.bytes) return null;
    return { name: data.name, path: "recovery-zip/" + data.name, file, size: file.size, count: data.count, signature: data.signature };
  } catch { return null; }
}
export async function prepareRecoveryZip(
  files: RecoveryFile[],
  onProgress: (progress: ZipProgress) => void,
): Promise<PreparedRecoveryZip> {
  if (!files.length) throw new Error("Não há arquivos para baixar.");
  const signature = recoveryZipSignature(files);
  const old = await lastRecoveryZip();
  if (old && old.signature === signature) return old; // don't waste 1 GB generating duplicates
  const entries: RecoveryZipEntry[] = recoveryZipEntries(files);
  const expectedBytes = estimateZipSize(entries);
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.quota !== undefined && estimate.usage !== undefined &&
      estimate.quota - estimate.usage < expectedBytes + 40 * 1024 * 1024) {
    const available = Math.max(0, estimate.quota - estimate.usage);
    throw new Error("Sem espaço suficiente no armazenamento do PWA para criar o ZIP (" +
      Math.round(available / 1e6) + " MB livres, precisa de aproximadamente " +
      Math.round((expectedBytes + 40 * 1024 * 1024) / 1e6) + " MB). " +
      "Os vídeos originais permanecem intactos; salve-os individualmente.");
  }
  const name = "garagem-resgate-" + crypto.randomUUID() + ".zip";
  const path = "recovery-zip/" + name;
  const result = await new Promise<{ bytes: number; count: number }>((resolve, reject) => {
    const worker = new Worker(new URL("./recoveryZip.worker.ts", import.meta.url), { type: "module" });
    let finished = false;
    let timeout: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    const fail = (error: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(error);
    };
    const watch = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fail(new Error(
        "O iPhone parou de responder durante a criação do ZIP. " +
        "Os originais continuam no armazenamento; tente novamente mais tarde."
      )), 180_000);
    };
    worker.onerror = (ev) => {
      ev.preventDefault();
      fail(new Error("Falha no processo que prepara o ZIP."));
    };
    worker.onmessageerror = () => fail(new Error("O iPhone não conseguiu ler a resposta da criação do ZIP."));
    worker.onmessage = (ev: MessageEvent<
      { type: "progress" } & ZipProgress |
      { type: "done"; bytes: number; count: number } |
      { type: "error"; message: string }
    >) => {
      const data = ev.data;
      if (data.type === "progress") {
        watch();
        onProgress(data);
      } else if (data.type === "done") {
        if (finished) return;
        finished = true;
        cleanup();
        resolve({ bytes: data.bytes, count: data.count });
      } else if (data.type === "error") {
        fail(new Error(data.message));
      }
    };
    watch();
    try { worker.postMessage({ entries, name }); }
    catch (err) { fail(err instanceof Error ? err : new Error(String(err))); }
  });
  if (result.bytes !== expectedBytes || result.count !== files.length)
    throw new Error("O ZIP foi gerado com tamanho incorreto. Os arquivos originais não foram alterados.");
  const file = await readFile(path);
  if (!file || file.size !== expectedBytes)
    throw new Error("O ZIP não ficou completamente armazenado. Os vídeos originais permanecem disponíveis.");
  // One small EOCD check avoids reporting an obviously incomplete archive.
  const tail = new DataView(await file.slice(file.size - 22).arrayBuffer());
  if (tail.getUint32(0, true) !== 0x06054b50 || tail.getUint16(10, true) !== files.length)
    throw new Error("O índice do ZIP não pôde ser verificado. Preserve os arquivos originais.");
  try { localStorage.setItem(LAST_KEY, JSON.stringify({ name, bytes: file.size, count: files.length, signature })); }
  catch { /* ZIP itself remains in OPFS */ }
  return { name, path, file, size: file.size, count: files.length, signature };
}
