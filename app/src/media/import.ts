// Importing media in two steps, so editing can start right away:
//   1. startImport(): read only the metadata (a fraction of a second), save
//      the asset as "importing" and keep the picked File in memory.
//   2. In the background, one file at a time: make thumbnails, then copy the
//      file into OPFS. When the copy is done the asset becomes "ready".
// Until then, assetFile() hands the in-memory File to the preview and the
// export, so nothing waits for the copy.
import { ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink, Input } from "mediabunny";
import { db, type AssetKind, type AssetRow, type Id } from "../data/db";
import { readFile, removeFile, writeFile } from "../data/opfs";

const THUMB_H = 104; // 2x the main track height

export class ImportError extends Error {}

export type ImportEvent =
  | { type: "thumbs"; assetId: Id; times: number[]; blobs: Blob[] }
  | { type: "progress"; assetId: Id; fraction: number }
  | { type: "ready"; asset: AssetRow }
  | { type: "error"; assetId: Id; name: string; reason: string };

const listeners = new Set<(e: ImportEvent) => void>();
export function onImportEvent(fn: (e: ImportEvent) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
function emit(e: ImportEvent) {
  for (const fn of listeners) fn(e);
}

// Files picked this session whose copy into OPFS has not finished, and the
// ones whose copy finished this session (callers may still hold the old
// "importing" row, e.g. an export that started before the copy ended).
const pending = new Map<Id, File>();
const copied = new Set<Id>();

export function isPending(assetId: Id) {
  return pending.has(assetId);
}

// The file behind an asset: the picked File while it is still being copied,
// the OPFS copy afterwards. null when it is gone (the app was closed in the
// middle of a copy, or storage was cleared).
export async function assetFile(asset: AssetRow): Promise<File | null> {
  const inMemory = pending.get(asset.id);
  if (inMemory) return inMemory;
  if (asset.status !== "ready" && !copied.has(asset.id)) return null;
  const stored = await readFile(asset.opfsPath);
  return stored && withType(stored, asset);
}

const MIME_BY_EXT: Record<string, string> = {
  mov: "video/quicktime",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  webm: "video/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  heic: "image/heic",
  webp: "image/webp",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  wav: "audio/wav",
};

// Files read back from OPFS have no type (our paths have no extension), and
// Safari will not play a video from a blob URL without one: the preview of a
// reopened project stayed black. Give the file back the type it came with.
function withType(file: File, asset: AssetRow): File {
  if (file.type) return file;
  const ext = asset.name.split(".").pop()?.toLowerCase() ?? "";
  const type = asset.mime && asset.mime !== "application/octet-stream" ? asset.mime : (MIME_BY_EXT[ext] ?? "");
  if (!type) return file;
  // slice() makes a typed view of the same bytes, nothing is copied
  return new File([file.slice(0, file.size, type)], asset.name, { type, lastModified: file.lastModified });
}

function kindOf(file: File): AssetKind | null {
  if (file.type.startsWith("video/") || /\.(mov|mp4|m4v|webm)$/i.test(file.name)) return "video";
  if (file.type.startsWith("image/") || /\.(jpe?g|png|heic|heif|webp|gif)$/i.test(file.name)) return "image";
  if (file.type.startsWith("audio/") || /\.(m4a|mp3|aac|wav|ogg|opus)$/i.test(file.name)) return "audio";
  return null;
}

async function toJpeg(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/jpeg", quality: 0.7 });
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("thumbnail failed"))), "image/jpeg", 0.7),
  );
}

async function probeVideo(file: File) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video) throw new ImportError("O arquivo não tem vídeo.");
    if (!(await video.canDecode())) throw new ImportError("Este aparelho não consegue ler o formato deste vídeo.");
    const duration = await input.computeDuration();
    const stats = await video.computePacketStats(60);
    return {
      durationUs: Math.round(duration * 1e6),
      width: video.displayWidth,
      height: video.displayHeight,
      fps: stats.averagePacketRate ? Math.round(stats.averagePacketRate) : null,
      rotation: video.rotation,
      hasAudio: !!audio && (await audio.canDecode()),
      codec: await video.getCodecParameterString(),
      hdr: await video.hasHighDynamicRange(),
    };
  } finally {
    input.dispose();
  }
}

async function probeAudio(file: File) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const audio = await input.getPrimaryAudioTrack().catch(() => null);
    if (!audio) throw new ImportError("Não encontrei áudio neste arquivo.");
    if (!(await audio.canDecode())) throw new ImportError("Este aparelho não consegue ler o formato deste áudio.");
    const duration = await input.computeDuration();
    return {
      durationUs: Math.round(duration * 1e6),
      width: 0,
      height: 0,
      fps: null,
      rotation: 0 as const,
      hasAudio: true,
      codec: await audio.getCodecParameterString(),
      hdr: false,
    };
  } finally {
    input.dispose();
  }
}

async function probeImage(file: File) {
  const bmp = await createImageBitmap(file).catch(() => {
    throw new ImportError("Este aparelho não consegue abrir esta imagem.");
  });
  const out = { width: bmp.width, height: bmp.height };
  bmp.close();
  return { ...out, durationUs: 0, fps: null, rotation: 0 as const, hasAudio: false, codec: null, hdr: false };
}

