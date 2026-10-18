// S03 Editor, with S04 (clip tools), S05 (speed), S15 (format) and S17
// (export) as sheets. Tools that are not built yet open a stub that says so.
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Blend,
  ChevronLeft,
  Copy,
  Crop,
  FlipHorizontal2,
  Gauge,
  Layers,
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
import type { AspectRatio, Id, MediaClip } from "../data/db";
import { assetFile, onImportEvent } from "../media/import";
import { Player } from "../editor/player";
import { useEditor } from "../editor/store";
import { TimelineView } from "../editor/TimelineView";
import { TextOverlay } from "../editor/TextOverlay";
import { TextSheet, type TextTab } from "./TextSheet";
import { AudioMenu, FadeSheet, RecordSheet } from "./AudioSheets";
import { TransitionSheet } from "./TransitionSheet";
import { audio, peaksOf } from "../editor/audio";
import {
  addAudio,
  addText,
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
} from "../editor/timeline";
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
  | { name: "speed" }
  | { name: "volume" }
  | { name: "format" }
  | { name: "export" }
  | { name: "missing"; assetId: Id }
  | { name: "stub"; title: string; screen: string }
  | { name: "text"; id: Id; tab: TextTab }
  | { name: "audio" }
  | { name: "fade" }
  | { name: "record" }
  | { name: "transition"; fromId: Id };

