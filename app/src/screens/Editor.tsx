// S03 Editor, with S04 (clip tools), S05 (speed), S15 (format) and S17
// (export) as sheets. Tools that are not built yet open a stub that says so.
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Blend,
  Captions,
  LayoutGrid,
  ChevronLeft,
  Copy,
  Crop,
  ImageIcon,
  ImagePlus,
  FlipHorizontal2,
  Gauge,
  Layers,
  PanelsTopLeft,
  SquarePlus,
  Shuffle,
  ScissorsSquare,
  AudioWaveform,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Music2,
  Circle,
  Pipette,
  Speech,
  Palette,
  RectangleHorizontal,
  Replace,
  Scissors,
  SlidersHorizontal,
  Smile,
  Snowflake,
  Sparkles,
  Split,
  Trash2,
  Type,
  Volume2,
  VolumeX,
  Waves,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { FilePicker } from "../app/FilePicker";
import { ImportOverlay } from "../app/ImportOverlay";
import { describeAsset, runImport, takeImport } from "../app/importFlow";
import { navigate } from "../app/router";
import type { AspectRatio, Id, MediaClip, TimelineDoc } from "../data/db";
import { assetFile, onImportEvent } from "../media/import";
import { Player } from "../editor/player";
import { useEditor } from "../editor/store";
import { TimelineView } from "../editor/TimelineView";
import { TextOverlay } from "../editor/TextOverlay";
import { TextSheet, type TextTab } from "./TextSheet";
import { AudioMenu, FadeSheet, RecordSheet, SfxSheet } from "./AudioSheets";
import { TransitionSheet } from "./TransitionSheet";
import { CaptionSheet, takeCrashedCaptionRun, type CaptionTab } from "./CaptionSheet";
import { audio, peaksOf } from "../editor/audio";
import {
  addAudio,
  addText,
  setText,
  captionTrack,
  canSplit,
  clipAt,
  durationOf,
  duplicate,
  findClip,
  findItem,
  frameSize,
  insertMedia,
  mainTrack,
  move,
  remove,
  setClip,
  setItem,
  setTrackMuted,
  split,
  splitItem,
  addOverlay,
  layerToMain,
  setCover,
  clipDuration,
  freezeAt,
  toggleKeyframe,
  setKeyEasing,
  setVolumeAt,
  setBeats,
  setTrackFlags,
  SPEED_CURVES,
  sourceTimeUs,
  addEffect,
  setEffect,
} from "../editor/timeline";
import { OverlayMedia } from "../editor/OverlayMedia";
import { LookLayer } from "../editor/LookLayer";
import { frameBgCss } from "../editor/frame";
import { BLENDS } from "../editor/blend";
import { EffectsBox } from "../editor/EffectsBox";
import { EFFECTS } from "../editor/effects";
import { OptionGrid } from "../ui/OptionGrid";
import { CurveEditor } from "../ui/CurveEditor";
import { ProgressBar } from "../ui/Progress";
import { reverseRange } from "../media/reverse";
import { speak } from "../captions/tts";
import { ChromaSheet, MaskSheet } from "./OverlaySheets";
import { ClipAnimSheet } from "./ClipAnimSheet";
import { detectBeats } from "../media/beats";
import { decodeAudio, VOICE_FX } from "../editor/audio";
import { removeBackground } from "../media/cutout";
import { sfxFile } from "../media/sfx";
import { STICKERS, STICKER_STYLE } from "../editor/text";
import { isZoomed, keyNear, mainZoom, volumeAt } from "../editor/keyframes";
import { AdjustSheet, FilterSheet } from "./LookSheets";
import { CropPan, CropSheet } from "./CropSheet";
import { CoverSheet } from "./CoverSheet";
import { exportTimeline } from "../export/exporter";
import { shareFile } from "../data/backup";
import { LayoutSheet } from "./LayoutSheet";
import { LAYOUTS, layerInCell, mainInCell } from "../editor/layouts";
import { overlaysAt } from "../editor/overlay";
import type { ExportOptions } from "../export/exporter";
import type { ImportProgress } from "../app/importFlow";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";
import { useToast } from "../ui/Toast";
import { Toolbar, ToolbarItem } from "../ui/Toolbar";
import { TopBar } from "../ui/TopBar";
import { Transport } from "../ui/Transport";
import { ExportSheet, resolutionLabel } from "./ExportSheet";

type Panel =
  | null
  | { name: "layout" }
  | { name: "cover" }
  | { name: "speed" }
  | { name: "volume" }
  | { name: "format" }
  | { name: "export" }
  | { name: "missing"; assetId: Id }
  | { name: "text"; id: Id; tab: TextTab }
  | { name: "audio" }
  | { name: "fade" }
  | { name: "record" }
  | { name: "transition"; fromId: Id }
  | { name: "captions"; tab: CaptionTab }
  | { name: "opacity" }
  | { name: "filters"; id: Id }
  | { name: "adjust"; id: Id }
  | { name: "crop"; id: Id }
  | { name: "stickers" }
  | { name: "mask" }
  | { name: "clipAnim" }
  | { name: "beats" }
  | { name: "sfx" }
  | { name: "voice" }
  | { name: "chroma" }
  | { name: "effects" };

// a small drawing of a speed curve (speed 0.1..4 up the side)
function CurveIcon({ points }: { points: { t: number; speed: number }[] }) {
  const y = (v: number) => 22 - (Math.log(v / 0.25) / Math.log(16)) * 18;
  return (
    <svg viewBox="0 0 32 24" aria-hidden className="h-6 w-8 stroke-text-muted" fill="none" strokeWidth="1.6">
      <polyline points={points.map((p) => `${2 + p.t * 28},${y(p.speed).toFixed(1)}`).join(" ")} />
    </svg>
  );
}

const ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "4:3", label: "4:3" },
];
const BACKGROUNDS = ["#000000", "#ffffff", "#1f1f24", "#24324a", "#3b2a2a", "#2b3b2b"];
const GRADIENTS: [string, string][] = [
  ["#ff512f", "#dd2476"],
  ["#4facfe", "#00f2fe"],
  ["#f7971e", "#ffd200"],
  ["#11998e", "#38ef7d"],
  ["#8e2de2", "#4a00e0"],
  ["#232526", "#414345"],
];

function formatSpeed(v: number) {
  return `${v < 1 ? v.toFixed(2).replace(/0$/, "") : v < 10 ? v.toFixed(1) : Math.round(v)}x`.replace(".", ",");
}

function loadExportOptions(projectId: Id): ExportOptions {
  try {
    const raw = localStorage.getItem(`export:${projectId}`);
    if (raw) return JSON.parse(raw) as ExportOptions;
  } catch {
    // private mode or bad data: defaults
  }
  return { shortSide: 1080, fps: 30, quality: "recommended" };
}

