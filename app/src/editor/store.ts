// Editor state. The doc is immutable: every edit makes a new one, the old one
// goes on the undo stack, and the project autosaves 500 ms after the last edit.
import { create } from "zustand";
import type { AssetRow, Id, TimelineDoc, Us } from "../data/db";
import { loadProject, saveDoc, thumbsFor } from "../data/projects";
import { HISTORY_LIMIT } from "../data/db";
import { durationOf } from "./timeline";
import { onImportEvent } from "../media/import";

export interface Thumbs {
  times: number[]; // source time (s) of each image
  urls: string[];
}

type SaveState = "saved" | "pending" | "saving" | "error";

interface EditorState {
  projectId: Id | null;
  name: string;
  doc: TimelineDoc | null;
  assets: Map<Id, AssetRow>;
  thumbs: Map<Id, Thumbs>;
  selectedId: Id | null;
  playheadUs: Us;
  playing: boolean;
  pxPerSec: number;
  past: { doc: TimelineDoc; label: string }[];
  future: { doc: TimelineDoc; label: string }[];
  draft: TimelineDoc | null; // live preview of a gesture (trim) before it commits
  saveState: SaveState;
  copying: Map<Id, number>; // assets still being copied into the app, 0..1
  waves: Map<Id, number[]>; // audio peaks per asset (PEAKS_PER_SEC), for the timeline

  open(projectId: Id): Promise<boolean>;
  close(): void;
  addAssets(assets: AssetRow[]): Promise<void>;
  commit(doc: TimelineDoc, label: string): void;
  setDraft(doc: TimelineDoc | null): void;
  undo(): void;
  redo(): void;
  select(id: Id | null): void;
  setPlayhead(us: Us): void;
  setPlaying(playing: boolean): void;
  setZoom(pxPerSec: number): void;
  flush(): Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

async function loadThumbs(assetIds: Id[]) {
  const rows = await thumbsFor(assetIds);
  const out = new Map<Id, Thumbs>();
  for (const r of rows) {
    out.set(r.assetId, { times: r.data ?? [], urls: (r.blobs ?? []).map((b) => URL.createObjectURL(b)) });
  }
  return out;
}

export const MIN_ZOOM = 8;
export const MAX_ZOOM = 400;

export const useEditor = create<EditorState>((set, get) => {
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    set({ saveState: "pending" });
    saveTimer = setTimeout(() => void get().flush(), 500);
  }

  function apply(doc: TimelineDoc) {
    const { playheadUs, selectedId } = get();
    const end = durationOf(doc);
    const stillThere = selectedId && doc.tracks.some((t) => t.items.some((c) => c.id === selectedId));
    set({ doc, draft: null, playheadUs: Math.min(playheadUs, end), selectedId: stillThere ? selectedId : null });
    scheduleSave();
  }

  return {
    projectId: null,
    name: "",
    doc: null,
    assets: new Map(),
    thumbs: new Map(),
    selectedId: null,
    playheadUs: 0,
    playing: false,
    pxPerSec: 60,
    past: [],
    future: [],
    draft: null,
    saveState: "saved",
    copying: new Map(),
    waves: new Map(),

    async open(projectId) {
      const loaded = await loadProject(projectId);
      if (!loaded) return false;
      for (const t of get().thumbs.values()) t.urls.forEach(URL.revokeObjectURL);
      const thumbs = await loadThumbs(loaded.assets.map((a) => a.id));
      set({
        projectId,
        name: loaded.project.name,
        doc: loaded.doc,
        assets: new Map(loaded.assets.map((a) => [a.id, a])),
        thumbs,
        selectedId: null,
        playheadUs: 0,
        playing: false,
        past: [],
        future: [],
        draft: null,
        saveState: "saved",
        copying: new Map(loaded.assets.filter((a) => a.status === "importing").map((a) => [a.id, 0])),
      });
      return true;
    },

    close() {
      for (const t of get().thumbs.values()) t.urls.forEach(URL.revokeObjectURL);
      set({ projectId: null, doc: null, assets: new Map(), thumbs: new Map(), waves: new Map(), past: [], future: [], playing: false });
    },

    async addAssets(assets) {
      const thumbs = await loadThumbs(assets.map((a) => a.id));
      set((s) => ({
        assets: new Map([...s.assets, ...assets.map((a) => [a.id, a] as const)]),
        thumbs: new Map([...s.thumbs, ...thumbs]),
        copying: new Map([...s.copying, ...assets.filter((a) => a.status === "importing").map((a) => [a.id, 0] as const)]),
      }));
    },

    commit(doc, label) {
      const prev = get().doc;
      if (!prev) return;
      set((s) => ({ past: [...s.past, { doc: prev, label }].slice(-HISTORY_LIMIT), future: [] }));
      apply(doc);
    },

    setDraft(draft) {
      set({ draft });
    },

    undo() {
      const { past, doc } = get();
      const last = past[past.length - 1];
      if (!last || !doc) return;
      set((s) => ({ past: s.past.slice(0, -1), future: [{ doc, label: last.label }, ...s.future] }));
      apply(last.doc);
    },

    redo() {
      const { future, doc } = get();
      const next = future[0];
      if (!next || !doc) return;
      set((s) => ({ future: s.future.slice(1), past: [...s.past, { doc, label: next.label }] }));
      apply(next.doc);
    },

    select(id) {
      set({ selectedId: id });
    },

    setPlayhead(us) {
      const doc = get().draft ?? get().doc;
      const end = doc ? durationOf(doc) : 0;
      set({ playheadUs: Math.max(0, Math.min(end, Math.round(us))) });
    },

    setPlaying(playing) {
      set({ playing });
    },

    setZoom(pxPerSec) {
      set({ pxPerSec: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pxPerSec)) });
    },

    async flush() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      const { projectId, doc, saveState } = get();
      if (!projectId || !doc || saveState === "saved") return;
      set({ saveState: "saving" });
      try {
        await saveDoc(projectId, doc);
        if (get().doc === doc) set({ saveState: "saved" });
      } catch (err) {
        console.error("save failed", err);
        set({ saveState: "error" });
      }
    },
  };
});

// Background imports report here: thumbnails appear and copies finish while
// the project is open.
onImportEvent((e) => {
  const s = useEditor.getState();
  if (e.type === "thumbs") {
    if (!s.assets.has(e.assetId)) return;
    const thumbs = new Map(s.thumbs);
    thumbs.get(e.assetId)?.urls.forEach(URL.revokeObjectURL);
    thumbs.set(e.assetId, { times: e.times, urls: e.blobs.map((b) => URL.createObjectURL(b)) });
    useEditor.setState({ thumbs });
  } else if (e.type === "progress") {
    if (!s.assets.has(e.assetId)) return;
    useEditor.setState({ copying: new Map(s.copying).set(e.assetId, e.fraction) });
  } else if (e.type === "ready" || e.type === "error") {
    const id = e.type === "ready" ? e.asset.id : e.assetId;
    if (!s.assets.has(id)) return;
    const copying = new Map(s.copying);
    copying.delete(id);
    const assets = e.type === "ready" ? new Map(s.assets).set(id, e.asset) : s.assets;
    useEditor.setState({ copying, assets });
  }
});

// Save before the page goes away (app switch, tab close).
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void useEditor.getState().flush();
  });
}