const ASPECT_OPTIONS: { value: AspectRatio; label: string }[] = [
  { value: "original", label: "Original" },
  { value: "9:16", label: "9:16" },
  { value: "16:9", label: "16:9" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "4:3", label: "4:3" },
];
const BACKGROUNDS = ["#000000", "#ffffff", "#1f1f24", "#24324a", "#3b2a2a", "#2b3b2b"];

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement>(null);
  const dipRef = useRef<HTMLDivElement>(null);
  const stageBox = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const player = useRef<Player | null>(null);
  const addPicker = useRef<HTMLInputElement>(null);
  const replacePicker = useRef<HTMLInputElement>(null);
  const audioPicker = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "notfound">("loading");
  const [panel, setPanel] = useState<Panel>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [importing, setImporting] = useState<ImportProgress | null>(null);
  const [missing, setMissing] = useState<Set<Id>>(new Set());
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

  useEffect(() => {
    if (state !== "ready" || !videoRef.current || !canvasRef.current || !fxCanvasRef.current || !dipRef.current) return;
    const p = new Player(videoRef.current, canvasRef.current, fxCanvasRef.current, dipRef.current);
    player.current = p;
    void p.showAt(useEditor.getState().playheadUs);
    // repaint the frame under the playhead whenever it or the doc changes
    let queued = false;
    const unsub = useEditor.subscribe((s, prev) => {
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
  const selectedAudio = selectedItem?.track.kind === "audio" && selectedItem.clip.type === "media" ? selectedItem.clip : null;
  const selectedMedia: MediaClip | null = selected ?? selectedAudio;
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
  const bg = doc?.canvas.background.type === "color" ? doc.canvas.background.color : "#000000";

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
    if (!s.doc || !target || !targetAsset?.hasAudio) return;
    const r = addAudio(s.doc, targetAsset, target.startUs, target.inUs);
    let d = setItem(r.doc, r.id, { outUs: target.outUs, speed: target.speed, volume: target.volume, durationUs: target.durationUs });
    d = setClip(d, target.id, { volume: 0 });
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
    if (!s.doc || !selectedAudio) return;
    const r = splitItem(s.doc, selectedAudio.id, s.playheadUs);
    if (!r) return toast("Mova o cursor para dentro do áudio para dividir.");
    s.commit(r.doc, "Dividir áudio");
    s.select(r.rightId);
  }

  function setSpeed(v: number) {
    if (!selected) return;
    const speed = Math.min(100, Math.max(0.1, v < 1 ? Math.round(v * 100) / 100 : Math.round(v * 10) / 10));
    ed.setDraft(setClip(useEditor.getState().doc!, selected.id, { speed }));
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

  function stub(title: string, screen: string) {
    stop();
    setPanel({ name: "stub", title, screen });
  }

  const clipTools = !!selected;

  return (
    <main className="pt-safe pb-safe flex h-full flex-col bg-bg">
      <TopBar
        resolution={resolutionLabel(exportOptions.shortSide)}
        onClose={() => navigate("/")}
        onSettings={() => {
          stop();
          setPanel({ name: "export" });
        }}
        onExport={() => {
          stop();
          setPanel({ name: "export" });
        }}
      />

      <div ref={stageBox} className="relative flex min-h-0 flex-1 items-center justify-center bg-canvas" onClick={() => setFullscreen(false)}>
        {state === "loading" && <span className="text-sm text-text-muted">Abrindo projeto…</span>}
        {/* the project frame: its shape follows the aspect ratio */}
        <div
          className={cn("relative overflow-hidden", state !== "ready" && "hidden")}
          style={{ width: stage.w, height: stage.h, background: bg }}
        >
          <video
            ref={videoRef}
            aria-label="Prévia do vídeo"
            playsInline
            className="pointer-events-none absolute inset-0 size-full object-contain"
          />
          <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" style={{ visibility: "hidden" }} />
          {/* transitions: the clip that is not playing, as a still, and the dip colour */}
          <canvas ref={fxCanvasRef} aria-hidden className="pointer-events-none absolute inset-0 size-full" style={{ visibility: "hidden" }} />
          <div ref={dipRef} aria-hidden className="pointer-events-none absolute inset-0 z-[3]" style={{ opacity: 0 }} />
          {state === "ready" && stage.w > 0 && <TextOverlay width={stage.w} height={stage.h} onEdit={(id) => editText(id)} />}
        </div>
        {state === "ready" && totalUs === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
            <p className="text-sm">Projeto vazio</p>
            <Button variant="primary" onClick={() => addPicker.current?.click()}>
              Adicionar mídia
            </Button>
          </div>
        )}
        {copying.size > 0 && (
          <span role="status" className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-pill bg-surface-3/90 px-3 py-1 text-xs text-text">
            Guardando {copying.size > 1 ? `${copying.size} vídeos` : "vídeo"} no app…{" "}
            {Math.round(([...copying.values()].reduce((a, b) => a + b, 0) / copying.size) * 100)}%
          </span>
        )}
        {saveState === "error" && (
          <span role="alert" className="absolute left-2 top-2 rounded-sm bg-danger px-2 py-1 text-xs text-on-danger">
            Não foi possível salvar
          </span>
        )}
      </div>

      <Transport
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
      />

      {!fullscreen && (
        <>
          <TimelineView
            missing={missing}
            onAddMedia={() => addPicker.current?.click()}
            onTransition={(fromId) => {
              stop();
              setPanel({ name: "transition", fromId });
            }}
          />

          {selectedAudio ? (
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
              <ToolbarItem icon={<Copy />} label="Duplicar" onClick={onDuplicate} />
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
              <ToolbarItem icon={<Copy />} label="Duplicar" onClick={onDuplicate} />
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
              <ToolbarItem icon={<Split />} label="Extrair som" disabled={!targetAsset?.hasAudio} onClick={onExtract} />
              <ToolbarItem icon={<ArrowLeft />} label="Mover ←" disabled={mainIndex <= 0} onClick={() => moveSelected(-1)} />
              <ToolbarItem icon={<ArrowRight />} label="Mover →" disabled={mainIndex < 0 || mainIndex >= mainCount - 1} onClick={() => moveSelected(1)} />
              <ToolbarItem icon={<Copy />} label="Duplicar" onClick={onDuplicate} />
              <ToolbarItem icon={<Trash2 />} label="Excluir" onClick={onDelete} />
              <ToolbarItem icon={<Replace />} label="Substituir" onClick={() => setPanel({ name: "missing", assetId: selected!.assetId })} />
              <ToolbarItem icon={<Crop />} label="Recortar" onClick={() => stub("Recortar", "S04")} />
              <ToolbarItem icon={<FlipHorizontal2 />} label="Inverter" onClick={() => stub("Inverter", "S04")} />
              <ToolbarItem icon={<Snowflake />} label="Congelar" onClick={() => stub("Congelar", "S04")} />
              <ToolbarItem icon={<Blend />} label="Mistura" onClick={() => stub("Mistura", "S12")} />
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
              <ToolbarItem icon={<Smile />} label="Stickers" onClick={() => stub("Stickers", "S13")} />
              <ToolbarItem icon={<Layers />} label="Sobrepor" onClick={() => stub("Sobrepor", "S12")} />
              <ToolbarItem icon={<Sparkles />} label="Efeitos" onClick={() => stub("Efeitos", "S13")} />
              <ToolbarItem icon={<Palette />} label="Filtros" onClick={() => stub("Filtros", "S14")} />
              <ToolbarItem icon={<SlidersHorizontal />} label="Ajustar" onClick={() => stub("Ajustar", "S14")} />
              <ToolbarItem icon={<RectangleHorizontal />} label="Formato" onClick={() => setPanel({ name: "format" })} />
            </Toolbar>
          )}
        </>
      )}

      <FilePicker ref={addPicker} onFiles={(f) => void onAddFiles(f)} />
      <FilePicker ref={replacePicker} onFiles={(f) => void onReplaceFiles(f)} />
      <FilePicker ref={audioPicker} accept="audio/*,.mp3,.m4a,.wav,.aac" onFiles={(f) => void onAddMusic(f)} />

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
      />
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
        {selected && doc && (
          <div className="flex flex-col gap-4">
            {/* logarithmic: the same drag covers 0.1x-1x, 1x-10x and 10x-100x */}
            <Slider
              label="Velocidade"
              value={Math.round(Math.log10(selected.speed) * 100) / 100}
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
                  aria-checked={selected.speed === v}
                  onClick={() => setSpeed(v)}
                  className={cn(
                    "h-9 min-w-12 rounded-pill border px-3 text-sm",
                    selected.speed === v ? "border-accent bg-accent text-on-accent" : "border-border-input",
                  )}
                >
                  {formatSpeed(v)}
                </button>
              ))}
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-text-muted">Acima de 16x a prévia toca a 16x; o vídeo exportado sai na velocidade escolhida.</p>
      </Sheet>

      <Sheet open={panel?.name === "volume"} onOpenChange={(o) => !o && closeEditing("Volume")} title="Volume">
        {selectedMedia && (
          <Slider
            label="Volume"
            value={Math.round(selectedMedia.volume * 100)}
            min={0}
            max={200}
            defaultValue={100}
            format={(v) => `${v}%`}
            onChange={(v) => ed.setDraft(setItem(useEditor.getState().doc!, selectedMedia.id, { volume: v / 100 }))}
          />
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
            <div role="radiogroup" aria-label="Cor do fundo" className="flex gap-3">
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
            <p className="text-xs text-text-muted">Fundo desfocado chega com o novo motor de prévia.</p>
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

      <Sheet open={panel?.name === "stub"} onOpenChange={(o) => !o && setPanel(null)} title={panel?.name === "stub" ? panel.title : ""}>
        <p className="text-sm text-text-muted">
          Esta ferramenta ainda não foi construída ({panel?.name === "stub" ? panel.screen : ""}). Ela está no plano, em{" "}
          <code className="font-mono text-xs">replica/features.csv</code>.
        </p>
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
        onBeforeExport={() => player.current?.release()}
        onAfterExport={() => void player.current?.showAt(useEditor.getState().playheadUs)}
      />

      {importing && <ImportOverlay progress={importing} />}
    </main>
  );
}
