// Local database and timeline document for the video editor PWA.
// Started as replica/schema.ts; this file is now the source of truth.
// Everything lives on the device: IndexedDB (via Dexie) for records,
// OPFS for media files. Single user, so there is no owner column.
//
// Units: wall-clock times are ms since epoch (UTC). Times inside a video
// are integer microseconds (the unit WebCodecs uses).

import Dexie, { type Table } from "dexie";

export type Id = string; // crypto.randomUUID()
export type Us = number; // integer microseconds

// ---------- stores ----------

export type AspectRatio = "9:16" | "16:9" | "1:1" | "4:5" | "4:3" | "original";

export interface ProjectRow {
  id: Id;
  name: string;
  aspectRatio: AspectRatio;
  fps: 24 | 25 | 30 | 50 | 60;
  durationUs: Us; // derived from the doc, cached for the drafts list
  thumbAssetKey: string | null; // OPFS path of the cover thumbnail
  docVersion: number; // bumped on every save
  template?: boolean; // a project kept as a starting point (Modelos)
  photo?: boolean; // Editar foto: one picture, saved as a photo
  createdAt: number;
  updatedAt: number;
}

export interface ProjectDocRow {
  projectId: Id;
  doc: TimelineDoc;
  savedAt: number;
}

export type AssetKind = "video" | "image" | "audio";
export type AssetStatus = "importing" | "ready" | "missing" | "error";

export interface AssetRow {
  id: Id;
  projectId: Id;
  kind: AssetKind;
  opfsPath: string;
  name: string;
  mime: string;
  sizeBytes: number;
  durationUs: Us; // 0 for images
  width: number;
  height: number;
  fps: number | null;
  rotation: 0 | 90 | 180 | 270;
  hasAudio: boolean;
  codec: string | null; // e.g. "hvc1.2.4.L153.B0"
  hdr?: boolean; // iPhone default recording (Dolby Vision / HLG)
  status: AssetStatus;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export type DerivativeKind = "thumbs" | "waveform" | "proxy";

export interface DerivativeRow {
  id: Id;
  assetId: Id;
  kind: DerivativeKind;
  opfsPath: string | null; // proxy video
  data: number[] | null; // waveform peaks, or the source time (s) of each thumb
  blobs: Blob[] | null; // thumbnail JPEGs
  createdAt: number;
}

export type ExportStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface ExportSettings {
  height: 480 | 720 | 1080 | 1440 | 2160;
  fps: 24 | 25 | 30 | 50 | 60;
  bitrate: number; // bits per second
  codec: "avc" | "hevc";
}

export interface ExportRow {
  id: Id;
  projectId: Id;
  settings: ExportSettings;
  status: ExportStatus;
  progress: number; // 0..1
  outputPath: string | null;
  sizeBytes: number | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface HistoryRow {
  id: Id;
  projectId: Id;
  seq: number;
  label: string; // "Dividir", "Velocidade", ...
  patches: unknown[]; // Immer patches
  inversePatches: unknown[];
  createdAt: number;
}

export const HISTORY_LIMIT = 200;
// steps of undo kept with the project, so ↶ still works after reopening it
export const SAVED_HISTORY = 50;

// The undo and redo stacks of a project, as whole docs.
export interface UndoRow {
  projectId: Id;
  past: { doc: TimelineDoc; label: string }[];
  future: { doc: TimelineDoc; label: string }[];
  savedAt: number;
}

export class EditorDB extends Dexie {
  projects!: Table<ProjectRow, Id>;
  projectDocs!: Table<ProjectDocRow, Id>;
  assets!: Table<AssetRow, Id>;
  derivatives!: Table<DerivativeRow, Id>;
  exports!: Table<ExportRow, Id>;
  history!: Table<HistoryRow, Id>;
  undo!: Table<UndoRow, Id>;

