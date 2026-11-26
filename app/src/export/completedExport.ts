// Keep last finished MP4 available after a PWA reload; never delete originals.
import { readFile } from "../data/opfs";
import type { Id } from "../data/db";
const KEY = "garagem:latest-completed-export:v1";
export interface CompletedExport {
  projectId: Id;
  fileName: string;
  size: number;
  at: number;
}
export function readCompletedExportInfo(projectId: Id): CompletedExport | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as CompletedExport;
    if (d.projectId !== projectId || !/^video-[^/]+\.mp4$/.test(d.fileName) ||
      !Number.isSafeInteger(d.size) || d.size <= 0) return null;
    return d;
  } catch { return null; }
}
export async function loadCompletedExport(projectId: Id): Promise<File | null> {
  const info = readCompletedExportInfo(projectId);
  if (!info) return null;
  const file = await readFile("exports/" + info.fileName);
  if (!file || file.size !== info.size) return null;
  return new File([file], info.fileName, { type: "video/mp4" });
}
export async function rememberCompletedExport(projectId: Id, file: File) {
  const stored = await readFile("exports/" + file.name);
  if (!stored || stored.size !== file.size) return false;
  const info: CompletedExport = { projectId, fileName: file.name, size: file.size, at: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(info)); return true; }
  catch { return false; }
}
