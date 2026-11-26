// Recover Whisper work after iOS suspends or terminates the PWA.
// LocalStorage contains only small timestamp/text arrays, never recorded
// videos or audio; media remains in the iPhone's OPFS.
import type { AssetRow, Id, TimelineDoc } from "../data/db";
import type { CaptionSource } from "./transcribe";
import type { AsrModel } from "./asr.worker";
import type { SpeechSegment } from "../editor/timeline";

const KEY_PREFIX = "garagem:caption:checkpoint:v1:";
export interface CaptionCheckpoint {
  version: 1;
  signature: string;
  nextWindow: number;
  totalWindows: number;
  segments: SpeechSegment[];
  updatedAt: number;
}
export interface CaptionRun {
  projectId: Id;
  doc: TimelineDoc;
  assets: Map<Id, AssetRow>;
  language: string | null;
  source: CaptionSource;
  model: AsrModel;
}
function hashText(value: string): string {
  // djb2 variant with deterministic UTF-16 inputs, no crypto async overhead
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = (Math.imul(hash, 33) ^ value.charCodeAt(i)) >>> 0;
  return hash.toString(16).padStart(8, "0") + "-" + value.length.toString(16);
}
export function captionSignature(run: CaptionRun) {
  const media = Array.from(run.assets.values())
    .map((a) => [a.id, a.opfsPath, a.sizeBytes, a.updatedAt, a.durationUs])
    .sort(([a], [b]) => String(a).localeCompare(String(b)));
  return hashText(JSON.stringify([run.projectId, run.doc, media, run.language, run.source, run.model]));
}
export function checkpointKey(projectId: Id) {
  return KEY_PREFIX + projectId;
}
export function inspectCaptionCheckpoint(run: CaptionRun): CaptionCheckpoint | null {
  try {
    const raw = localStorage.getItem(checkpointKey(run.projectId));
    if (!raw) return null;
    const c = JSON.parse(raw) as CaptionCheckpoint;
    if (c.version !== 1 || c.signature !== captionSignature(run) ||
      !Number.isSafeInteger(c.nextWindow) || !Number.isSafeInteger(c.totalWindows) ||
      c.nextWindow < 1 || c.totalWindows < c.nextWindow || !Array.isArray(c.segments)) return null;
    return c;
  } catch { return null; }
}
export function projectHasCaptionCheckpoint(projectId: Id): boolean {
  try {
    const raw = localStorage.getItem(checkpointKey(projectId));
    if (!raw) return false;
    const c = JSON.parse(raw) as CaptionCheckpoint;
    return c.version === 1 && c.nextWindow > 0 && c.totalWindows >= c.nextWindow;
  } catch { return false; }
}
export function saveCaptionCheckpoint(run: CaptionRun, nextWindow: number, totalWindows: number, segments: SpeechSegment[]) {
  if (!Number.isSafeInteger(nextWindow) || nextWindow < 1 || nextWindow > totalWindows) return false;
  const checkpoint: CaptionCheckpoint = {
    version: 1, signature: captionSignature(run), nextWindow, totalWindows,
    segments: segments.map((s) => ({ start: s.start, end: s.end, text: s.text })),
    updatedAt: Date.now(),
  };
  try { localStorage.setItem(checkpointKey(run.projectId), JSON.stringify(checkpoint)); return true; }
  catch { return false; }
}
export function clearCaptionCheckpoint(projectId: Id) {
  try { localStorage.removeItem(checkpointKey(projectId)); } catch { /* private browsing */ }
}
export function checkpointPercent(checkpoint: CaptionCheckpoint | null) {
  return checkpoint && checkpoint.totalWindows > 0
    ? Math.floor((checkpoint.nextWindow / checkpoint.totalWindows) * 100)
    : 0;
}
