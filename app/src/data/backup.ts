// Project backups (one file you keep in Arquivos/iCloud): the project, its
// timeline and every media file in a single file. Safari may clear a web
// app's storage when the phone is short of space; a backup survives that.
//
// Format: "GARAGEM-BACKUP-1\n", the header's length as 12 digits, the
// header (JSON), then the media files one after the other. The files are
// referenced, never read into memory: a Blob of Blobs, and slices on restore.
import type { AssetRow, Id, ProjectRow, TimelineDoc } from "./db";
import { loadProject, saveDoc, createProject, renameProject } from "./projects";
import { assetFile, startImport } from "../media/import";

const MAGIC = "GARAGEM-BACKUP-1\n";

interface Header {
  version: 1;
  project: Pick<ProjectRow, "name" | "aspectRatio" | "fps">;
  doc: TimelineDoc;
  assets: { id: Id; name: string; mime: string; kind: AssetRow["kind"]; size: number }[];
}

export async function makeBackup(projectId: Id): Promise<File> {
  const p = await loadProject(projectId);
  if (!p) throw new Error("Projeto não encontrado.");
  const files: File[] = [];
  const assets: Header["assets"] = [];
  for (const a of p.assets) {
    const f = await assetFile(a);
    if (!f) continue; // missing media: the clip will show as missing
    files.push(f);
    assets.push({ id: a.id, name: a.name, mime: a.mime || f.type, kind: a.kind, size: f.size });
  }
  const header: Header = { version: 1, project: { name: p.project.name, aspectRatio: p.project.aspectRatio, fps: p.project.fps }, doc: p.doc, assets };
  const json = new TextEncoder().encode(JSON.stringify(header));
  const len = String(json.length).padStart(12, "0");
  const safe = p.project.name.replace(/[^\p{L}\p{N} _-]/gu, "").trim() || "projeto";
  return new File([MAGIC, len, json, ...files], `${safe}.garagem`, { type: "application/octet-stream" });
}

export async function restoreBackup(file: File): Promise<Id> {
  const head = await file.slice(0, MAGIC.length + 12).text();
  if (!head.startsWith(MAGIC)) throw new Error("Esse arquivo não é um backup do editor.");
  const len = Number(head.slice(MAGIC.length));
  let at = MAGIC.length + 12;
  const header = JSON.parse(await file.slice(at, at + len).text()) as Header;
  at += len;
  // the media come back through the normal import (metadata, thumbnails, copy)
  const media = header.assets.map((a) => {
    const f = new File([file.slice(at, at + a.size)], a.name, { type: a.mime });
    at += a.size;
    return { a, f };
  });
  const project = await createProject();
  await renameProject(project.id, header.project.name);
  const idMap = new Map<Id, Id>();
  for (const only of [undefined, "audio"] as const) {
    const part = media.filter((m) => (m.a.kind === "audio") === (only === "audio"));
    if (!part.length) continue;
    const { assets } = await startImport(project.id, part.map((m) => m.f), only ? { only } : {});
    // by name and order: a file that failed to import is simply missing
    const left = [...assets];
    for (const m of part) {
      const i = left.findIndex((x) => x.name === m.f.name);
      if (i >= 0) idMap.set(m.a.id, left.splice(i, 1)[0].id);
    }
  }
  let json = JSON.stringify(header.doc);
  for (const [from, to] of idMap) json = json.split(from).join(to);
  await saveDoc(project.id, JSON.parse(json) as TimelineDoc);
  return project.id;
}

// Hands the backup to the iOS share sheet (Salvar em Arquivos), or downloads it.
export async function shareFile(file: File) {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: file.name });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