export function Editor({ projectId }: { projectId: Id }) {
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoBoxRef = useRef<HTMLDivElement>(null);
  const zoomBoxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement>(null);
  const dipRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const stageBox = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const player = useRef<Player | null>(null);
  const addPicker = useRef<HTMLInputElement>(null);
  const replacePicker = useRef<HTMLInputElement>(null);
  const audioPicker = useRef<HTMLInputElement>(null);
  const overlayPicker = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");
  const [panel, setPanel] = useState<Panel>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [importing, setImporting] = useState<ImportProgress | null>(null);
  // the overlay videos let go of their decoders while captions or export run
  const [mediaReleased, setMediaReleased] = useState(false);
  const [missing, setMissing] = useState<Set<Id>>(new Set());
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [exportOptions, setExportOptions] = useState<ExportOptions>(() => loadExportOptions(projectId));

  const doc = useEditor((s) => s.draft ?? s.doc);
  const assets = useEditor((s) => s.assets);
  const selectedId = useEditor((s) => s.selectedId);
  const playheadUs = useEditor((s) => s.playheadUs);
  const playing = useEditor((s) => s.playing);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const saveState = useEditor((s) => s.saveState);
  const copying = useEditor((s) => s.copying);
  const ed = useEditor.getState();
  // a photo as the frame's background: its object URL for the preview
  const bgAssetId = doc?.canvas.background.type === "image" ? doc.canvas.background.assetId : null;
  const [bgImageUrl, setBgImageUrl] = useState<string | null>(null);
  useEffect(() => {
    const a = bgAssetId ? useEditor.getState().assets.get(bgAssetId) : undefined;
    if (!a) return setBgImageUrl(null);
    let url: string | null = null;
    void assetFile(a).then((f) => {
      if (!f) return;
      url = URL.createObjectURL(f);
      setBgImageUrl(url);
    });
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [bgAssetId]);
  const bgPicker = useRef<HTMLInputElement>(null);
  const coverPicker = useRef<HTMLInputElement>(null);
  const photoPicker = useRef<HTMLInputElement>(null); // Editar foto: Adicionar foto

  // Tela dividida: the main video at the cursor in cell 1, the layers there
  // in the others; when some are missing, the phone's picker asks for them
  // (opened straight from the tap, as iOS wants) and they come in as layers.
  const layoutPicker = useRef<HTMLInputElement>(null);
  const pendingLayout = useRef<string | null>(null);
  function arrangeLayout(doc: TimelineDoc, layoutId: string, layerIds: Id[]) {
    const layout = LAYOUTS.find((l) => l.id === layoutId)!;
    const s = useEditor.getState();
    const { width: W, height: H } = frameSize(doc, s.assets, 1080);
    const main = clipAt(doc, s.playheadUs)?.clip;
    if (!main) return null;
    let next = setItem(doc, main.id, mainInCell(s.assets.get(main.assetId), main, W, H, layout.cells[0]));
    layerIds.slice(0, layout.cells.length - 1).forEach((id, i) => {
      const hit = findItem(next, id);
      if (hit?.clip.type === "media") next = setItem(next, id, layerInCell(s.assets.get(hit.clip.assetId), W, H, layout.cells[i + 1]));
    });
    return next;
  }
  function onLayout(layoutId: string) {
    const s = useEditor.getState();
    if (!s.doc || !clipAt(s.doc, s.playheadUs)) return toast("Ponha o cursor sobre o vídeo principal.");
    const layout = LAYOUTS.find((l) => l.id === layoutId)!;
    const layers = overlaysAt(s.doc, s.playheadUs);
    if (layers.length < layout.cells.length - 1) {
      pendingLayout.current = layoutId;
      layoutPicker.current?.click();
      return;
    }
    const next = arrangeLayout(s.doc, layoutId, layers.map((c) => c.id));
    if (next) s.commit(next, "Tela dividida");
    setPanel(null);
  }
  async function onLayoutFiles(files: File[]) {
    const layoutId = pendingLayout.current;
    pendingLayout.current = null;
    if (!layoutId) return;
    setPanel(null);
    const s0 = useEditor.getState();
    const need = LAYOUTS.find((l) => l.id === layoutId)!.cells.length - 1 - (s0.doc ? overlaysAt(s0.doc, s0.playheadUs).length : 0);
    const added = await runImport(projectId, files.slice(0, need), setImporting, toast);
    if (!added.length) return;
    await useEditor.getState().addAssets(added);
    const s = useEditor.getState();
    if (!s.doc) return;
    let doc = s.doc;
    for (const a of added) doc = addOverlay(doc, a, s.playheadUs).doc;
    const next = arrangeLayout(doc, layoutId, overlaysAt(doc, s.playheadUs).map((c) => c.id));
    if (next) s.commit(next, "Tela dividida");
    if (added.length < need) toast(`Faltou ${need - added.length === 1 ? "1 vídeo" : `${need - added.length} vídeos`} para completar o modelo.`);
  }

  // Capa: a frame of the edit or a photo becomes the export's first frame
  function pickCover(cover: TimelineDoc["cover"]) {
    const s = useEditor.getState();
    if (!s.doc) return;
    s.commit(setCover(s.doc, cover), cover ? "Capa" : "Tirar capa");
    toast(cover ? "Capa definida" : "Capa removida");
    setPanel(null);
  }
  async function onCoverImage(files: File[]) {
    const [img] = await runImport(projectId, files.slice(0, 1), setImporting, toast);
    if (!img) return;
    if (img.kind !== "image") return toast("Escolha uma foto para a capa.");
    await useEditor.getState().addAssets([img]);
    pickCover({ type: "image", assetId: img.id });
  }
  async function onBgImage(files: File[]) {
    const [img] = await runImport(projectId, files.slice(0, 1), setImporting, toast);
    if (!img) return;
    if (img.kind !== "image") return toast("Escolha uma foto para o fundo.");
    await useEditor.getState().addAssets([img]);
    const d = useEditor.getState().doc!;
    ed.commit({ ...d, canvas: { ...d.canvas, background: { type: "image", assetId: img.id } } }, "Fundo");
  }


  useEffect(() => {
    let alive = true;
    setState("loading");
    void ed.open(projectId).then(async (ok) => {
      if (!alive) return;
      setState(ok ? "ready" : "notfound");
      if (!ok) return;
      // media deleted behind our back (storage cleared, etc.)
      const gone = new Set<Id>();
      for (const a of useEditor.getState().assets.values()) if (!(await assetFile(a))) gone.add(a.id);
      if (alive) setMissing(gone);
      // the last caption run never finished: iOS closed the app (memory)
      const crashed = takeCrashedCaptionRun();
      if (crashed) {
        try {
          const prefs = JSON.parse(localStorage.getItem("caption-prefs") ?? "{}");
          localStorage.setItem("caption-prefs", JSON.stringify({ ...prefs, model: "tiny" }));
        } catch {
          // keep the old choice
        }
        toast(
          crashed.model === "base"
            ? "O iPhone fechou o app ao gerar as legendas (falta de memória). Mudei para a qualidade Mais rápida; tente de novo."
            : "O iPhone fechou o app ao gerar as legendas (falta de memória). Feche outros apps e tente de novo, ou use um trecho menor.",
          "error",
        );
      }
      const took = takeImport(projectId);
      const first = [...useEditor.getState().assets.values()].find((a) => a.kind === "video");
      if (took && first)
        toast(
          `${took.label ? `${took.label}: ` : ""}Aberto em ${took.secs.toFixed(1).replace(".", ",")} s · chegou como ${describeAsset(first)}`,
        );
    });
    return () => {
      alive = false;
      void useEditor.getState().flush().then(() => useEditor.getState().close());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // the main clip's zoom and pan at the playhead (S16 keyframes)
  useEffect(() => {
    const el = zoomBoxRef.current;
    if (state !== "ready" || !el) return;
    const apply = () => {
      const s = useEditor.getState();
      const d = s.draft ?? s.doc;
      const hit = d ? clipAt(d, s.playheadUs) : null;
      const z = hit ? mainZoom(hit.clip, hit.offsetUs) : null;
      const t = z && isZoomed(z) ? `translate(${z.dx * 100}%, ${z.dy * 100}%) rotate(${z.rot}deg) scale(${z.scale})` : "";
      if (el.style.transform !== t) el.style.transform = t;
      const o = z && z.opacity < 0.999 ? String(Math.max(0, z.opacity)) : "";
      if (el.style.opacity !== o) el.style.opacity = o;
    };
    apply();
    return useEditor.subscribe(apply);
  }, [state]);

  useEffect(() => {
    if (state !== "ready" || !videoRef.current || !videoBoxRef.current || !canvasRef.current || !fxCanvasRef.current || !dipRef.current || !bgCanvasRef.current)
      return;
    const p = new Player(videoRef.current, videoBoxRef.current, canvasRef.current, fxCanvasRef.current, dipRef.current, bgCanvasRef.current);
    player.current = p;
    p.onMediaError = setMediaError;
    void p.showAt(useEditor.getState().playheadUs);
    // repaint the frame under the playhead whenever it or the doc changes
    let queued = false;
    const unsub = useEditor.subscribe((s, prev) => {
      // playback stopped from elsewhere (touching the timeline): stop the player too
      if (prev.playing && !s.playing) p.pause();
      if (s.playing) return;
      if (s.playheadUs === prev.playheadUs && s.doc === prev.doc && s.draft === prev.draft && s.playing === prev.playing) return;
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        void p.showAt(useEditor.getState().playheadUs);
      });
    });
    return () => {
      unsub();
      p.dispose();
      player.current = null;
    };
  }, [state]);

  useEffect(
    () =>
      onImportEvent((e) => {
        if (e.type === "error" && useEditor.getState().assets.has(e.assetId))
          toast(`${e.name}: ${e.reason} Você pode editar e exportar agora, mas ele não fica guardado no app.`, "error");
      }),
    [toast],
  );

  // decode the sound of every audio-lane clip once: waveform now, playback later
  const audioAssetKey = doc
    ? [...new Set(doc.tracks.filter((t) => t.kind === "audio").flatMap((t) => t.items.map((c) => (c.type === "media" ? c.assetId : ""))))]
        .filter(Boolean)
        .join(",")
    : "";
  useEffect(() => {
    for (const id of audioAssetKey.split(",").filter(Boolean)) {
      const asset = useEditor.getState().assets.get(id);
      if (!asset || useEditor.getState().waves.has(id)) continue;
      void audio.buffer(asset).then((buf) => {
        if (buf) useEditor.setState((s) => ({ waves: new Map(s.waves).set(id, peaksOf(buf)) }));
      });
    }
  }, [audioAssetKey, assets]);

  useEffect(() => {
    const el = stageBox.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [state, fullscreen]);

  useEffect(() => {
    try {
      localStorage.setItem(`export:${projectId}`, JSON.stringify(exportOptions));
    } catch {
      // not important
    }
  }, [exportOptions, projectId]);

  if (state === "notfound") {
    return (
      <main className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <p className="text-lg">Projeto não encontrado</p>
        <p className="text-sm text-text-muted">Ele pode ter sido excluído.</p>
        <Button variant="primary" onClick={() => navigate("/", true)}>
          Voltar ao início
        </Button>
      </main>
    );
  }

  const selected = doc && selectedId ? findClip(doc, selectedId) : undefined;
  const selectedItem = doc && selectedId ? findItem(doc, selectedId) : null;
  const selectedText = selectedItem?.clip.type === "text" ? selectedItem.clip : null;
  const selectedCaption = selectedItem?.clip.type === "caption" ? selectedItem.clip : null;
  const selectedAudio = selectedItem?.track.kind === "audio" && selectedItem.clip.type === "media" ? selectedItem.clip : null;
  const selectedEffect = selectedItem?.clip.type === "effect" ? selectedItem.clip : null;
  const selectedOverlay = selectedItem?.track.kind === "overlay" && selectedItem.clip.type === "media" ? selectedItem.clip : null;
  const selectedMedia: MediaClip | null = selected ?? selectedAudio ?? selectedOverlay;
  const speedClip = selected ?? selectedOverlay; // Velocidade: main clips and layers
  const overlayAsset = selectedOverlay ? assets.get(selectedOverlay.assetId) : undefined;
  const videoMuted = doc ? mainTrack(doc).muted : false;
  const target = selected ?? (doc ? clipAt(doc, playheadUs)?.clip : undefined);
  const targetAsset = target ? assets.get(target.assetId) : undefined;
  const mainList = doc ? mainTrack(doc).items : [];
  const mainCount = mainList.length;
  const mainIndex = selected ? mainList.findIndex((c) => c.id === selected.id) : -1;
  const totalUs = doc ? durationOf(doc) : 0;
  const frame = doc ? frameSize(doc, assets, 1080) : { width: 9, height: 16 };
  const fit = Math.min(box.w / frame.width, box.h / frame.height) || 0;
  const stage = { w: Math.floor(frame.width * fit), h: Math.floor(frame.height * fit) };
  const blurBg = doc?.canvas.background.type === "blur";

  function togglePlay() {
    if (!player.current) return;
    if (useEditor.getState().playing) player.current.pause();
    else player.current.play();
  }

  function stop() {
    if (useEditor.getState().playing) player.current?.pause();
  }

  function onSplit() {
    stop();
    const s = useEditor.getState();
    if (!s.doc || !target) return;
    const r = split(s.doc, target.id, s.playheadUs);
    if (!r) return toast("Mova o cursor para dentro do clipe para dividir.");
    s.commit(r.doc, "Dividir");
    s.select(r.rightId);
  }

  function onDelete() {
    stop();
    const s = useEditor.getState();
    if (!s.doc || !s.selectedId) return;
    s.commit(remove(s.doc, s.selectedId), "Excluir");
  }

  function onDuplicate() {
    const s = useEditor.getState();
    if (!s.doc || !s.selectedId) return;
    const r = duplicate(s.doc, s.selectedId);
    s.commit(r.doc, "Duplicar");
    s.select(r.id);
  }

  async function onAddMusic(files: File[]) {
    stop();
    setPanel(null);
    const [song] = await runImport(projectId, files.slice(0, 1), setImporting, toast, { only: "audio" });
    if (!song) return;
    await useEditor.getState().addAssets([song]);
    const s = useEditor.getState();
    if (!s.doc) return;
    const r = addAudio(s.doc, song, s.playheadUs);
    s.commit(r.doc, "Adicionar música");
    s.select(r.id);
  }

  // The clip's sound becomes its own audio item, and the clip goes silent.
  function onExtract() {
    stop();
    setPanel(null);
    const s = useEditor.getState();
    const from = selectedOverlay ?? target;
    const fromAsset = from && assets.get(from.assetId);
    if (!s.doc || !from || !fromAsset?.hasAudio) return;
    const r = addAudio(s.doc, fromAsset, from.startUs, from.inUs);
    let d = setItem(r.doc, r.id, { outUs: from.outUs, speed: from.speed, volume: from.volume, durationUs: from.durationUs });
    d = setItem(d, from.id, { volume: 0 });
    s.commit(d, "Extrair som");
    s.select(r.id);
  }

  async function onRecorded(file: File, atUs: number) {
    const [rec] = await runImport(projectId, [file], setImporting, toast, { only: "audio" });
    if (!rec) return;
    await useEditor.getState().addAssets([rec]);
    const s = useEditor.getState();
    if (!s.doc) return;
    const r = addAudio(s.doc, rec, atUs);
    s.commit(setItem(r.doc, r.id, { outUs: rec.durationUs, durationUs: rec.durationUs }), "Gravar narração");
    s.select(r.id);
    setPanel(null);
  }

  function onSplitAudio() {
    stop();
    const s = useEditor.getState();
    const item = selectedAudio ?? selectedOverlay;
    if (!s.doc || !item) return;
    const r = splitItem(s.doc, item.id, s.playheadUs);
    if (!r) return toast(`Mova o cursor para dentro ${selectedAudio ? "do áudio" : "da sobreposição"} para dividir.`);
    s.commit(r.doc, selectedAudio ? "Dividir áudio" : "Dividir sobreposição");
    s.select(r.rightId);
  }

  // S14: filter and adjustments for the selected clip or overlay, else the clip under the playhead
  function openLook(name: "filters" | "adjust") {
    stop();
    const id = selectedOverlay?.id ?? selected?.id ?? target?.id;
    if (id) setPanel(name === "filters" ? { name, id } : { name, id });
  }
  const lookId = panel?.name === "filters" || panel?.name === "adjust" ? panel.id : null;
  const lookHit = doc && lookId ? findItem(doc, lookId) : null;
  const lookClip = lookHit?.clip.type === "media" ? lookHit.clip : null;
  const lookIsMain = lookHit?.track.kind === "main";
  function changeLook(patch: Partial<MediaClip>) {
    const s = useEditor.getState();
    const cur = s.draft ?? s.doc;
    if (cur && lookId) s.setDraft(setItem(cur, lookId, patch));
  }
  function lookToAll(pick: (c: MediaClip) => Partial<MediaClip>) {
    const s = useEditor.getState();
    const cur = s.draft ?? s.doc;
    const src = cur && lookId ? findItem(cur, lookId)?.clip : null;
    if (!cur || src?.type !== "media") return;
    let next = cur;
    for (const c of mainTrack(cur).items) next = setItem(next, c.id, pick(src));
    s.setDraft(next);
    toast("Aplicado a todos os clipes");
  }

  // S16: the selected video, overlay or text can take keyframes while the playhead is on it
  const keyCandidate = selected ?? selectedOverlay ?? selectedText ?? selectedAudio;
  const keyClip =
    keyCandidate && playheadUs >= keyCandidate.startUs && playheadUs <= keyCandidate.startUs + keyCandidate.durationUs ? keyCandidate : null;

  // S04 Inverter: the clip's part of its video, made backwards as a new video;
  // inverting again goes back to the original
  const [busy, setBusy] = useState<{ label: string; fraction: number; abort: AbortController } | null>(null);
  async function onReverse() {
    stop();
    const s = useEditor.getState();
    const clip = selected ?? selectedOverlay;
    if (!s.doc || !clip) return;
    if (clip.reverse && clip.reverseOf) {
      const o = clip.reverseOf;
      s.commit(setItem(s.doc, clip.id, { assetId: o.assetId, inUs: o.inUs, outUs: o.outUs, reverse: false, reverseOf: null }), "Desinverter");
      return;
    }
    const asset = assets.get(clip.assetId);
    if (asset?.kind !== "video") return toast("Inverter funciona em vídeos.");
    if (clip.freeze) return toast("Um quadro congelado já é igual ao contrário.");
    const abort = new AbortController();
    setBusy({ label: "Invertendo o vídeo", fraction: 0, abort });
    player.current?.release();
    setMediaReleased(true);
    try {
      const file = await reverseRange(asset, clip.inUs, clip.outUs, (fraction) => setBusy((b) => b && { ...b, fraction }), abort.signal);
      const [made] = await runImport(projectId, [file], setImporting, toast);
      if (!made) return;
      await useEditor.getState().addAssets([made]);
      const now = useEditor.getState();
      if (!now.doc) return;
      const patch = { assetId: made.id, inUs: 0, outUs: made.durationUs, reverse: true, reverseOf: { assetId: asset.id, inUs: clip.inUs, outUs: clip.outUs } };
      now.commit(setItem(now.doc, clip.id, patch), "Inverter");
      toast("Vídeo invertido");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") toast("Inversão cancelada");
      else toast(`Não foi possível inverter: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setBusy(null);
      setMediaReleased(false);
      void player.current?.showAt(useEditor.getState().playheadUs);
    }
  }

  // S11 Texto para fala: the selected text read aloud by a voice that runs
  // on the phone, added as narration where the text starts
  async function onSpeak() {
    stop();
    const clip = selectedText;
    if (!clip?.text.trim()) return;
    const abort = new AbortController();
    setBusy({ label: "Gerando a voz", fraction: 0, abort });
    try {
      const file = await speak(
        clip.text,
        (e) =>
          setBusy((b) =>
            !b
              ? b
              : e.stage === "download"
                ? { ...b, label: `Baixando a voz (uma vez) · ${Math.round(e.loaded / 1e6)} de ${Math.round(e.total / 1e6)} MB`, fraction: e.total ? e.loaded / e.total : 0 }
                : e.stage === "loading"
                  ? { ...b, label: "Carregando a voz", fraction: 0 }
                  : { ...b, label: "Gerando a voz", fraction: e.fraction },
          ),
        abort.signal,
      );
      const [voice] = await runImport(projectId, [file], setImporting, toast, { only: "audio" });
      if (!voice) return;
      await useEditor.getState().addAssets([voice]);
      const s = useEditor.getState();
      if (!s.doc) return;
      const r = addAudio(s.doc, voice, clip.startUs);
      s.commit(setItem(r.doc, r.id, { outUs: voice.durationUs, durationUs: voice.durationUs }), "Texto para fala");
      s.select(r.id);
      toast("Voz adicionada");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") toast("Cancelado");
      else {
        const msg = err instanceof Error ? err.message : String(err);
        toast(
          /fetch|network|404|not found/i.test(msg)
            ? "Não foi possível baixar a voz. Na primeira vez precisa de internet (cerca de 40 MB)."
            : `Não foi possível gerar a voz: ${msg}`,
          "error",
        );
      }
    } finally {
      setBusy(null);
    }
  }

  // S13 Stickers: an emoji text item at the playhead, popping in
  function onSticker(emoji: string) {
    const s = useEditor.getState();
    if (!s.doc) return;
    const r = addText(s.doc, s.playheadUs, emoji, STICKER_STYLE);
    const d = setText(r.doc, r.id, { animation: { in: { id: "pop", durationUs: 300_000 }, out: null, loop: null } });
    s.commit(d, "Sticker");
    s.select(r.id);
    setPanel(null);
  }

  function changeOverlay(patch: Partial<MediaClip>) {
    const s = useEditor.getState();
    const cur = s.draft ?? s.doc;
    if (cur && selectedOverlay) s.setDraft(setItem(cur, selectedOverlay.id, patch));
  }

  function changeMasked(patch: Partial<MediaClip>) {
    const s = useEditor.getState();
    const cur = s.draft ?? s.doc;
    const id = selectedOverlay?.id ?? selected?.id;
    if (cur && id) s.setDraft(setItem(cur, id, patch));
  }

  // S08 Batidas: marks on a music clip (found automatically or by hand); the
  // timeline's magnetic edges stick to them
  const [findingBeats, setFindingBeats] = useState(false);
  async function onAutoBeats() {
    const clip = selectedAudio;
    const asset = clip && assets.get(clip.assetId);
    if (!clip || !asset) return;
    setFindingBeats(true);
    try {
      const file = await assetFile(asset);
      const buf = file ? await decodeAudio(file) : null;
      const beats = buf ? detectBeats(buf) : [];
      const s = useEditor.getState();
      if (!s.doc) return;
      if (!beats.length) return toast("Não encontrei um ritmo regular nesse áudio. Marque no cursor.");
      s.commit(setBeats(s.doc, clip.id, beats), "Batidas");
      toast(`${beats.filter((b) => b >= clip.inUs && b <= clip.outUs).length} batidas marcadas`);
    } finally {
      setFindingBeats(false);
    }
  }
  function onBeatHere() {
    const s = useEditor.getState();
    const clip = selectedAudio;
    if (!s.doc || !clip) return;
    const local = s.playheadUs - clip.startUs;
    if (local < 0 || local > clip.durationUs) return toast("Ponha o cursor em cima do áudio.");
    const src = sourceTimeUs(clip, local);
    const near = (clip.beats ?? []).find((b) => Math.abs(b - src) < 60_000);
    const next = near !== undefined ? (clip.beats ?? []).filter((b) => b !== near) : [...(clip.beats ?? []), src];
    s.commit(setBeats(s.doc, clip.id, next), near !== undefined ? "Apagar batida" : "Marcar batida");
  }

  // the selected item's lane: hide it, lock it (not the main track)
  const lane = selectedItem && selectedItem.track.kind !== "main" ? selectedItem.track : null;
  const laneTools = lane ? (
    <>
      <ToolbarItem
        icon={lane.hidden ? <Eye /> : <EyeOff />}
        label={lane.hidden ? "Mostrar faixa" : "Ocultar faixa"}
        onClick={() => {
          const s = useEditor.getState();
          if (s.doc) s.commit(setTrackFlags(s.doc, lane.id, { hidden: !lane.hidden }), lane.hidden ? "Mostrar faixa" : "Ocultar faixa");
        }}
      />
      <ToolbarItem
        icon={lane.locked ? <LockOpen /> : <Lock />}
        label={lane.locked ? "Destrancar" : "Trancar faixa"}
        onClick={() => {
          const s = useEditor.getState();
          if (s.doc) s.commit(setTrackFlags(s.doc, lane.id, { locked: !lane.locked }), lane.locked ? "Destrancar faixa" : "Trancar faixa");
        }}
      />
    </>
  ) : null;

  // S12 Remover fundo: a photo overlay with its background cut out (a model
  // running on the phone); the new PNG replaces the photo, same place and size
  async function onCutout(clip: MediaClip) {
    stop();
    const asset = assets.get(clip.assetId);
    const file = asset && (await assetFile(asset));
    if (!asset || !file) return;
    const abort = new AbortController();
    setBusy({ label: "Removendo o fundo", fraction: 0, abort });
    try {
      const png = await removeBackground(
        file,
        asset.name,
        (e) =>
          setBusy((b) =>
            !b
              ? b
              : e.stage === "download"
                ? { ...b, label: `Baixando o recorte (uma vez) · ${Math.round(e.loaded / 1e6)} de ${Math.round(e.total / 1e6)} MB`, fraction: e.total ? e.loaded / e.total : 0 }
                : { ...b, label: e.stage === "loading" ? "Preparando o recorte" : "Removendo o fundo", fraction: e.stage === "working" ? 0.5 : 0 },
          ),
        abort.signal,
      );
      const [made] = await runImport(projectId, [png], setImporting, toast);
      if (!made) return;
      await useEditor.getState().addAssets([made]);
      const s = useEditor.getState();
      if (s.doc) s.commit(setItem(s.doc, clip.id, { assetId: made.id }), "Remover fundo");
      toast("Fundo removido");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") toast("Cancelado");
      else {
        const msg = err instanceof Error ? err.message : String(err);
        toast(/fetch|network|404/i.test(msg) ? "Não foi possível baixar o recorte. Na primeira vez precisa de internet (cerca de 25 MB)." : `Não foi possível remover o fundo: ${msg}`, "error");
      }
    } finally {
      setBusy(null);
    }
  }

  // S07 Efeitos sonoros: rendered by the app, imported like a recording
  async function onAddSfx(id: string) {
    setPanel(null);
    const file = await sfxFile(id);
    const [sfx] = await runImport(projectId, [file], setImporting, toast, { only: "audio" });
    if (!sfx) return;
    await useEditor.getState().addAssets([sfx]);
    const s = useEditor.getState();
    if (!s.doc) return;
    const r = addAudio(s.doc, sfx, s.playheadUs);
    s.commit(setItem(r.doc, r.id, { outUs: sfx.durationUs, durationUs: sfx.durationUs }), "Efeito sonoro");
    s.select(r.id);
  }

  function toggleDenoise(clip: MediaClip) {
    const s = useEditor.getState();
    if (!s.doc) return;
    s.commit(setItem(s.doc, clip.id, { denoise: !clip.denoise }), clip.denoise ? "Desligar redução de ruído" : "Reduzir ruído");
    toast(clip.denoise ? "Redução de ruído desligada" : "Ruído reduzido (graves, zumbido e chiado)");
  }

  // S13 Efeitos: add at the playhead, or swap the selected one
  function onEffect(id: string) {
    const s = useEditor.getState();
    if (!s.doc) return;
    if (selectedEffect) s.commit(setEffect(s.doc, selectedEffect.id, id), "Trocar efeito");
    else {
      const r = addEffect(s.doc, id, s.playheadUs);
      s.commit(r.doc, "Efeito");
      s.select(r.id);
    }
    setPanel(null);
  }

  // the keyframe under the playhead, if any, and its curve
  const keyAt = keyClip ? keyNear(keyClip, playheadUs - keyClip.startUs) : null;
  const keyLinear = keyClip && keyAt !== null ? keyClip.keyframes.some((k) => k.tUs === keyAt && k.easing === "linear") : false;

  // S04 Recortar and Congelar
  const cropHit = doc && panel?.name === "crop" ? findItem(doc, panel.id) : null;
  const cropClip = cropHit?.clip.type === "media" ? cropHit.clip : null;
  function changeCrop(patch: Partial<MediaClip>) {
    const s = useEditor.getState();
    const cur = s.draft ?? s.doc;
    if (cur && cropClip) s.setDraft(setItem(cur, cropClip.id, patch));
  }
  function onFreeze() {
    stop();
    const s = useEditor.getState();
    if (!s.doc || !target) return;
    if (assets.get(target.assetId)?.kind !== "video") return toast("Congelar funciona em vídeos.");
    const r = freezeAt(s.doc, target.id, s.playheadUs);
    if (!r) return toast("Esse trecho já é um quadro congelado.");
    s.commit(r.doc, "Congelar");
    s.select(r.id);
  }

  // S12 Sobrepor: a photo or video over the main video, at the playhead
  async function onAddOverlay(files: File[]) {
    stop();
    const [asset] = await runImport(projectId, files.slice(0, 1), setImporting, toast);
    if (!asset) return;
    await useEditor.getState().addAssets([asset]);
    const s = useEditor.getState();
    if (!s.doc) return;
    const r = addOverlay(s.doc, asset, s.playheadUs);
    s.commit(r.doc, "Adicionar camada");
    s.select(r.id);
  }

  function setSpeed(v: number) {
    if (!speedClip) return;
    const speed = Math.min(100, Math.max(0.1, v < 1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10));
    const s = useEditor.getState();
    const patch = { speed, speedCurve: null }; // a fixed speed replaces a curve
    // a layer keeps its start; its length follows the speed (main clips relayout)
    ed.setDraft(setItem(s.draft ?? s.doc!, speedClip.id, selected ? patch : { ...patch, durationUs: clipDuration({ ...speedClip, ...patch }) }));
  }

  // Faixa principal: the layer becomes a clip of the main video
  function onLayerToMain() {
    stop();
    const s = useEditor.getState();
    if (!s.doc || !selectedOverlay) return;
    const next = layerToMain(s.doc, selectedOverlay.id);
    if (!next) return;
    s.commit(next, "Faixa principal");
    s.select(selectedOverlay.id);
  }

  function moveSelected(step: -1 | 1) {
    stop();
    const s = useEditor.getState();
    if (!s.doc || mainIndex < 0) return;
    s.commit(move(s.doc, selected!.id, mainIndex + step), "Mover clipe");
  }

  function toggleVideoSound() {
    const s = useEditor.getState();
    if (s.doc) s.commit(setTrackMuted(s.doc, "main", !mainTrack(s.doc).muted), videoMuted ? "Ligar som do vídeo" : "Tirar som do vídeo");
  }

  function onAddText() {
    stop();
    const s = useEditor.getState();
    if (!s.doc) return;
    const r = addText(s.doc, s.playheadUs, "Seu texto");
    s.commit(r.doc, "Adicionar texto");
    s.select(r.id);
    setPanel({ name: "text", id: r.id, tab: "text" });
  }

  function openCaptions(tab: CaptionTab) {
    stop();
    setPanel({ name: "captions", tab });
  }

  function editText(id: Id, tab: TextTab = "text") {
    stop();
    useEditor.getState().select(id);
    setPanel({ name: "text", id, tab });
  }

  async function onAddFiles(files: File[]) {
    stop();
    const assetsNew = await runImport(projectId, files, setImporting, toast);
    if (!assetsNew.length) return;
    await useEditor.getState().addAssets(assetsNew);
    const s = useEditor.getState();
    if (!s.doc) return;
    const r = insertMedia(s.doc, assetsNew, s.playheadUs);
    s.commit(r.doc, "Adicionar mídia");
    s.select(r.ids[0]);
  }

  async function onReplaceFiles(files: File[]) {
    if (panel?.name !== "missing") return;
    const oldId = panel.assetId;
    const [fresh] = await runImport(projectId, files.slice(0, 1), setImporting, toast);
    if (!fresh) return;
    await useEditor.getState().addAssets([fresh]);
    const s = useEditor.getState();
    if (!s.doc) return;
    let next = s.doc;
    for (const t of next.tracks)
      for (const c of t.items)
        if (c.type === "media" && c.assetId === oldId) {
          const outUs = fresh.kind === "image" ? c.outUs - c.inUs : Math.min(c.outUs, fresh.durationUs);
          const inUs = Math.min(c.inUs, Math.max(0, outUs - 100_000));
          next = setClip(next, c.id, { assetId: fresh.id, inUs, outUs });
        }
    s.commit(next, "Substituir mídia");
    setMissing((m) => new Set([...m].filter((x) => x !== oldId)));
    setPanel(null);
  }

  // Sliders edit a live draft; closing the sheet turns it into one undo step.
  function closeEditing(label: string) {
    const d = useEditor.getState().draft;
    if (d) ed.commit(d, label);
    setPanel(null);
  }

  const clipTools = !!selected;

  // Editar foto: the picture with its layers and text, at full size (at most
  // 4096 px a side, the iPhone's canvas limit), as a JPEG to share or save
  async function savePhoto() {
    const s = useEditor.getState();
    const main = s.doc ? clipAt(s.doc, 0)?.clip : undefined;
    const a = main && s.assets.get(main.assetId);
    if (!s.doc || !a) return;
    const natural = frameSize(s.doc, s.assets, Math.min(a.width, a.height));
    const k = Math.min(1, 4096 / Math.max(natural.width, natural.height));
    const shortSide = Math.floor(Math.min(natural.width, natural.height) * k) as ExportOptions["shortSide"];
    const abort = new AbortController();
    setBusy({ label: "Salvando a foto", fraction: 0.5, abort });
    try {
      const r = await exportTimeline(s.doc, s.assets, { shortSide, fps: 30, quality: "high", still: true }, () => {}, abort.signal);
      setBusy(null);
      await shareFile(r.file);
    } catch (err) {
      toast(`Não foi possível salvar: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setBusy(null);
    }
  }
  const photoMode = useEditor.getState().photo;

  return (
    <main className="pt-safe pb-safe flex h-full flex-col bg-bg">
      <TopBar
        resolution={photoMode ? null : resolutionLabel(exportOptions.shortSide)}
        action={photoMode ? "Salvar" : "Exportar"}
        onClose={() => navigate("/")}
        onSettings={() => {
          stop();
          setPanel({ name: "export" });
        }}
        onExport={() => {
          stop();
          if (photoMode) void savePhoto();
          else setPanel({ name: "export" });
        }}
      />

      <div ref={stageBox} className="relative flex min-h-0 flex-1 items-center justify-center bg-canvas" onClick={() => setFullscreen(false)}>
        {state === "loading" && <span className="text-sm text-text-muted">Abrindo projeto…</span>}
        {/* the project frame: its shape follows the aspect ratio */}
        <div
          className={cn("relative overflow-hidden", state !== "ready" && "hidden")}
          style={{ width: stage.w, height: stage.h, background: frameBgCss(doc, bgImageUrl) }}
        >
          {/* effects (S13) move and filter everything below the text */}
          <EffectsBox width={stage.w}>
            {/* blurred background (when the format sheet asks for it) */}
            <canvas
              ref={bgCanvasRef}
              aria-hidden
              className="pointer-events-none absolute inset-0 size-full scale-110 blur-xl brightness-75"
              style={{ visibility: "hidden" }}
            />
            {/* the main video's zoom and pan (keyframes) move this box */}
            <div ref={zoomBoxRef} className="pointer-events-none absolute inset-0">
              <div ref={videoBoxRef} className="pointer-events-none absolute inset-0">
                <video
                  ref={videoRef}
                  aria-label="Prévia do vídeo"
                  playsInline
                  className="pointer-events-none absolute inset-0 size-full object-contain"
                />
              </div>
              <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" style={{ visibility: "hidden" }} />
              {state === "ready" && stage.w > 0 && <LookLayer video={videoRef} image={canvasRef} width={stage.w} height={stage.h} />}
            </div>
            {/* transitions: the clip that is not playing, as a still, and the dip colour */}
            <canvas ref={fxCanvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" style={{ visibility: "hidden" }} />
            <div ref={dipRef} aria-hidden className="pointer-events-none absolute inset-0 z-[3]" style={{ opacity: 0 }} />
            {state === "ready" && stage.w > 0 && !mediaReleased && <OverlayMedia width={stage.w} height={stage.h} />}
          </EffectsBox>
          {cropClip && cropHit?.track.kind === "main" && stage.w > 0 && (
            <CropPan clip={cropClip} asset={assets.get(cropClip.assetId)} width={stage.w} height={stage.h} onChange={changeCrop} onDone={() => {}} />
          )}
          {state === "ready" && stage.w > 0 && (
            <TextOverlay
              width={stage.w}
              height={stage.h}
              onRemove={onDelete}
              onDuplicate={onDuplicate}
              onEdit={(id) => {
                const d = useEditor.getState().doc;
                if (d && findItem(d, id)?.clip.type === "caption") {
                  useEditor.getState().select(id);
                  openCaptions("edit");
                } else editText(id);
              }}
            />
          )}
        </div>
        {state === "ready" && totalUs === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-sm">Projeto vazio</p>
            <Button variant="primary" onClick={() => addPicker.current?.click()}>
              Adicionar mídia
            </Button>
          </div>
        )}
          {keyClip && keyAt !== null && !playing && (
            <div className="absolute bottom-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-pill bg-surface-3/90 py-1 pl-3 pr-1 text-xs">
              <span className="text-text-muted">Até o próximo:</span>
              {(["ease-in-out", "linear"] as const).map((e) => (
                <button
                  key={e}
                  type="button"
                  aria-pressed={(e === "linear") === keyLinear}
                  onClick={() => {
                    const s = useEditor.getState();
                    if (s.doc) s.commit(setKeyEasing(s.doc, keyClip.id, s.playheadUs, e), "Curva do keyframe");
                  }}
                  className={cn("h-7 rounded-pill border px-3", (e === "linear") === keyLinear ? "border-accent bg-accent text-on-accent" : "border-border-input")}
                >
                  {e === "linear" ? "Constante" : "Suave"}
                </button>
              ))}
            </div>
          )}
        {copying.size > 0 && (
          <span role="status" className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-pill bg-surface-3/90 px-3 py-1 text-xs text-text">
            Guardando {copying.size > 1 ? `${copying.size} vídeos` : "vídeo"} no app…{" "}
            {Math.round(([...copying.values()].reduce((a, b) => a + b, 0) / copying.size) * 100)}%
          </span>
        )}
        {mediaError && (
          <p role="alert" className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-md bg-surface-2/95 p-3 text-center text-sm">
            {mediaError}
          </p>
        )}
        {saveState === "error" && (
          <span role="alert" className="absolute left-2 top-2 rounded-sm bg-danger px-2 py-1 text-xs text-on-danger">
            Não foi possível salvar
          </span>
        )}
      </div>

      <Transport
        photo={photoMode}
        playing={playing}
        currentUs={playheadUs}
        durationUs={totalUs}
        canUndo={canUndo}
        canRedo={canRedo}
        onPlay={togglePlay}
        onUndo={() => {
          stop();
          ed.undo();
        }}
        onRedo={() => {
          stop();
          ed.redo();
        }}
        onFullscreen={() => setFullscreen((f) => !f)}
        keyframe={
          keyClip && !playing
            ? {
                on: keyNear(keyClip, playheadUs - keyClip.startUs) !== null,
                onToggle: () => {
                  const s = useEditor.getState();
                  if (s.doc) s.commit(toggleKeyframe(s.doc, keyClip.id, s.playheadUs), "Keyframe");
                },
              }
            : null
        }
      />

      {!fullscreen && (
        <>
          {!photoMode && <TimelineView
            missing={missing}
            onAddMedia={() => addPicker.current?.click()}
            onAddAudio={() => setPanel({ name: "audio" })}
            onAddText={onAddText}
            onCover={() => (stop(), setPanel({ name: "cover" }))}
            onToggleSound={toggleVideoSound}
            onTransition={(fromId) => {
              stop();
              setPanel({ name: "transition", fromId });
            }}
          />}

          {photoMode && (!selectedItem || selected) ? (
            // Editar foto: the picture's tools, like CapCut's photo editor
            <Toolbar label="Ferramentas da foto">
              <ToolbarItem icon={<Palette />} label="Filtros" disabled={!target} onClick={() => openLook("filters")} />
              <ToolbarItem icon={<SlidersHorizontal />} label="Ajustar" disabled={!target} onClick={() => openLook("adjust")} />
              <ToolbarItem icon={<Crop />} label="Recortar" disabled={!target} onClick={() => target && setPanel({ name: "crop", id: target.id })} />
              <ToolbarItem icon={<ScissorsSquare />} label="Remover fundo" disabled={!target} onClick={() => target && void onCutout(target)} />
              <ToolbarItem icon={<Type />} label="Texto" onClick={onAddText} />
              <ToolbarItem icon={<Smile />} label="Stickers" onClick={() => setPanel({ name: "stickers" })} />
              <ToolbarItem icon={<ImagePlus />} label="Adicionar foto" onClick={() => photoPicker.current?.click()} />
              <ToolbarItem icon={<Sparkles />} label="Efeitos" onClick={() => setPanel({ name: "effects" })} />
              <ToolbarItem icon={<ImageIcon />} label="Plano de fundo" onClick={() => setPanel({ name: "format" })} />
              <ToolbarItem icon={<RectangleHorizontal />} label="Formato" onClick={() => setPanel({ name: "format" })} />
            </Toolbar>
          ) : selectedCaption ? (
            <Toolbar
              label="Ferramentas das legendas"
              leading={
                <button type="button" aria-label="Voltar às ferramentas" onClick={() => ed.select(null)} className="flex size-11 items-center justify-center">
                  <ChevronLeft aria-hidden className="size-6" />
                </button>
              }
            >
              <ToolbarItem icon={<LayoutGrid />} label="Modelos" onClick={() => openCaptions("templates")} />
              <ToolbarItem icon={<Type />} label="Editar" onClick={() => openCaptions("edit")} />
              <ToolbarItem icon={<Palette />} label="Estilo" onClick={() => openCaptions("style")} />
              <ToolbarItem icon={<Captions />} label="Gerar de novo" onClick={() => openCaptions("generate")} />
              {laneTools}
              <ToolbarItem icon={<Trash2 />} label="Excluir" onClick={onDelete} />
            </Toolbar>
          ) : selectedEffect ? (
            <Toolbar
              label="Ferramentas do efeito"
              leading={
                <button type="button" aria-label="Voltar às ferramentas" onClick={() => ed.select(null)} className="flex size-11 items-center justify-center">
                  <ChevronLeft aria-hidden className="size-6" />
                </button>
              }
            >
              <ToolbarItem icon={<Sparkles />} label="Trocar" onClick={() => (stop(), setPanel({ name: "effects" }))} />
              <ToolbarItem icon={<Copy />} label="Duplicar" onClick={onDuplicate} />
              {laneTools}
              <ToolbarItem icon={<Trash2 />} label="Excluir" onClick={onDelete} />
            </Toolbar>
          ) : selectedOverlay ? (
            <Toolbar
              label="Ferramentas da sobreposição"
              leading={
                <button type="button" aria-label="Voltar às ferramentas" onClick={() => ed.select(null)} className="flex size-11 items-center justify-center">
                  <ChevronLeft aria-hidden className="size-6" />
                </button>
              }
            >
              {/* in CapCut's order for a layer */}
              <ToolbarItem icon={<SquarePlus />} label="Adicionar camada" onClick={() => overlayPicker.current?.click()} />
              <ToolbarItem icon={<Scissors />} label="Dividir" onClick={onSplitAudio} />
              {overlayAsset?.hasAudio && <ToolbarItem icon={<Volume2 />} label="Volume" onClick={() => setPanel({ name: "volume" })} />}
              <ToolbarItem icon={<Trash2 />} label="Excluir" onClick={onDelete} />
              <ToolbarItem icon={<Sparkles />} label="Animações" onClick={() => (stop(), setPanel({ name: "clipAnim" }))} />
              {overlayAsset?.kind === "video" && <ToolbarItem icon={<Gauge />} label="Velocidade" onClick={() => setPanel({ name: "speed" })} />}
              <ToolbarItem icon={<Crop />} label="Recortar" onClick={() => (stop(), setPanel({ name: "crop", id: selectedOverlay.id }))} />
              <ToolbarItem icon={<Copy />} label="Duplicar" onClick={onDuplicate} />
              <ToolbarItem icon={<Replace />} label="Substituir" onClick={() => setPanel({ name: "missing", assetId: selectedOverlay.assetId })} />
              <ToolbarItem icon={<Shuffle />} label="Faixa principal" onClick={onLayerToMain} />
              <ToolbarItem icon={<SlidersHorizontal />} label="Ajustar" onClick={() => openLook("adjust")} />
              <ToolbarItem icon={<Palette />} label="Filtros" onClick={() => openLook("filters")} />
              {overlayAsset?.kind === "image" && <ToolbarItem icon={<ScissorsSquare />} label="Remover fundo" onClick={() => void onCutout(selectedOverlay)} />}
              <ToolbarItem icon={<Blend />} label="Opacidade" onClick={() => setPanel({ name: "opacity" })} />
              <ToolbarItem icon={<Blend />} label="Mistura" onClick={() => setPanel({ name: "opacity" })} />
              {overlayAsset?.hasAudio && <ToolbarItem icon={<Split />} label="Extrair som" onClick={onExtract} />}
              {overlayAsset?.hasAudio && (
                <ToolbarItem icon={<AudioWaveform />} label={selectedOverlay.denoise ? "Ruído: reduzido" : "Reduzir ruído"} onClick={() => toggleDenoise(selectedOverlay)} />
              )}
              {overlayAsset?.hasAudio && <ToolbarItem icon={<Speech />} label="Efeito de voz" onClick={() => (stop(), setPanel({ name: "voice" }))} />}
              {overlayAsset?.kind === "video" && (
                <ToolbarItem icon={<FlipHorizontal2 />} label={selectedOverlay.reverse ? "Desinverter" : "Reverso"} onClick={() => void onReverse()} />
              )}
              <ToolbarItem icon={<Circle />} label="Máscara" onClick={() => (stop(), setPanel({ name: "mask" }))} />
              <ToolbarItem icon={<Pipette />} label="Chroma key" onClick={() => (stop(), setPanel({ name: "chroma" }))} />
              <ToolbarItem icon={<Waves />} label="Fade" onClick={() => setPanel({ name: "fade" })} />
              {laneTools}
            </Toolbar>
          ) : selectedAudio ? (
            <Toolbar
              label="Ferramentas do áudio"
              leading={
                <button type="button" aria-label="Voltar às ferramentas" onClick={() => ed.select(null)} className="flex size-11 items-center justify-center">
                  <ChevronLeft aria-hidden className="size-6" />
                </button>
              }
            >
              <ToolbarItem icon={<Volume2 />} label="Volume" onClick={() => setPanel({ name: "volume" })} />
              <ToolbarItem icon={<Waves />} label="Fade" onClick={() => setPanel({ name: "fade" })} />
              <ToolbarItem icon={<Scissors />} label="Dividir" onClick={onSplitAudio} />
              <ToolbarItem icon={<Music2 />} label="Batidas" onClick={() => (stop(), setPanel({ name: "beats" }))} />
              <ToolbarItem icon={<AudioWaveform />} label={selectedAudio.denoise ? "Ruído: reduzido" : "Reduzir ruído"} onClick={() => toggleDenoise(selectedAudio)} />
              <ToolbarItem icon={<Speech />} label="Efeito de voz" onClick={() => (stop(), setPanel({ name: "voice" }))} />
              <ToolbarItem icon={<Copy />} label="Duplicar" onClick={onDuplicate} />
              {laneTools}
              <ToolbarItem icon={<Trash2 />} label="Excluir" onClick={onDelete} />
            </Toolbar>
          ) : selectedText ? (
            <Toolbar
              label="Ferramentas do texto"
              leading={
                <button type="button" aria-label="Voltar às ferramentas" onClick={() => ed.select(null)} className="flex size-11 items-center justify-center">
                  <ChevronLeft aria-hidden className="size-6" />
                </button>
              }
            >
              <ToolbarItem icon={<Type />} label="Editar" onClick={() => editText(selectedText.id, "text")} />
              <ToolbarItem icon={<Palette />} label="Estilo" onClick={() => editText(selectedText.id, "style")} />
              <ToolbarItem icon={<Sparkles />} label="Animação" onClick={() => editText(selectedText.id, "anim")} />
              <ToolbarItem icon={<Speech />} label="Texto para fala" onClick={() => void onSpeak()} />
              <ToolbarItem icon={<Copy />} label="Duplicar" onClick={onDuplicate} />
              {laneTools}
              <ToolbarItem icon={<Trash2 />} label="Excluir" onClick={onDelete} />
            </Toolbar>
          ) : clipTools ? (
            <Toolbar
              label="Ferramentas do clipe"
              leading={
                <button type="button" aria-label="Voltar às ferramentas" onClick={() => ed.select(null)} className="flex size-11 items-center justify-center">
                  <ChevronLeft aria-hidden className="size-6" />
                </button>
              }
            >
              <ToolbarItem icon={<Scissors />} label="Dividir" onClick={onSplit} disabled={!doc || !target || !canSplit(doc, target.id, playheadUs)} />
              <ToolbarItem icon={<Gauge />} label="Velocidade" onClick={() => setPanel({ name: "speed" })} />
              <ToolbarItem
                icon={<Volume2 />}
                label="Volume"
                disabled={assets.get(selected!.assetId)?.kind !== "video"}
                onClick={() => setPanel({ name: "volume" })}
              />
              <ToolbarItem
                icon={<Waves />}
                label="Fade"
                disabled={!assets.get(selected!.assetId)?.hasAudio}
                onClick={() => setPanel({ name: "fade" })}
              />
              <ToolbarItem icon={<Palette />} label="Filtros" onClick={() => openLook("filters")} />
              <ToolbarItem icon={<SlidersHorizontal />} label="Ajustar" onClick={() => openLook("adjust")} />
              <ToolbarItem
                icon={<AudioWaveform />}
                label={selected?.denoise ? "Ruído: reduzido" : "Reduzir ruído"}
                disabled={!assets.get(selected!.assetId)?.hasAudio}
                onClick={() => toggleDenoise(selected!)}
              />
              <ToolbarItem
                icon={<Speech />}
                label="Efeito de voz"
                disabled={!assets.get(selected!.assetId)?.hasAudio}
                onClick={() => (stop(), setPanel({ name: "voice" }))}
              />
              <ToolbarItem icon={<Split />} label="Extrair som" disabled={!targetAsset?.hasAudio} onClick={onExtract} />
              <ToolbarItem icon={<ArrowLeft />} label="Mover ←" disabled={mainIndex <= 0} onClick={() => moveSelected(-1)} />
              <ToolbarItem icon={<ArrowRight />} label="Mover →" disabled={mainIndex < 0 || mainIndex >= mainCount - 1} onClick={() => moveSelected(1)} />
              <ToolbarItem icon={<Copy />} label="Duplicar" onClick={onDuplicate} />
              {laneTools}
              <ToolbarItem icon={<Trash2 />} label="Excluir" onClick={onDelete} />
              <ToolbarItem icon={<Replace />} label="Substituir" onClick={() => setPanel({ name: "missing", assetId: selected!.assetId })} />
              <ToolbarItem icon={<Circle />} label="Máscara" onClick={() => (stop(), setPanel({ name: "mask" }))} />
              <ToolbarItem icon={<Sparkles />} label="Animação" onClick={() => (stop(), setPanel({ name: "clipAnim" }))} />
              <ToolbarItem icon={<Crop />} label="Recortar" onClick={() => (stop(), setPanel({ name: "crop", id: selected!.id }))} />
              <ToolbarItem
                icon={<FlipHorizontal2 />}
                label={selected?.reverse ? "Desinverter" : "Inverter"}
                disabled={assets.get(selected!.assetId)?.kind !== "video" || !!selected?.freeze}
                onClick={() => void onReverse()}
              />
              <ToolbarItem icon={<Snowflake />} label="Congelar" disabled={assets.get(selected!.assetId)?.kind !== "video" || !!selected?.freeze} onClick={onFreeze} />
            </Toolbar>
          ) : (
            <Toolbar label="Ferramentas">
              <ToolbarItem icon={<Scissors />} label="Editar" disabled={!target} onClick={() => target && ed.select(target.id)} />
              <ToolbarItem icon={<AudioLines />} label="Áudio" disabled={totalUs === 0} onClick={() => setPanel({ name: "audio" })} />
              <ToolbarItem
                icon={videoMuted ? <VolumeX /> : <Volume2 />}
                label={videoMuted ? "Sem som" : "Som do vídeo"}
                active={videoMuted}
                disabled={totalUs === 0}
                onClick={toggleVideoSound}
              />
              <ToolbarItem icon={<Type />} label="Texto" disabled={totalUs === 0} onClick={onAddText} />
              <ToolbarItem icon={<Captions />} label="Legendas" disabled={totalUs === 0} onClick={() => openCaptions(captionTrack(doc!) ? "edit" : "generate")} />
              <ToolbarItem icon={<Smile />} label="Stickers" disabled={totalUs === 0} onClick={() => (stop(), setPanel({ name: "stickers" }))} />
              <ToolbarItem icon={<Layers />} label="Camada" disabled={totalUs === 0} onClick={() => overlayPicker.current?.click()} />
              <ToolbarItem icon={<PanelsTopLeft />} label="Tela dividida" disabled={totalUs === 0} onClick={() => (stop(), setPanel({ name: "layout" }))} />
              <ToolbarItem icon={<Sparkles />} label="Efeitos" disabled={totalUs === 0} onClick={() => (stop(), setPanel({ name: "effects" }))} />
              <ToolbarItem icon={<Palette />} label="Filtros" disabled={!target} onClick={() => openLook("filters")} />
              <ToolbarItem icon={<SlidersHorizontal />} label="Ajustar" disabled={!target} onClick={() => openLook("adjust")} />
              <ToolbarItem icon={<RectangleHorizontal />} label="Formato" onClick={() => setPanel({ name: "format" })} />
            </Toolbar>
          )}
        </>
      )}

      <FilePicker ref={addPicker} onFiles={(f) => void onAddFiles(f)} />
      <FilePicker ref={replacePicker} onFiles={(f) => void onReplaceFiles(f)} />
      <FilePicker ref={bgPicker} accept="image/*" onFiles={(f) => void onBgImage(f)} />
      <FilePicker ref={coverPicker} accept="image/*" onFiles={(f) => void onCoverImage(f)} />
      <FilePicker ref={photoPicker} accept="image/*" onFiles={(f) => void onAddOverlay(f)} />
      <FilePicker ref={layoutPicker} onFiles={(f) => void onLayoutFiles(f)} />
      <LayoutSheet
        open={panel?.name === "layout"}
        aspect={frame.width / frame.height}
        layers={doc ? overlaysAt(doc, playheadUs).length : 0}
        onPick={onLayout}
        onClose={() => setPanel(null)}
      />
      <CoverSheet
        open={panel?.name === "cover"}
        cover={doc?.cover ?? null}
        totalUs={totalUs}
        playheadUs={playheadUs}
        onSeek={(us) => ed.setPlayhead(us)}
        onPick={pickCover}
        onPhoto={() => coverPicker.current?.click()}
        onClose={() => setPanel(null)}
      />
      <FilePicker ref={overlayPicker} onFiles={(f) => void onAddOverlay(f)} />
      <FilePicker ref={audioPicker} accept="audio/*,.mp3,.m4a,.wav,.aac" onFiles={(f) => void onAddMusic(f)} />

      <CaptionSheet
        open={panel?.name === "captions"}
        tab={panel?.name === "captions" ? panel.tab : "generate"}
        onTab={(tab) => setPanel({ name: "captions", tab })}
        onClose={() => closeEditing("Editar legendas")}
        onBeforeRun={() => {
          player.current?.release();
          setMediaReleased(true);
        }}
        onAfterRun={() => {
          setMediaReleased(false);
          void player.current?.showAt(useEditor.getState().playheadUs);
        }}
      />

      <TransitionSheet
        fromId={panel?.name === "transition" ? panel.fromId : null}
        onPreview={(fromId) => {
          // play a little before to a little after the cut
          const d = useEditor.getState().draft;
          const t = d?.transitions.find((x) => x.fromClipId === fromId);
          const cut = d?.tracks[0] && t ? findItem(d, t.toClipId)?.clip.startUs : undefined;
          if (!t || cut === undefined) return;
          player.current?.playRange(Math.max(0, cut - t.durationUs / 2 - 400_000), cut + t.durationUs / 2 + 400_000);
        }}
        onClose={() => {
          stop();
          closeEditing("Transição");
        }}
      />

      <AudioMenu
        open={panel?.name === "audio"}
        onOpenChange={(o) => !o && setPanel(null)}
        onMusic={() => audioPicker.current?.click()}
        canExtract={!!targetAsset?.hasAudio}
        onExtract={onExtract}
        onRecord={() => setPanel({ name: "record" })}
        onSfx={() => setPanel({ name: "sfx" })}
      />
      <Sheet open={panel?.name === "voice"} onOpenChange={(o) => !o && closeEditing("Efeito de voz")} title="Efeito de voz">
        {(selectedAudio ?? selectedOverlay ?? selected) && (
          <OptionGrid
            label="Efeito de voz"
            value={(selectedAudio ?? selectedOverlay ?? selected)!.voiceFx ?? null}
            onChange={(id) => {
              const s = useEditor.getState();
              ed.setDraft(setItem(s.draft ?? s.doc!, (selectedAudio ?? selectedOverlay ?? selected)!.id, { voiceFx: id }));
            }}
            options={VOICE_FX.map((v) => ({ id: v.id, label: v.label, preview: <span className="text-2xl">{v.emoji}</span> }))}
          />
        )}
        <p className="mt-3 text-xs text-text-muted">Toque em ▶ depois de fechar para ouvir. Vale para a prévia e para o vídeo exportado.</p>
      </Sheet>
      <SfxSheet open={panel?.name === "sfx"} onOpenChange={(o) => !o && setPanel(null)} onAdd={(id) => void onAddSfx(id)} />
      <FadeSheet
        clip={panel?.name === "fade" ? selectedMedia : null}
        onChange={(p) => selectedMedia && ed.setDraft(setItem(useEditor.getState().doc!, selectedMedia.id, p))}
        onClose={() => closeEditing("Fade")}
      />
      <RecordSheet
        open={panel?.name === "record"}
        onOpenChange={(o) => !o && setPanel(null)}
        cursorUs={() => useEditor.getState().playheadUs}
        onStartPlayback={() => {
          if (!player.current) return;
          player.current.monitorMuted = true;
          player.current.play();
        }}
        onStopPlayback={() => {
          if (!player.current) return;
          player.current.pause();
          player.current.monitorMuted = false;
        }}
        onDone={(file, at) => void onRecorded(file, at)}
        onError={(m) => toast(m, "error")}
      />

      <Sheet open={panel?.name === "speed"} onOpenChange={(o) => !o && closeEditing("Velocidade")} title="Velocidade">
        {speedClip && doc && (
          <div className="flex flex-col gap-4">
            {/* logarithmic: the same drag covers 0.1x-1x, 1x-10x and 10x-100x */}
            <Slider
              label="Velocidade"
              value={Math.round(Math.log10(speedClip.speed) * 100) / 100}
              min={-1}
              max={2}
              step={0.01}
              defaultValue={0}
              format={(v) => formatSpeed(10 ** v)}
              onChange={(v) => setSpeed(10 ** v)}
            />
            <div role="radiogroup" aria-label="Velocidades prontas" className="flex flex-wrap gap-2">
              {[0.25, 0.5, 1, 2, 4, 10, 50, 100].map((v) => (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={speedClip.speed === v}
                  onClick={() => setSpeed(v)}
                  className={cn(
                    "h-9 min-w-12 rounded-pill border px-3 text-sm",
                    speedClip.speed === v ? "border-accent bg-accent text-on-accent" : "border-border-input",
                  )}
                >
                  {formatSpeed(v)}
                </button>
              ))}
            </div>
          </div>
        )}
        {selected && (
          <div className="mt-5 flex flex-col gap-2">
            <span className="text-xs text-text-muted">Curva (a velocidade muda ao longo do clipe)</span>
            <OptionGrid
              label="Curva de velocidade"
              value={SPEED_CURVES.find((c) => JSON.stringify(c.points) === JSON.stringify(selected.speedCurve))?.id ?? null}
              onChange={(id) => {
                const c = SPEED_CURVES.find((x) => x.id === id);
                const s = useEditor.getState();
                ed.setDraft(setClip(s.draft ?? s.doc!, selected.id, { speedCurve: c ? c.points : null }));
              }}
              options={SPEED_CURVES.map((c) => ({ id: c.id, label: c.label, preview: <CurveIcon points={c.points} /> }))}
            />
            {selected.speedCurve?.length ? (
              <CurveEditor
                points={selected.speedCurve}
                onChange={(points) => {
                  const s = useEditor.getState();
                  ed.setDraft(setClip(s.draft ?? s.doc!, selected.id, { speedCurve: points }));
                }}
                onDone={() => {}}
              />
            ) : null}
          </div>
        )}
        <p className="mt-3 text-xs text-text-muted">Acima de 16x a prévia toca a 16x; o vídeo exportado sai na velocidade escolhida. Com uma curva, a velocidade fixa fica sem efeito.</p>
      </Sheet>

      <Sheet open={panel?.name === "stickers"} onOpenChange={(o) => !o && setPanel(null)} title="Stickers">
        <div role="list" aria-label="Stickers" className="grid grid-cols-6 gap-2">
          {STICKERS.map((e) => (
            <button key={e} type="button" role="listitem" aria-label={`Sticker ${e}`} onClick={() => onSticker(e)} className="flex aspect-square items-center justify-center rounded-md bg-surface-2 text-3xl">
              {e}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-text-muted">Depois de pôr, arraste e aumente na prévia. Em Animação → Repetir, ele pode pulsar, quicar ou balançar.</p>
      </Sheet>

      <Sheet open={panel?.name === "effects"} onOpenChange={(o) => !o && setPanel(null)} title={selectedEffect ? "Trocar efeito" : "Efeitos"}>
        <OptionGrid
          label="Efeitos"
          allowNone={false}
          value={selectedEffect?.effectId ?? null}
          onChange={(id) => id && onEffect(id)}
          options={EFFECTS.map((e) => ({ id: e.id, label: e.label, preview: <span className="text-3xl">{e.emoji}</span> }))}
        />
        <p className="mt-3 text-xs text-text-muted">O efeito entra no cursor por 3 s; puxe as pontas dele na linha do tempo para mudar a duração.</p>
      </Sheet>

      <Sheet open={panel?.name === "beats"} onOpenChange={(o) => !o && setPanel(null)} title="Batidas">
        {selectedAudio && (
          <div className="flex flex-col gap-3">
            <p className="text-sm">
              {(selectedAudio.beats?.length ?? 0) > 0 ? `${selectedAudio.beats!.length} batidas marcadas` : "Nenhuma batida marcada"}
            </p>
            <Button variant="primary" loading={findingBeats} onClick={() => void onAutoBeats()}>
              Marcar automaticamente
            </Button>
            <Button onClick={onBeatHere}>Marcar / apagar no cursor</Button>
            <Button variant="ghost" disabled={!selectedAudio.beats?.length} onClick={() => {
              const s = useEditor.getState();
              if (s.doc) s.commit(setBeats(s.doc, selectedAudio.id, []), "Limpar batidas");
            }}>
              Apagar todas
            </Button>
            <p className="text-xs text-text-muted">As marcas aparecem como pontos amarelos na música; textos, fotos e cortes grudam nelas quando você arrasta.</p>
          </div>
        )}
      </Sheet>

      <ClipAnimSheet
        clip={panel?.name === "clipAnim" ? (selectedOverlay ?? selected ?? null) : null}
        onChange={changeMasked}
        onClose={() => closeEditing("Animação")}
      />
      <MaskSheet clip={panel?.name === "mask" ? (selectedOverlay ?? selected ?? null) : null} onChange={changeMasked} onClose={() => closeEditing("Máscara")} />
      <ChromaSheet clip={panel?.name === "chroma" ? selectedOverlay : null} onChange={changeOverlay} onClose={() => closeEditing("Chroma key")} />

      <CropSheet clip={cropClip} layer={cropHit?.track.kind === "overlay"} asset={cropClip ? assets.get(cropClip.assetId) : undefined} onChange={changeCrop} onClose={() => closeEditing("Recortar")} />

      <FilterSheet
        clip={panel?.name === "filters" ? lookClip : null}
        thumb={lookClip ? useEditor.getState().thumbs.get(lookClip.assetId)?.urls[0] : undefined}
        onChange={changeLook}
        onApplyAll={lookIsMain ? () => lookToAll((c) => ({ filter: c.filter })) : undefined}
        onClose={() => closeEditing("Filtro")}
      />
      <AdjustSheet
        clip={panel?.name === "adjust" ? lookClip : null}
        onChange={changeLook}
        onApplyAll={lookIsMain ? () => lookToAll((c) => ({ adjust: c.adjust })) : undefined}
        onClose={() => closeEditing("Ajustar")}
      />

      <Sheet open={panel?.name === "opacity"} onOpenChange={(o) => !o && closeEditing("Mistura")} title="Opacidade e mistura">
        {selectedOverlay && (
          <div className="flex flex-col gap-4">
            <div role="radiogroup" aria-label="Modo de mistura" className="flex flex-wrap gap-2">
              {BLENDS.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedOverlay.blendMode === b.id}
                  onClick={() => ed.setDraft(setItem(useEditor.getState().draft ?? useEditor.getState().doc!, selectedOverlay.id, { blendMode: b.id }))}
                  className={cn(
                    "h-9 rounded-pill border px-3 text-sm",
                    selectedOverlay.blendMode === b.id ? "border-accent bg-accent text-on-accent" : "border-border-input",
                  )}
                >
                  {b.label}
                </button>
              ))}
            </div>
            <Slider
              label="Opacidade"
              value={Math.round(selectedOverlay.opacity * 100)}
              min={0}
              max={100}
              defaultValue={100}
              format={(v) => `${v}%`}
              onChange={(v) => ed.setDraft(setItem(useEditor.getState().draft ?? useEditor.getState().doc!, selectedOverlay.id, { opacity: v / 100 }))}
            />
          </div>
        )}
      </Sheet>

      <Sheet open={panel?.name === "volume"} onOpenChange={(o) => !o && closeEditing("Volume")} title="Volume">
        {selectedMedia && (
          <>
            <Slider
              label="Volume"
              value={Math.round(volumeAt(selectedMedia, playheadUs - selectedMedia.startUs) * 100)}
              min={0}
              max={200}
              defaultValue={100}
              format={(v) => `${v}%`}
              onChange={(v) => {
                const s = useEditor.getState();
                ed.setDraft(setVolumeAt(s.draft ?? s.doc!, selectedMedia.id, s.playheadUs, v / 100));
              }}
            />
            {selectedMedia.keyframes.length > 0 && (
              <p className="mt-3 text-xs text-text-muted">Este clipe tem keyframes: o volume muda no keyframe do cursor (ou cria um).</p>
            )}
          </>
        )}
      </Sheet>

      <Sheet open={panel?.name === "format"} onOpenChange={(o) => !o && setPanel(null)} title="Formato">
        {doc && (
          <div className="flex flex-col gap-5">
            <div role="radiogroup" aria-label="Proporção" className="grid grid-cols-3 gap-2">
              {ASPECT_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={doc.canvas.aspectRatio === o.value}
                  onClick={() => {
                    const d = useEditor.getState().doc!;
                    ed.commit({ ...d, canvas: { ...d.canvas, aspectRatio: o.value } }, "Proporção");
                  }}
                  className={cn(
                    "h-11 rounded-md border text-sm",
                    doc.canvas.aspectRatio === o.value ? "border-accent bg-accent text-on-accent" : "border-border-input",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <div role="radiogroup" aria-label="Cor do fundo" className="flex flex-wrap gap-3">
              <button
                type="button"
                role="radio"
                aria-checked={blurBg}
                aria-label="Fundo desfocado"
                onClick={() => {
                  const d = useEditor.getState().doc!;
                  ed.commit({ ...d, canvas: { ...d.canvas, background: { type: "blur", amount: 30 } } }, "Fundo");
                }}
                className={cn(
                  "flex h-11 items-center rounded-pill border border-border-input px-4 text-sm",
                  blurBg && "ring-2 ring-accent ring-offset-2 ring-offset-surface",
                )}
              >
                Desfocado
              </button>
              {BACKGROUNDS.map((c) => {
                const on = doc.canvas.background.type === "color" && doc.canvas.background.color === c;
                return (
                  <button
                    key={c}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`Fundo ${c}`}
                    onClick={() => {
                      const d = useEditor.getState().doc!;
                      ed.commit({ ...d, canvas: { ...d.canvas, background: { type: "color", color: c } } }, "Fundo");
                    }}
                    className={cn("size-11 rounded-pill border border-border-input", on && "ring-2 ring-accent ring-offset-2 ring-offset-surface")}
                    style={{ background: c }}
                  />
                );
              })}
            </div>
            <div role="radiogroup" aria-label="Degradê de fundo" className="flex flex-wrap gap-3">
              {GRADIENTS.map((g) => {
                const b = doc.canvas.background;
                const on = b.type === "gradient" && b.colors[0] === g[0] && b.colors[1] === g[1];
                return (
                  <button
                    key={g.join()}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    aria-label={`Degradê ${g.join(" ")}`}
                    onClick={() => {
                      const d = useEditor.getState().doc!;
                      ed.commit({ ...d, canvas: { ...d.canvas, background: { type: "gradient", colors: g, angle: 160 } } }, "Fundo");
                    }}
                    className={cn("size-11 rounded-pill border border-border-input", on && "ring-2 ring-accent ring-offset-2 ring-offset-surface")}
                    style={{ background: `linear-gradient(160deg, ${g[0]}, ${g[1]})` }}
                  />
                );
              })}
              <button
                type="button"
                role="radio"
                aria-checked={doc.canvas.background.type === "image"}
                onClick={() => bgPicker.current?.click()}
                className={cn(
                  "flex h-11 items-center rounded-pill border border-border-input px-4 text-sm",
                  doc.canvas.background.type === "image" && "ring-2 ring-accent ring-offset-2 ring-offset-surface",
                )}
              >
                Foto
              </button>
            </div>
            <p className="text-xs text-text-muted">
              O fundo aparece quando o vídeo não preenche o quadro (um vídeo vertical num formato 16:9, por exemplo). Na prévia, o
              desfocado usa um quadro parado do clipe; no vídeo exportado ele acompanha o movimento.
            </p>
          </div>
        )}
      </Sheet>

      <Sheet open={panel?.name === "missing"} onOpenChange={(o) => !o && setPanel(null)} title="Substituir mídia">
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">
            {panel?.name === "missing" && missing.has(panel.assetId)
              ? "O arquivo deste clipe não está mais no app. Escolha outro para manter as edições."
              : "Escolha outro vídeo ou foto. Os cortes e ajustes do clipe continuam."}
          </p>
          <Button variant="primary" onClick={() => replacePicker.current?.click()}>
            Escolher arquivo
          </Button>
        </div>
      </Sheet>

      <TextSheet
        id={panel?.name === "text" ? panel.id : null}
        tab={panel?.name === "text" ? panel.tab : "text"}
        onTab={(tab) => panel?.name === "text" && setPanel({ ...panel, tab })}
        onClose={() => closeEditing("Editar texto")}
      />

      <ExportSheet
        open={panel?.name === "export"}
        onOpenChange={(o) => !o && setPanel(null)}
        options={exportOptions}
        onOptionsChange={setExportOptions}
        onBeforeExport={() => {
          player.current?.release();
          setMediaReleased(true);
        }}
        onAfterExport={() => {
          setMediaReleased(false);
          void player.current?.showAt(useEditor.getState().playheadUs);
        }}
      />

      {importing && <ImportOverlay progress={importing} />}
      {busy && (
        <div role="dialog" aria-modal aria-label={busy.label} className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/70 px-8">
          <div className="flex w-full max-w-xs flex-col gap-3 rounded-lg bg-surface-2 p-5 shadow-pop">
            <p className="text-sm">
              {busy.label}… {Math.round(busy.fraction * 100)}%
            </p>
            <ProgressBar value={busy.fraction} label={busy.label} />
            <p className="text-xs text-text-muted">Mantenha o app aberto.</p>
            <Button variant="ghost" onClick={() => busy.abort.abort()}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