  constructor() {
    super("editor");
    this.version(1).stores({
      projects: "id, updatedAt",
      projectDocs: "projectId",
      assets: "id, projectId, [projectId+kind], status",
      derivatives: "id, assetId, [assetId+kind]",
      exports: "id, projectId, status",
      history: "id, projectId, [projectId+seq]",
    });
    // duplicated projects share media files, so deletes check opfsPath
    this.version(2).stores({
      assets: "id, projectId, [projectId+kind], status, opfsPath",
    });
    this.version(3).stores({ undo: "projectId" });
  }
}

export const db = new EditorDB();

// Cascade: a project owns its doc, assets, derivatives, exports and history.
// Returns the OPFS paths to delete once the transaction has committed.
export async function deleteProject(projectId: Id): Promise<string[]> {
  return db.transaction(
    "rw",
    [db.projects, db.projectDocs, db.assets, db.derivatives, db.exports, db.history, db.undo],
    async () => {
      const assets = await db.assets.where("projectId").equals(projectId).toArray();
      const assetIds = assets.map((a) => a.id);
      const derivs = await db.derivatives.where("assetId").anyOf(assetIds).toArray();
      const exps = await db.exports.where("projectId").equals(projectId).toArray();
      const paths = [
        ...assets.map((a) => a.opfsPath),
        ...derivs.flatMap((d) => (d.opfsPath ? [d.opfsPath] : [])),
        ...exps.flatMap((e) => (e.outputPath ? [e.outputPath] : [])),
      ];
      await db.derivatives.where("assetId").anyOf(assetIds).delete();
      await db.assets.where("projectId").equals(projectId).delete();
      await db.exports.where("projectId").equals(projectId).delete();
      await db.history.where("projectId").equals(projectId).delete();
      await db.undo.delete(projectId);
      await db.projectDocs.delete(projectId);
      await db.projects.delete(projectId);
      // keep files another project still points at
      const shared = new Set(
        (await db.assets.where("opfsPath").anyOf(assets.map((a) => a.opfsPath)).toArray()).map((a) => a.opfsPath),
      );
      return paths.filter((p) => !shared.has(p));
    },
  );
}

// ---------- timeline document ----------

export interface TimelineDoc {
  version: 1;
  canvas: {
    aspectRatio: AspectRatio;
    width: number;
    height: number;
    background:
      | { type: "color"; color: string }
      | { type: "blur"; amount: number }
      | { type: "gradient"; colors: [string, string]; angle: number }
      | { type: "image"; assetId: Id };
  };
  tracks: Track[]; // drawn bottom to top in array order
  transitions: Transition[];
  // Capa: the exported video's first frame (what feeds and galleries show).
  // A moment of the edit, or a photo. None: the video starts as it is.
  cover?: { type: "frame"; atUs: Us } | { type: "image"; assetId: Id } | null;
}

export type TrackKind = "main" | "overlay" | "audio" | "text" | "effect" | "caption";

export interface Track {
  id: Id;
  kind: TrackKind;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  items: Clip[]; // sorted by startUs
  style?: TextStyle; // caption tracks: one style for every caption
  preset?: string; // caption tracks: the caption template (grouping, highlight, animation)
}

export interface Transform {
  x: number; // canvas-relative, 0..1, centre of the item
  y: number;
  scale: number;
  rotation: number; // degrees
}

export interface ClipBase {
  id: Id;
  startUs: Us; // position on the timeline
  durationUs: Us; // length on the timeline (after speed)
  transform: Transform;
  opacity: number; // 0..1
  blendMode: "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten" | "add";
  animation: { in: AnimRef | null; out: AnimRef | null; loop: AnimRef | null };
  keyframes: Keyframe[];
}

export interface AnimRef {
  id: string; // our own preset id, e.g. "fade", "zoom-in"
  durationUs: Us;
}

export type KeyframeProperty =
  | "x" | "y" | "scale" | "rotation" | "opacity" | "volume"
  | "brightness" | "contrast" | "saturation";

export interface Keyframe {
  tUs: Us; // relative to the clip start
  property: KeyframeProperty;
  value: number;
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

export interface Adjust {
  brightness: number; // -50..50, 0 = unchanged
  contrast: number;
  saturation: number;
  exposure: number;
  temperature: number;
  tint: number;
  sharpen: number; // 0..100
  vignette: number;
  highlights: number;
  shadows: number;
}

export interface MediaClip extends ClipBase {
  type: "media";
  assetId: Id;
  inUs: Us; // in the source media
  outUs: Us;
  speed: number; // 0.1..100, ignored when speedCurve is set
  speedCurve: { t: number; speed: number }[] | null; // t is 0..1 of the clip
  keepPitch: boolean;
  reverse: boolean;
  volume: number; // 0..2
  fadeInUs: Us;
  fadeOutUs: Us;
  crop: { x: number; y: number; w: number; h: number } | null; // 0..1 of the source
  mask: {
    shape: "linear" | "mirror" | "circle" | "rect" | "heart" | "star";
    params: Record<string, number>;
    invert: boolean;
    feather: number;
  } | null;
  chroma: { color: string; intensity: number; shadow: number } | null;
  filter: { id: string; intensity: number } | null;
  adjust: Adjust | null;
  freeze: boolean; // a freeze frame is a media clip of one source frame (inUs); outUs - inUs is its length
  flip?: boolean; // mirrored left-right (after the crop)
  reverseOf?: { assetId: Id; inUs: Us; outUs: Us } | null;
  beats?: Us[]; // music: beat marks, in source time
  voiceFx?: string | null; // S08 efeito de voz: robot, echo, radio, phone, megaphone, cave // reverse: the media it was made from (to undo it)
  stabilize: 0 | 1 | 2 | 3; // off, low, medium, high
  denoise: boolean;
}

export interface TextStyle {
  font: string; // an open font we ship
  size: number;
  color: string;
  stroke: { color: string; width: number } | null;
  shadow: { color: string; blur: number; x: number; y: number } | null;
  background: { color: string; radius: number; padding: number } | null;
  align: "left" | "center" | "right";
  bold: boolean;
  italic: boolean;
  uppercase?: boolean; // drawn in capitals; the stored text keeps its case
  glow?: { color: string; blur: number } | null; // neon
  gradient?: string[] | null; // fill from top to bottom (metal, gradient looks)
}

export interface TextClip extends ClipBase {
  type: "text";
  text: string;
  style: TextStyle;
}

export interface CaptionClip extends ClipBase {
  type: "caption";
  text: string;
  // when each word is spoken, relative to the caption's start (so moving a
  // caption keeps its words with it)
  words: { startUs: Us; endUs: Us; word: string }[];
  // style comes from the caption track so batch edits touch one place
}

export interface EffectClip extends ClipBase {
  type: "effect";
  effectId: string; // our own shader effect
  params: Record<string, number>;
}

export type Clip = MediaClip | TextClip | CaptionClip | EffectClip;

export interface Transition {
  id: Id;
  fromClipId: Id; // both on the main track, adjacent
  toClipId: Id;
  type: string; // our own preset id: "dissolve", "slide-left", "zoom", "blur"...
  durationUs: Us;
}

// ---------- invariants ----------

export function validateDoc(doc: TimelineDoc, assets: Map<Id, AssetRow>): string[] {
  const errors: string[] = [];
  const clips = new Map<Id, Clip>();

  for (const track of doc.tracks) {
    let prevEnd: Us | null = null;
    for (const clip of track.items) {
      clips.set(clip.id, clip);
      if (clip.durationUs <= 0) errors.push(`${clip.id}: duration must be positive`);
      if (prevEnd !== null && clip.startUs < prevEnd) {
        errors.push(`${clip.id}: overlaps the previous item on track ${track.id}`);
      }
      // the main track is magnetic: no gaps, starts at 0
      if (track.kind === "main" && clip.startUs !== (prevEnd ?? 0)) {
        errors.push(`${clip.id}: gap on the main track`);
      }
      prevEnd = clip.startUs + clip.durationUs;

      if (clip.type === "media") {
        const asset = assets.get(clip.assetId);
        if (!(0 <= clip.inUs && clip.inUs < clip.outUs)) {
          errors.push(`${clip.id}: need 0 <= inUs < outUs`);
        }
        if (asset && asset.kind !== "image" && !clip.freeze && clip.outUs > asset.durationUs) {
          errors.push(`${clip.id}: outUs past the end of the media`);
        }
        if (clip.speed < 0.1 || clip.speed > 100) errors.push(`${clip.id}: speed out of 0.1..100`);
      }

      const seen = new Set<string>();
      const last = new Map<KeyframeProperty, Us>();
      for (const k of clip.keyframes) {
        const key = `${k.property}@${k.tUs}`;
        if (seen.has(key)) errors.push(`${clip.id}: duplicate keyframe ${key}`);
        seen.add(key);
        const prev = last.get(k.property);
        if (prev !== undefined && k.tUs < prev) errors.push(`${clip.id}: keyframes out of order`);
        last.set(k.property, k.tUs);
      }
    }
  }

  for (const t of doc.transitions) {
    const a = clips.get(t.fromClipId);
    const b = clips.get(t.toClipId);
    if (!a || !b) {
      errors.push(`${t.id}: transition points to a missing clip`);
      continue;
    }
    if (a.startUs + a.durationUs !== b.startUs) errors.push(`${t.id}: clips are not adjacent`);
    if (t.durationUs > Math.min(a.durationUs, b.durationUs) / 2) {
      errors.push(`${t.id}: longer than half of the shorter clip`);
    }
  }

  return errors;
}
