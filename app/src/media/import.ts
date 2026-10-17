// Importing media: copy into OPFS, read its metadata, make thumbnails.
import { ALL_FORMATS, BlobSource, CanvasSink, EncodedPacketSink, Input } from "mediabunny";
import { db, type AssetKind, type AssetRow, type Id } from "../data/db";
import { readFile, removeFile, writeFile } from "../data/opfs";

const THUMB_H = 104; // 2x the main track height

export class ImportError extends Error {}

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
    const width = video.displayWidth;
    const height = video.displayHeight;

    // Thumbnails come from key frames only: each one decodes a single frame
    // instead of everything since the previous key frame (slow in 4K).
    const count = Math.min(30, Math.max(2, Math.ceil(duration)));
    const packets = new EncodedPacketSink(video);
    const keyTimes = new Set<number>();
    for (let i = 0; i < count; i++) {
      const kp = await packets.getKeyPacket((duration * i) / count, { metadataOnly: true });
      if (kp) keyTimes.add(kp.timestamp);
    }
    const times = [...keyTimes].sort((a, b) => a - b);
    const sink = new CanvasSink(video, { height: THUMB_H, fit: "contain", poolSize: 1 });
    const blobs: Blob[] = [];
    const usedTimes: number[] = [];
    for await (const wc of sink.canvasesAtTimestamps(times)) {
      if (!wc) continue;
      blobs.push(await toJpeg(wc.canvas));
      usedTimes.push(wc.timestamp);
    }
    return {
      durationUs: Math.round(duration * 1e6),
      width,
      height,
      fps: stats.averagePacketRate ? Math.round(stats.averagePacketRate) : null,
      rotation: video.rotation,
      hasAudio: !!audio && (await audio.canDecode()),
      codec: await video.getCodecParameterString(),
      hdr: await video.hasHighDynamicRange(),
      thumbs: { times: usedTimes, blobs },
    };
  } finally {
    input.dispose();
  }
}

async function probeImage(file: File) {
  const bmp = await createImageBitmap(file).catch(() => {
    throw new ImportError("Este aparelho não consegue abrir esta imagem.");
  });
  const scale = THUMB_H / bmp.height;
  const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * scale)), THUMB_H);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  const out = { width: bmp.width, height: bmp.height, thumbs: { times: [0], blobs: [await toJpeg(c)] } };
  bmp.close();
  return out;
}

export interface ImportProgress {
  index: number; // 0-based file being imported
  total: number;
  fraction: number; // 0..1 of the whole batch
}

// Imports files in order. Files that fail are skipped and reported.
export async function importFiles(
  projectId: Id,
  files: File[],
  onProgress?: (p: ImportProgress) => void,
): Promise<{ assets: AssetRow[]; failed: { name: string; reason: string }[] }> {
  const assets: AssetRow[] = [];
  const failed: { name: string; reason: string }[] = [];

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const report = (f: number) => onProgress?.({ index: i, total: files.length, fraction: (i + f) / files.length });
    const kind = kindOf(file);
    if (!kind || kind === "audio") {
      failed.push({ name: file.name, reason: "Tipo de arquivo não suportado aqui." });
      continue;
    }
    const id = crypto.randomUUID();
    const opfsPath = `media/${projectId}/${id}`;
    const now = Date.now();
    try {
      report(0);
      // copy into the app and read the metadata at the same time
      const [, meta] = await Promise.all([
        writeFile(opfsPath, file, (p) => report(p * 0.95)),
        kind === "video"
          ? probeVideo(file)
          : probeImage(file).then((m) => ({ ...m, durationUs: 0, fps: null, rotation: 0 as const, hasAudio: false, codec: null, hdr: false })),
      ]);
      if (!(await readFile(opfsPath))) throw new ImportError("Não foi possível guardar o arquivo.");
      const row: AssetRow = {
        id,
        projectId,
        kind,
        opfsPath,
        name: file.name,
        mime: file.type || "application/octet-stream",
        sizeBytes: file.size,
        durationUs: meta.durationUs,
        width: meta.width,
        height: meta.height,
        fps: meta.fps,
        rotation: meta.rotation,
        hasAudio: meta.hasAudio,
        codec: meta.codec,
        hdr: meta.hdr,
        status: "ready",
        error: null,
        createdAt: now,
        updatedAt: now,
      };
      await db.transaction("rw", db.assets, db.derivatives, async () => {
        await db.assets.add(row);
        await db.derivatives.add({
          id: crypto.randomUUID(),
          assetId: id,
          kind: "thumbs",
          opfsPath: null,
          data: meta.thumbs.times,
          blobs: meta.thumbs.blobs,
          createdAt: now,
        });
      });
      assets.push(row);
      report(1);
    } catch (err) {
      await removeFile(opfsPath);
      const reason =
        err instanceof ImportError
          ? err.message
          : err instanceof DOMException && err.name === "QuotaExceededError"
            ? "Sem espaço no aparelho."
            : "Não foi possível importar.";
      if (!(err instanceof ImportError)) console.warn("import failed", file.name, err);
      failed.push({ name: file.name, reason });
    }
  }
  return { assets, failed };
}