// Thumbnails come from key frames only: each one decodes a single frame
// instead of everything since the previous key frame (slow in 4K).
// Two passes so the timeline fills in fast: a few spread-out frames first,
// then the rest. onPartial gets everything made so far after each pass.
async function videoThumbs(file: File, onPartial: (t: { times: number[]; blobs: Blob[] }) => void) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = (await input.getPrimaryVideoTrack())!;
    const duration = await input.computeDuration();
    const count = Math.min(30, Math.max(2, Math.ceil(duration)));
    const packets = new EncodedPacketSink(video);
    const keyTimes = new Set<number>();
    for (let i = 0; i < count; i++) {
      const kp = await packets.getKeyPacket((duration * i) / count, { metadataOnly: true });
      if (kp) keyTimes.add(kp.timestamp);
    }
    const sink = new CanvasSink(video, { height: THUMB_H, fit: "contain", poolSize: 1 });
    const all = [...keyTimes].sort((a, b) => a - b);
    const step = Math.max(1, Math.floor(all.length / 6));
    const first = all.filter((_, i) => i % step === 0);
    const rest = all.filter((_, i) => i % step !== 0);
    const made: { t: number; blob: Blob }[] = [];
    const snapshot = () => {
      made.sort((a, b) => a.t - b.t);
      return { times: made.map((m) => m.t), blobs: made.map((m) => m.blob) };
    };
    for (const pass of [first, rest]) {
      if (!pass.length) continue;
      for await (const wc of sink.canvasesAtTimestamps(pass)) {
        if (wc) made.push({ t: wc.timestamp, blob: await toJpeg(wc.canvas) });
      }
      onPartial(snapshot());
    }
    return snapshot();
  } finally {
    input.dispose();
  }
}

async function imageThumbs(file: File) {
  const bmp = await createImageBitmap(file);
  const c = new OffscreenCanvas(Math.max(1, Math.round((bmp.width * THUMB_H) / bmp.height)), THUMB_H);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return { times: [0], blobs: [await toJpeg(c)] };
}

function reasonOf(err: unknown) {
  if (err instanceof ImportError) return err.message;
  if (err instanceof DOMException && err.name === "QuotaExceededError") return "Sem espaço no aparelho.";
  console.warn("import failed", err);
  return "Não foi possível importar.";
}

// ---------- background queue ----------

const queue: { asset: AssetRow; file: File }[] = [];
let running = false;

// Thumbnails and the copy run side by side: one decodes, the other writes.
async function work(asset: AssetRow, file: File) {
  const copy = writeFile(asset.opfsPath, file, (fraction) => emit({ type: "progress", assetId: asset.id, fraction }));
  copy.catch(() => {}); // awaited below; avoid an unhandled rejection meanwhile
  if (asset.kind === "audio") return finishCopy(asset, file, copy);
  const thumbs =
    asset.kind === "video"
      ? await videoThumbs(file, (t) => emit({ type: "thumbs", assetId: asset.id, ...t }))
      : await imageThumbs(file);
  await db.derivatives.add({
    id: crypto.randomUUID(),
    assetId: asset.id,
    kind: "thumbs",
    opfsPath: null,
    data: thumbs.times,
    blobs: thumbs.blobs,
    createdAt: Date.now(),
  });
  emit({ type: "thumbs", assetId: asset.id, ...thumbs });
  return finishCopy(asset, file, copy);
}

async function finishCopy(asset: AssetRow, file: File, copy: Promise<void>) {
  await copy;
  const stored = await readFile(asset.opfsPath);
  if (!stored || stored.size !== file.size) throw new ImportError("Não foi possível guardar o arquivo.");
  // the project may have been deleted while we were copying
  if (!(await db.assets.get(asset.id))) {
    await removeFile(asset.opfsPath);
    return;
  }
  const ready: AssetRow = { ...asset, status: "ready", updatedAt: Date.now() };
  await db.assets.update(asset.id, { status: "ready", updatedAt: ready.updatedAt });
  copied.add(asset.id);
  pending.delete(asset.id);
  emit({ type: "ready", asset: ready });
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const { asset, file } = queue.shift()!;
    try {
      await work(asset, file);
    } catch (err) {
      const reason = reasonOf(err);
      await db.assets.update(asset.id, { status: "error", error: reason, updatedAt: Date.now() }).catch(() => {});
      await removeFile(asset.opfsPath);
      // keep the File in memory: this session can still edit and export it
      emit({ type: "error", assetId: asset.id, name: asset.name, reason });
    }
  }
  running = false;
}

export function importsInProgress() {
  return pending.size;
}

// Warn before the page is closed while copies are running.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (e) => {
    if (pending.size) e.preventDefault();
  });
}

// ---------- step 1 ----------

export async function startImport(
  projectId: Id,
  files: File[],
  options: { only?: "audio" } = {},
): Promise<{ assets: AssetRow[]; failed: { name: string; reason: string }[] }> {
  const assets: AssetRow[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const file of files) {
    const kind = kindOf(file);
    if (!kind || (kind === "audio") !== (options.only === "audio")) {
      failed.push({
        name: file.name,
        reason: options.only === "audio" ? "Escolha um arquivo de áudio (mp3, m4a ou wav)." : "Tipo de arquivo não suportado aqui.",
      });
      continue;
    }
    try {
      const meta = kind === "video" ? await probeVideo(file) : kind === "audio" ? await probeAudio(file) : await probeImage(file);
      const id = crypto.randomUUID();
      const now = Date.now();
      const row: AssetRow = {
        id,
        projectId,
        kind,
        opfsPath: `media/${projectId}/${id}`,
        name: file.name,
        mime: file.type || "application/octet-stream",
        sizeBytes: file.size,
        ...meta,
        status: "importing",
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      await db.assets.add(row);
      pending.set(id, file);
      queue.push({ asset: row, file });
      assets.push(row);
    } catch (err) {
      failed.push({ name: file.name, reason: reasonOf(err) });
    }
  }
  void drain();
  return { assets, failed };
}
