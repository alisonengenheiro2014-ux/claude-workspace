// Teleprompter, like CapCut's: write or pick a script (no length limit),
// then the camera fills the screen with the text in a box near the lens.
// Recording starts after a countdown and the text scrolls at reading pace;
// tap it to pause, drag it to move. The take is watched, redone, saved to the
// phone or used in a project (a new one, or appended to the one it came from).
import { Camera, Check, ChevronLeft, Delete, FlipHorizontal2, Smartphone, Pencil, Plus, Settings2, SwitchCamera, Trash2, X, Zap, ZapOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type TouchEvent as ReactTouchEvent } from "react";
import { runImport } from "../app/importFlow";
import { waitForAssetsDurable } from "../media/import";
import { navigate } from "../app/router";
import { shareFile } from "../data/backup";
import { createProject, loadProject, removeProject, saveDoc } from "../data/projects";
import {
  loadScripts,
  loadSettings,
  pxPerSecond,
  readingSeconds,
  recorderType,
  saveScripts,
  saveSettings,
  titleOf,
  videoBitrate,
  wordsOf,
  wpmOf,
  uiTurn,
  frameOf,
  pictureTurn,
  poseOf,
  type Pose,
  type PrompterSettings,
  type Script,
} from "../editor/prompter";
import { durationOf, insertMedia } from "../editor/timeline";
import { VERSION } from "../app/version";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";
import { useToast } from "../ui/Toast";
import { formatTime } from "../ui/Transport";
import { actualVideoLabel, boundZoom, digitalZoomFactor, nativeZoomRange, targetVideoSize, type CameraZoomRange } from "../editor/cameraCapture";

type Step = "scripts" | "edit" | "camera" | "review";
const REC = "#ff3b30"; // the record button's red, on camera (raw: no theme token fits)
const COLORS = ["#ffffff", "#ffd400", "#00e5ff", "#7CFF6B", "#ff8a3d"];

// "4K · 3840×2160 · 30 fps": the frame being recorded, the camera's own pixels
function qualityLabel(size: { w: number; h: number }, fps: number) {
  return `${actualVideoLabel(size.w, size.h)} · ${size.w}×${size.h} · ${Math.round(fps)} fps`;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

// One camera for the whole visit to the teleprompter: the iPhone asks for
// camera and microphone every time they are opened anew, so they stay open
// across scripts, edits and takes, and are closed when the teleprompter is
// left. The microphone is kept apart from the picture: turning the camera,
// or a new quality, opens only a new picture (with a capture running the
// phone does not ask again) and the recording goes on, sound and all.
let shared: { video: MediaStream; audio: MediaStreamTrack | null; key: string } | null = null;
async function openCamera(key: string, video: MediaTrackConstraints) {
  const live = shared && shared.video.getVideoTracks().every((t) => t.readyState === "live");
  if (shared && live && shared.key === key) return shared;
  const wantAudio = !shared?.audio || shared.audio.readyState !== "live";
  const got = await navigator.mediaDevices.getUserMedia({ video, audio: wantAudio ? { echoCancellation: true, noiseSuppression: true } : false });
  const old = shared;
  const audio = wantAudio ? (got.getAudioTracks()[0] ?? null) : (old?.audio ?? null);
  shared = { video: new MediaStream(got.getVideoTracks()), audio, key };
  old?.video.getTracks().forEach((t) => t.stop());
  return shared;
}
function closeCamera() {
  shared?.video.getTracks().forEach((t) => t.stop());
  shared?.audio?.stop();
  shared = null;
}

export function Teleprompter({ projectId }: { projectId?: string }) {
  useEffect(() => closeCamera, []); // leaving the teleprompter turns the camera off
  const toast = useToast();
  const [step, setStep] = useState<Step>("scripts");
  const [scripts, setScripts] = useState<Script[]>(loadScripts);
  const [script, setScript] = useState<Script | null>(null);
  const [settings, setSettingsState] = useState<PrompterSettings>(loadSettings);
  const setSettings = (p: Partial<PrompterSettings>) =>
    setSettingsState((s) => {
      const next = { ...s, ...p };
      saveSettings(next);
      return next;
    });
  // the takes recorded so far (CapCut's segments) and where the text is:
  // both survive editing the script or watching the takes
  const [segments, setSegments] = useState<Segment[]>([]);
  const scroll = useRef(0);
  const back = () => navigate(projectId ? `/p/${projectId}` : "/");

  function persist(next: Script) {
    const list = [next, ...scripts.filter((s) => s.id !== next.id)];
    setScripts(list);
    if (!saveScripts(list)) toast("Sem espaço para guardar o roteiro no aparelho; ele fica só até fechar o app.", "error");
  }

  if (step === "scripts")
    return (
      <main className="pt-safe pb-safe mx-auto flex h-full max-w-[440px] flex-col bg-bg">
        <header className="flex h-[var(--layout-topbar)] items-center gap-2 px-2">
          <button type="button" aria-label="Voltar" onClick={back} className="flex size-11 items-center justify-center">
            <ChevronLeft aria-hidden className="size-6" />
          </button>
          <h1 className="flex-1 text-lg font-semibold">Teleprompter</h1>
        </header>
        <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          <Button
            variant="primary"
            size="lg"
            icon={<Plus aria-hidden className="size-5" />}
            onClick={() => {
              setScript({ id: crypto.randomUUID(), title: "", text: "", updatedAt: Date.now() });
              setStep("edit");
            }}
          >
            Novo roteiro
          </Button>
          {scripts.length === 0 && <p className="py-8 text-center text-sm text-text-muted">Escreva ou cole o texto que você vai falar. Não tem limite de tamanho.</p>}
          <p className="order-last pt-4 text-center text-[11px] text-text-subtle">Versão {VERSION}</p>
          <ul className="flex flex-col gap-2">
            {scripts.map((s) => (
              <li key={s.id} className="flex items-center gap-2 rounded-md bg-surface-2 p-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
                  onClick={() => {
                    if (s.id !== script?.id) {
                      setSegments([]);
                      scroll.current = 0;
                    }
                    void askMotion(); // a full tap: the only moment the iPhone lets the sensor be asked
                    setScript(s);
                    setStep("camera");
                  }}
                >
                  <span className="truncate text-sm font-semibold">{titleOf(s.text)}</span>
                  <span className="text-xs text-text-muted">
                    {s.text.length.toLocaleString("pt-BR")} caracteres · ~{mmss(readingSeconds(s.text, settings.speed))}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Editar ${titleOf(s.text)}`}
                  onClick={() => {
                    setScript(s);
                    setStep("edit");
                  }}
                  className="flex size-11 items-center justify-center text-text-muted"
                >
                  <Pencil aria-hidden className="size-5" />
                </button>
                <button
                  type="button"
                  aria-label={`Apagar ${titleOf(s.text)}`}
                  onClick={() => {
                    const list = scripts.filter((x) => x.id !== s.id);
                    setScripts(list);
                    saveScripts(list);
                  }}
                  className="flex size-11 items-center justify-center text-text-muted"
                >
                  <Trash2 aria-hidden className="size-5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </main>
    );

  if (step === "edit" && script)
    return (
      <main className="pt-safe pb-safe mx-auto flex h-full max-w-[440px] flex-col bg-bg">
        <header className="flex h-[var(--layout-topbar)] items-center gap-2 px-2">
          <button type="button" aria-label="Voltar aos roteiros" onClick={() => setStep("scripts")} className="flex size-11 items-center justify-center">
            <ChevronLeft aria-hidden className="size-6" />
          </button>
          <h1 className="flex-1 text-lg font-semibold">Roteiro</h1>
          <Button
            variant="primary"
            size="sm"
            icon={<Camera aria-hidden className="size-4" />}
            disabled={!script.text.trim()}
            onClick={() => {
              void askMotion();
              persist({ ...script, updatedAt: Date.now() });
              setStep("camera");
            }}
          >
            Gravar
          </Button>
        </header>
        <div className="flex flex-1 flex-col gap-2 px-4 pb-4">
          <textarea
            aria-label="Texto do roteiro"
            placeholder="Escreva ou cole aqui o que você vai falar…"
            value={script.text}
            onChange={(e) => setScript({ ...script, text: e.target.value })}
            onBlur={() => script.text.trim() && persist({ ...script, updatedAt: Date.now() })}
            className="min-h-0 flex-1 resize-none rounded-md border border-border-input bg-surface-2 p-3 text-base leading-relaxed text-text"
          />
          <p className="text-xs text-text-muted">
            {script.text.length.toLocaleString("pt-BR")} caracteres · {wordsOf(script.text).toLocaleString("pt-BR")} palavras · ~{mmss(readingSeconds(script.text, settings.speed))} de leitura · sem limite
          </p>
        </div>
      </main>
    );

  if (step === "review" && segments.length)
    return (
      <Review
        takes={segments.map((g) => g.file)}
        toProject={!!projectId}
        onBack={() => setStep("camera")}
        onUse={async (onProgress) => {
          const id = await takesToProject(segments.map((g) => g.file), projectId, toast, onProgress);
          if (id) navigate(`/p/${id}`);
        }}
      />
    );

  if (step === "camera" && script)
    return (
      <CameraPrompter
        script={script}
        settings={settings}
        setSettings={setSettings}
        scroll={scroll}
        segments={segments}
        onSegment={(g) => setSegments((list) => [...list, g])}
        onDropLast={() => {
          const last = segments[segments.length - 1];
          if (last) scroll.current = last.scrollStart; // the text goes back to where that take began
          setSegments((list) => list.slice(0, -1));
        }}
        onClose={() => {
          if (segments.length && !confirm(`Descartar ${segments.length === 1 ? "o trecho gravado" : `os ${segments.length} trechos gravados`}?`)) return;
          setSegments([]);
          scroll.current = 0;
          setStep("scripts");
        }}
        onEdit={() => setStep("edit")}
        onDone={() => setStep("review")}
      />
    );

  return null;
}

// One recorded take: its file, length, and where the text was when it began.
interface Segment {
  file: File;
  seconds: number;
  scrollStart: number;
  horizontal: boolean; // the format it was recorded in: the next takes keep it
}

// The takes go into a project, in order, one clip each: appended to the
// project the teleprompter came from, or a new one.
async function takesToProject(
  files: File[],
  projectId: string | undefined,
  toast: ReturnType<typeof useToast>,
  onProgress: (fraction: number) => void,
) {
  const id = projectId ?? (await createProject()).id;
  const assets = await runImport(id, files, () => {}, toast);
  if (!assets.length) {
    if (!projectId) await removeProject(id);
    throw new Error("Não consegui importar a gravação. Use Salvar no iPhone antes de sair do teleprompter.");
  }
  if (assets.length !== files.length) {
    throw new Error("Um dos trechos não foi importado. Salve os vídeos no iPhone antes de continuar.");
  }
  // Never navigate to the editor until all original recordings are durable.
  // A reload during the background import previously lost long recordings.
  await waitForAssetsDurable(assets.map((a) => a.id), onProgress);
  const loaded = await loadProject(id);
  if (!loaded) throw new Error("Não consegui reabrir o projeto depois de salvar os vídeos.");
  await saveDoc(id, insertMedia(loaded.doc, assets, durationOf(loaded.doc)).doc);
  return id;
}

// The takes, played one after another, before they go into a project.
function Review({
  takes,
  toProject,
  onBack,
  onUse,
}: {
  takes: File[];
  toProject: boolean;
  onBack: () => void;
  onUse: (onProgress: (fraction: number) => void) => Promise<void>;
}) {
  const [urls] = useState(() => takes.map((f) => URL.createObjectURL(f)));
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const [recordedInfo, setRecordedInfo] = useState("");
  const [copyProgress, setCopyProgress] = useState(0);
  const [copyError, setCopyError] = useState<string | null>(null);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return (
    <main className="pt-safe pb-safe flex h-full flex-col bg-[#000]">
      <div className="flex items-center justify-center gap-3 py-2">
        {takes.length > 1 && (
          <span className="text-xs text-[rgba(255,255,255,.75)]">
            Trecho {i + 1} de {takes.length}
          </span>
        )}
      </div>
      <video
        key={urls[i]}
        src={urls[i]}
        controls
        playsInline
        autoPlay
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          setRecordedInfo(v.videoWidth && v.videoHeight
            ? `Arquivo gravado: ${actualVideoLabel(v.videoWidth, v.videoHeight)} (${v.videoWidth}×${v.videoHeight}) · ${Math.round(takes[i].size / (1024 * 1024))} MB`
            : "Não consegui ler a resolução do arquivo gravado.");
        }}
        onError={() => setRecordedInfo("Falha ao reproduzir a gravação: salve uma cópia no iPhone antes de editar.")}
        onEnded={() => i < urls.length - 1 && setI(i + 1)}
        className="min-h-0 flex-1 bg-[#000] object-contain"
        aria-label="Vídeo gravado"
      />
      <div className="flex flex-col gap-2 bg-bg p-3">
        {recordedInfo && <p role="status" className="text-center text-xs text-[#fff]">{recordedInfo}</p>}
        {busy && (
          <p role="status" className="text-center text-sm text-[#fff]">
            Guardando a gravação no iPhone… {Math.round(copyProgress * 100)}%
          </p>
        )}
        {copyError && (
          <p role="alert" className="rounded-md border border-[#ffb3ad] p-2 text-sm text-[#ffb3ad]">
            {copyError} Não feche o teleprompter: use “Salvar no iPhone” para preservar o vídeo original.
          </p>
        )}
        <div className="flex gap-2">
        <Button variant="ghost" className="flex-1" onClick={onBack} disabled={busy}>
          Voltar a gravar
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => void shareFiles(takes)} disabled={busy}>
          Salvar no iPhone
        </Button>
        <Button
          variant="primary"
          className="flex-1"
          loading={busy}
          onClick={() => {
            setCopyError(null);
            setCopyProgress(0);
            setBusy(true);
            void onUse(setCopyProgress)
              .catch((err: unknown) => setCopyError(err instanceof Error ? err.message : String(err)))
              .finally(() => setBusy(false));
          }}
        >
          {toProject ? "Usar no projeto" : "Editar vídeo"}
        </Button>
        </div>
        <p className="text-xs text-[rgba(255,255,255,.6)]">
          Para vídeos longos, salve também uma cópia em Arquivos. A edição só abre depois que o original estiver completamente guardado neste aparelho.
        </p>
      </div>
    </main>
  );
}

// all the takes in one share sheet when the phone allows, else one by one
async function shareFiles(files: File[]) {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (files.length > 1 && nav.canShare?.({ files })) {
    try {
      await nav.share({ files });
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
  }
  for (const f of files) await shareFile(f);
}

// How the phone is held, from the motion sensor (as the iPhone's own camera
// does): upright, or on its side with the top to the left or the right, so
// the format follows the phone and the text and the buttons always face
// whoever holds it, either hand. Which sign gravity has differs between
// browsers, so it is learnt from the phone held upright and kept.
const MOTION_SIGN = "prompter-motion-sign";
function readSign() {
  try {
    return Number(localStorage.getItem(MOTION_SIGN)) || 0;
  } catch {
    return 0;
  }
}
const needsAsking = () =>
  typeof (globalThis as unknown as { DeviceMotionEvent?: { requestPermission?: unknown } }).DeviceMotionEvent?.requestPermission === "function";
// The iPhone asks once, and only from a finished tap (click, not touch down);
// elsewhere there is nothing to ask.
let motionAsked: Promise<boolean> | null = null;
function askMotion() {
  if (!needsAsking()) return Promise.resolve(true);
  const M = (globalThis as unknown as { DeviceMotionEvent: { requestPermission: () => Promise<string> } }).DeviceMotionEvent;
  motionAsked ??= M.requestPermission().then(
    (r) => r === "granted",
    () => {
      motionAsked = null; // not from a tap: asked again on the next one
      return false;
    },
  );
  return motionAsked;
}
function usePose() {
  const [pose, setPose] = useState<Pose | null>(null);
  const [heard, setHeard] = useState(false); // the sensor answers
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let sign = readSign();
    const ios = /iPhone|iPad/.test(navigator.userAgent);
    let got = false;
    const on = (e: DeviceMotionEvent) => {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x == null || g.y == null) return;
      if (!got) {
        got = true;
        setHeard(true);
      }
      if (Math.abs(g.y) > 7 && Math.abs(g.x) < 3 && Math.sign(g.y) !== sign) {
        sign = Math.sign(g.y); // upright: this browser's sign for "up"
        try {
          localStorage.setItem(MOTION_SIGN, String(sign));
        } catch {
          // kept for this visit
        }
      }
      const p = poseOf(g.x, g.y, sign || (ios ? -1 : 1)); // WebKit reports the opposite sign
      if (p) setPose(p);
    };
    window.addEventListener("devicemotion", on);
    return () => window.removeEventListener("devicemotion", on);
  }, [retry]);
  // "Ativar giro automático", when the sensor was not allowed yet
  const enable = () => void askMotion().then(() => setRetry((r) => r + 1));
  return { pose, heard, enable };
}

function CameraPrompter({
  script,
  settings,
  setSettings,
  scroll,
  segments,
  onSegment,
  onDropLast,
  onClose,
  onEdit,
  onDone,
}: {
  script: Script;
  settings: PrompterSettings;
  setSettings: (p: Partial<PrompterSettings>) => void;
  scroll: { current: number }; // where the text is, kept by the parent
  segments: Segment[];
  onSegment: (g: Segment) => void;
  onDropLast: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const video = useRef<HTMLVideoElement>(null); // the camera's picture, not shown
  const frame = useRef<HTMLCanvasElement>(null); // the frame being recorded, shown as the preview
  const box = useRef<HTMLDivElement>(null);
  const textEl = useRef<HTMLDivElement>(null);
  const [cam, setCam] = useState<NonNullable<typeof shared> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caps, setCaps] = useState<{ zoom?: CameraZoomRange; torch?: boolean }>({});
  const [zoom, setZoom] = useState(1);
  const [cameraId, setCameraId] = useState("");
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [torch, setTorch] = useState(false);
  const nativeRange = useRef<CameraZoomRange | null>(null);
  const zoomTarget = useRef(1);
  const zoomAppliedNative = useRef(1);
  const zoomTrack = useRef<MediaStreamTrack | null>(null);
  const zoomBusy = useRef(false);
  const pinch = useRef<{ distance: number; startZoom: number } | null>(null);
  const lastPinchAt = useRef(0);
  const [count, setCount] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [arm, setArm] = useState(false); // the last take marked; a second tap deletes it
  const recorder = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);
  const lastTap = useRef(0);
  // The format follows the phone: upright records vertical, on its side
  // horizontal, facing whoever holds it. Once a take is recorded the format
  // stays (all the takes have one shape); the side still follows the phone.
  const { pose, heard, enable } = usePose();
  const [lastSide, setLastSide] = useState<PrompterSettings["side"] | null>(null);
  useEffect(() => {
    if (pose === "left" || pose === "right") setLastSide(pose);
  }, [pose]);
  const wantHorizontal = settings.format === "auto" ? pose === "left" || pose === "right" : settings.format === "horizontal";
  const [take, setTake] = useState<boolean | null>(null); // the format of the take being recorded
  const [finishing, setFinishing] = useState(false); // stopped, the take not handed over yet
  const locked = recording || finishing || segments.length > 0;
  const horizontal = segments[0]?.horizontal ?? (recording || finishing ? (take ?? wantHorizontal) : wantHorizontal);
  const side: PrompterSettings["side"] = pose === "left" || pose === "right" ? pose : (lastSide ?? settings.side);
  // the camera's picture as the phone hands it, and the frame made from it
  const [src, setSrc] = useState<{ w: number; h: number } | null>(null);
  // the camera whose picture is on screen: on "Virar câmera" the old one
  // stays until the new one's first picture, and the mirror and the turn
  // change with that picture, not before (else the old picture flips)
  const [shown, setShown] = useState(settings.facing);
  const shownRef = useRef(shown);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const live = useRef({ horizontal, side, size }); // read by the drawing loop
  live.current = { horizontal, side, size };

  // the camera, again whenever the side, the quality or the frame rate changes
  useEffect(() => {
    let alive = true;
    const { width: long, height: short } = targetVideoSize(settings.quality);
    if (!navigator.mediaDevices) {
      setError("Este navegador não dá acesso à câmera.");
      return;
    }
    // Never label an old frame as the new requested resolution.
    if (!locked) {
      setSrc(null);
      setSize(null);
    }
    // The best the browser can provide; the canvas never upscales it.
    void openCamera(`${settings.facing}-${cameraId || "default"}-${settings.quality}-${settings.fps}`, {
      ...(cameraId ? { deviceId: { exact: cameraId } } : { facingMode: settings.facing }),
      width: { ideal: long },
      height: { ideal: short },
      frameRate: { ideal: settings.quality === 2160 ? 30 : settings.fps },
    })
      .then((got) => {
        if (!alive) return; // the shared camera stays open for the next screen
        setCam(got);
        setError(null);
        const track = got.video.getVideoTracks()[0];
        const c = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { zoom?: { min: number; max: number }; torch?: boolean };
        const range = nativeZoomRange(c);
        nativeRange.current = range;
        zoomTrack.current = track;
        zoomBusy.current = false;
        const current = (track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom;
        const initial = typeof current === "number" && Number.isFinite(current) ? current : 1;
        zoomAppliedNative.current = initial;
        zoomTarget.current = initial;
        setCaps({ zoom: range ?? undefined, torch: !!c.torch });
        setZoom(initial);
        setTorch(false);
        // Permission has now been granted: Safari may reveal distinct lenses,
        // but it sometimes exposes only the aggregate front/back camera.
        void navigator.mediaDevices.enumerateDevices().then((devices) => {
          if (alive) setAvailableCameras(devices.filter((item) => item.kind === "videoinput" && !!item.deviceId));
        }).catch(() => {});
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const name = e instanceof DOMException ? e.name : "";
        if (cameraId) {
          setCameraId("");
          toast("Esta lente não foi liberada pelo Safari. Voltando à câmera padrão.", "error");
          return;
        }
        setError(
          name === "NotAllowedError"
            ? "O app não tem permissão para a câmera. No iPhone: Ajustes › Apps › Safari › Câmera e Microfone › Permitir."
            : "Não foi possível abrir a câmera.",
        );
      });
    return () => {
      alive = false;
    };
  }, [settings.facing, settings.quality, settings.fps, cameraId]);

  // the picture's shape, as the phone hands it (it can change with the camera)
  useEffect(() => {
    const v = video.current;
    if (!v || !cam) return;
    v.srcObject = cam.video;
    void v.play().catch(() => {});
    const on = () => v.videoWidth && setSrc({ w: v.videoWidth, h: v.videoHeight });
    const reportedFacing = cam.video.getVideoTracks()[0]?.getSettings().facingMode;
    const facing: PrompterSettings["facing"] =
      reportedFacing === "user" || reportedFacing === "environment"
        ? reportedFacing : cam.key.startsWith("user") ? "user" : "environment";
    const ready = () => {
      shownRef.current = facing; // the drawing loop turns this camera's picture from now on
      setShown(facing);
    };
    if (v.readyState >= 2) ready();
    v.addEventListener("resize", on);
    v.addEventListener("loadedmetadata", on);
    v.addEventListener("loadeddata", ready);
    return () => {
      v.removeEventListener("resize", on);
      v.removeEventListener("loadedmetadata", on);
      v.removeEventListener("loadeddata", ready);
    };
  }, [cam]);

  // the frame's size: the camera's own pixels, wide or tall as the format
  // asks; kept while recording (a take has one size)
  useEffect(() => {
    if (!src || (locked && size)) return;
    setSize(frameOf(src.w, src.h, horizontal));
  }, [src, horizontal, locked, size]);

  // Each camera picture drawn into the frame, turned as set and filling it:
  // the preview is this frame, so what is seen is exactly what is recorded,
  // whichever way the phone hands its picture over.
  useEffect(() => {
    const v = video.current;
    const c = frame.current;
    if (!v || !c) return;
    let stop = false;
    let raf = 0;
    // Drawn only when the camera has a new picture (30 or 60 a second), not
    // on every screen refresh (120 on an iPhone Pro): a 4K draw each time
    // left the phone too busy to move the text smoothly.
    const vf = v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    const byFrame = "requestVideoFrameCallback" in v;
    let fresh = true;
    let drawn = 0;
    const onFrame = () => {
      fresh = true;
      if (!stop) vf.requestVideoFrameCallback?.(onFrame);
    };
    vf.requestVideoFrameCallback?.(onFrame);
    const draw = (now: number) => {
      if (stop) return;
      raf = requestAnimationFrame(draw);
      if (byFrame && !fresh && now - drawn < 250) return;
      const { horizontal: hz, side: sd, size: sz } = live.current;
      if (!sz || v.readyState < 2 || !v.videoWidth) return;
      fresh = false;
      drawn = now;
      // the old camera already stopped, the new one not here yet: the last picture stays
      if ((v.srcObject as MediaStream | null)?.getVideoTracks()[0]?.readyState !== "live") return;
      const t = pictureTurn(hz, v.videoWidth > v.videoHeight, sd, shownRef.current);
      if (c.width !== sz.w || c.height !== sz.h) {
        c.width = sz.w;
        c.height = sz.h;
      }
      const ctx = c.getContext("2d")!;
      const sw = v.videoWidth;
      const sh = v.videoHeight;
      const across = t % 180 !== 0;
      const crop = digitalZoomFactor(zoomTarget.current, zoomAppliedNative.current);
      const k = Math.max(sz.w / (across ? sh : sw), sz.h / (across ? sw : sh)) * crop;
      ctx.save();
      ctx.translate(sz.w / 2, sz.h / 2);
      ctx.rotate((t * Math.PI) / 180);
      ctx.drawImage(v, (-sw * k) / 2, (-sh * k) / 2, sw * k, sh * k);
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  // the screen stays on while the teleprompter is open
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> } };
    void nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => void lock?.release().catch(() => {});
  }, []);

  const applyTrack = useCallback(
    (c: MediaTrackConstraintSet & { zoom?: number; torch?: boolean }) => {
      const track = cam?.video.getVideoTracks()[0];
      void track?.applyConstraints({ advanced: [c] }).catch(() => {});
    },
    [cam],
  );

  // Zoom may be optical when the browser exposes it, otherwise it is a
  // canvas crop. Both operate on the SAME canvas that MediaRecorder records.
  // Browser APIs cannot manufacture an ultra-wide field of view.
  const syncNativeZoom = () => {
    const track = zoomTrack.current;
    const range = nativeRange.current;
    if (!track || !range || zoomBusy.current) return;
    zoomBusy.current = true;
    void (async () => {
      while (track === zoomTrack.current && range === nativeRange.current && track.readyState === "live") {
        const requested = Math.max(range.min, Math.min(range.max, zoomTarget.current));
        if (Math.abs(requested - zoomAppliedNative.current) < 0.08) break;
        try {
          await track.applyConstraints({ advanced: [{ zoom: requested } as MediaTrackConstraintSet] });
          if (track !== zoomTrack.current) break;
          const observed = (track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom;
          if (typeof observed === "number" && Math.abs(observed - requested) > 0.25) {
            // Safari may accept but ignore the zoom constraint.
            nativeRange.current = null;
            setCaps((c) => ({ ...c, zoom: undefined }));
            break;
          }
          zoomAppliedNative.current = typeof observed === "number" ? observed : requested;
        } catch {
          if (track === zoomTrack.current) {
            nativeRange.current = null;
            setCaps((c) => ({ ...c, zoom: undefined }));
          }
          break;
        }
      }
    })().finally(() => { zoomBusy.current = false; });
  };
  const setZoomLevel = (requested: number) => {
    const value = boundZoom(requested, nativeRange.current);
    if (Math.abs(value - zoomTarget.current) < 0.05) return;
    zoomTarget.current = value;
    setZoom(value);
    syncNativeZoom();
  };
  const fingersDistance = (e: ReactTouchEvent) => {
    if (e.touches.length < 2) return 0;
    const a = e.touches[0];
    const b = e.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };
  const pinchStart = (e: ReactTouchEvent) => {
    if (e.touches.length < 2) return;
    const distance = fingersDistance(e);
    if (distance < 5) return;
    pinch.current = { distance, startZoom: zoomTarget.current };
    lastPinchAt.current = performance.now();
    cancelAnimationFrame(glide.current);
    drag.current = null;
  };
  const pinchMove = (e: ReactTouchEvent) => {
    if (!pinch.current || e.touches.length < 2) return;
    e.preventDefault();
    const distance = fingersDistance(e);
    if (distance > 5) setZoomLevel(pinch.current.startZoom * distance / pinch.current.distance);
    lastPinchAt.current = performance.now();
  };
  const pinchEnd = (e: ReactTouchEvent) => {
    if (e.touches.length < 2) {
      pinch.current = null;
      lastPinchAt.current = performance.now();
    }
  };
  const place = () => {
    if (textEl.current) textEl.current.style.transform = `translate3d(0, ${-scroll.current}px, 0)`;
  };
  // the text where it was left (after editing the script, or a take deleted)
  useEffect(place, [segments.length]);

  // the text moves while recording and not paused, at the reading pace
  useEffect(() => {
    if (!recording || paused) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = (now - last) / 1000;
      last = now;
      if (drag.current || now < manualUntil.current) return;
      const h = textEl.current?.scrollHeight ?? 0;
      const v = pxPerSecond(h, script.text, settings.speed);
      scroll.current = Math.min(h, scroll.current + v * dt);
      place();
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [recording, paused, script.text, settings.speed]);

  // the clock
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((performance.now() - startedAt.current) / 1000), 250);
    return () => clearInterval(t);
  }, [recording]);

  // A take records the frame (the canvas) with the microphone: turning the
  // camera only changes the picture drawn into it, so the take goes on.
  function begin() {
    const c = frame.current;
    if (!cam || !c || !size) return;
    const type = recorderType();
    if (type === null) return toast("Este aparelho não grava vídeo pelo navegador.", "error");
    const tracks = [...c.captureStream(settings.fps).getVideoTracks(), ...(cam.audio ? [cam.audio] : [])];
    const quality = Math.max(size.w, size.h) >= 3800 ? 2160 : Math.max(size.w, size.h) >= 1900 ? 1080 : 720;
    const r = new MediaRecorder(new MediaStream(tracks), {
      ...(type ? { mimeType: type } : {}),
      videoBitsPerSecond: videoBitrate(quality) * (settings.fps === 60 ? 1.5 : 1),
      audioBitsPerSecond: 128_000,
    });
    const scrollStart = scroll.current; // the next take carries on where the text is
    const h = horizontal; // this take's format, kept until it is handed over
    setTake(h);
    const n = segments.length + 1;
    const own: Blob[] = [];
    const t0 = performance.now();
    r.ondataavailable = (e) => e.data.size && own.push(e.data);
    r.onstop = () => {
      r.stream.getVideoTracks().forEach((t) => t.stop()); // the canvas capture, not the camera
      const seconds = (performance.now() - t0) / 1000;
      const mime = r.mimeType || type || "video/mp4";
      const ext = mime.includes("webm") ? "webm" : "mp4";
      const stamp = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/[/:]/g, "-").replace(", ", " ");
      onSegment({ file: new File(own, `Teleprompter ${stamp} (${n}).${ext}`, { type: mime.split(";")[0] }), seconds, scrollStart, horizontal: h });
      setFinishing(false);
    };
    r.start(1000);
    recorder.current = r;
    startedAt.current = performance.now();
    setElapsed(0);
    setPaused(false);
    setRecording(true);
  }

  // turn the camera, also mid-take (button, or two quick taps on the picture):
  // the take goes on with the other camera, in the same format
  function flip() {
    // A previously selected camera device cannot be reused when flipping.
    setCameraId("");
    setSettings({ facing: settings.facing === "user" ? "environment" : "user" });
  }
  function onBackgroundTap(e: PointerEvent) {
    if (e.target !== e.currentTarget && !(e.target instanceof HTMLCanvasElement)) return;
    const now = performance.now();
    if (now - lastPinchAt.current < 700) return;
    if (now - lastTap.current < 320) {
      lastTap.current = 0;
      flip();
    } else lastTap.current = now;
  }

  function onRecord() {
    setArm(false);
    if (recording) {
      setFinishing(true);
      setRecording(false);
      recorder.current?.stop();
      recorder.current = null;
      return;
    }
    if (count !== null) return;
    if (!settings.countdown) return begin();
    let n = settings.countdown;
    setCount(n);
    const t = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(t);
        setCount(null);
        begin();
      } else setCount(n);
    }, 1000);
  }

  // on the text: a tap pauses or resumes, a drag moves it by hand. Turned
  // (horizontal), the reader's up and down run across the glass.
  const ui = uiTurn(side);
  const along = (e: PointerEvent) => (!horizontal ? e.clientY : ui > 0 ? -e.clientX : e.clientX);
  // The text follows the finger and, let go with a flick, glides on and
  // slows down like a phone's own scrolling, so any part is quickly reached.
  const drag = useRef<{ y: number; s: number; moved: boolean; v: number; at: number; last: number } | null>(null);
  const glide = useRef(0);
  const manualUntil = useRef(0);
  const clampScroll = (y: number) => Math.max(0, Math.min(textEl.current?.scrollHeight ?? 0, y));
  function down(e: PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // a pointer already gone: the drag still follows it over the box
    }
    cancelAnimationFrame(glide.current);
    manualUntil.current = performance.now() + 1800;
    const y = along(e);
    drag.current = { y, s: scroll.current, moved: false, v: 0, at: performance.now(), last: y };
  }
  function move(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const y = along(e);
    const dy = y - d.y;
    if (Math.abs(dy) > 6) d.moved = true;
    if (!d.moved) return;
    const now = performance.now();
    const dt = now - d.at;
    if (dt > 0) d.v = 0.7 * ((d.last - y) / dt) + 0.3 * d.v; // px per ms, smoothed
    d.at = now;
    d.last = y;
    manualUntil.current = performance.now() + 1800;
    scroll.current = clampScroll(d.s - dy);
    place();
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && recording) setPaused((p) => !p);
    if (!d?.moved || performance.now() - d.at > 80 || Math.abs(d.v) < 0.2) return;
    let v = d.v;
    let t = performance.now();
    const step = (now: number) => {
      const dt = Math.min(32, now - t);
      t = now;
      manualUntil.current = performance.now() + 1800;
      scroll.current = clampScroll(scroll.current + v * dt);
      place();
      v *= Math.pow(0.997, dt); // friction, about like iOS scrolling
      if (Math.abs(v) > 0.02) glide.current = requestAnimationFrame(step);
    };
    glide.current = requestAnimationFrame(step);
  }
  useEffect(() => () => cancelAnimationFrame(glide.current), []);

  const front = shown === "user";
  // Horizontal: the controls, the text and the frame turn to face whoever
  // holds the phone on its side.
  const turned = horizontal
    ? { position: "fixed" as const, top: "50%", left: "50%", width: "100vh", height: "100vw", transform: `translate(-50%, -50%) rotate(${ui}deg)` }
    : { position: "fixed" as const, inset: 0 };
  // the text box: as tall as set when upright; turned, the same size it has
  // upright (as wide as the phone, short enough for the controls below)
  const boxH = horizontal ? `min(${settings.boxHeight * 100}vh, calc(100vw - 110px))` : `${settings.boxHeight * 100}%`;
  const lens = side === "left" ? ("left" as const) : ("right" as const); // the top of the phone, with the front camera
  const far = lens === "left" ? ("right" as const) : ("left" as const);
  // turned, the top of the phone (Dynamic Island) is the lens side and the
  // home bar the far side: keep clear of both, at least the island's size
  // even where the phone does not say it
  const clearLens = "calc(max(env(safe-area-inset-top, 0px), 54px) + 10px)";
  const clearFar = "calc(max(env(safe-area-inset-bottom, 0px), 20px) + 12px)";
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#000] text-[#fff]">
      {/* the camera's picture: playing but not shown (the frame below is) */}
      <video ref={video} autoPlay playsInline muted aria-hidden className="pointer-events-none fixed left-0 top-0 size-px opacity-0" />
      <div
        style={turned}
        className="touch-none"
        onPointerUp={onBackgroundTap}
        onTouchStart={pinchStart}
        onTouchMove={pinchMove}
        onTouchEnd={pinchEnd}
        onTouchCancel={pinchEnd}
      >
      {/* the frame being recorded, whole (bars where the screen is another shape);
          the selfie camera mirrored on screen only, as phones do */}
      <canvas
        ref={frame}
        aria-label="Câmera"
        className="absolute inset-0 size-full object-contain"
        style={front ? { transform: "scaleX(-1)" } : undefined}
      />
      {error && <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-md bg-[rgba(0,0,0,.7)] p-4 text-center text-sm">{error}</p>}
      {size && !recording && (
        <span className="absolute rounded-pill bg-[rgba(0,0,0,.55)] px-2 py-0.5 font-mono text-[11px]" style={{ top: `calc(${boxH} + 20px)`, [horizontal ? lens : "left"]: horizontal ? clearLens : 16 }}>
          {qualityLabel(size, cam?.video.getVideoTracks()[0]?.getSettings().frameRate ?? settings.fps)}
          {" · "}{zoom.toFixed(1)}×{!caps.zoom ? " digital" : ""}
        </span>
      )}

      {/* the text, near the lens */}
      <div
        ref={box}
        role="region"
        aria-label="Texto do teleprompter"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className={cn("absolute top-2 touch-none overflow-hidden rounded-lg", !horizontal && "pt-safe")}
        style={{
          // turned: the size it has upright, in the corner by the front camera
          ...(horizontal ? { [lens]: clearLens, width: "calc(100vw - 24px)" } : { left: 12, right: 12 }),
          height: boxH,
          background: `rgba(0,0,0,${settings.boxOpacity})`,
        }}
      >
        <div className="absolute inset-x-0 top-[22%] z-10 h-0.5 bg-[rgba(255,255,255,.25)]" aria-hidden />
        <div
          ref={textEl}
          className="whitespace-pre-wrap px-5 font-semibold"
          style={{
            // the first line starts on the reading line, a fifth down the box
            paddingTop: `calc(${boxH} * 0.18)`,
            paddingBottom: "100vh",
            fontSize: settings.fontSize,
            lineHeight: 1.35,
            color: settings.color,
            willChange: "transform", // its own layer: moving it repaints nothing
            ...(settings.mirror ? { scale: "-1 1" } : {}),
          }}
        >
          {script.text}
        </div>
        {recording && paused && <span className="absolute bottom-2 right-3 rounded-pill bg-[rgba(0,0,0,.6)] px-2 py-0.5 text-xs">Pausado · toque para seguir</span>}
      </div>

      {/* top-right tools */}
      <div className="absolute flex flex-col gap-2" style={horizontal ? { top: 8, [far]: clearFar } : { right: 12, top: `calc(${boxH} + 16px)` }}>
        <RoundButton label="Ajustes do teleprompter" caption="Ajustes" onClick={() => setSettingsOpen(true)} disabled={recording}>
          <Settings2 className="size-5" />
        </RoundButton>
        <RoundButton label="Editar roteiro" caption="Roteiro" onClick={onEdit} disabled={recording}>
          <Pencil className="size-5" />
        </RoundButton>
        {!heard && needsAsking() && settings.format === "auto" && !recording && (
          <RoundButton label="Ativar giro automático" caption="Ativar giro" onClick={enable}>
            <Smartphone className="size-5" />
          </RoundButton>
        )}
        {caps.torch && (
          <RoundButton
            label={torch ? "Desligar flash" : "Ligar flash"}
            caption="Flash"
            onClick={() => {
              applyTrack({ torch: !torch });
              setTorch(!torch);
            }}
          >
            {torch ? <Zap className="size-5" /> : <ZapOff className="size-5" />}
          </RoundButton>
        )}
      </div>

      {count !== null && (
        <div aria-live="assertive" className="absolute inset-0 flex items-center justify-center font-bold" style={{ fontSize: 128, textShadow: "0 2px 16px rgba(0,0,0,.6)" }}>
          {count}
        </div>
      )}

      {/* bottom: close, record, flip */}
      <div
        className={cn("absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-[rgba(0,0,0,.7)] to-transparent px-6 pb-6 pt-10", !horizontal && "pb-safe")}
        // turned: the buttons at the ends clear of the island and the home bar
        style={horizontal ? { [`padding${lens === "left" ? "Left" : "Right"}`]: clearLens, [`padding${far === "left" ? "Left" : "Right"}`]: clearFar } : undefined}
      >
        {(segments.length > 0 || recording) && (
          // the takes so far, side by side; the last one red when marked to delete
          <div aria-label="Trechos gravados" className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-pill bg-[rgba(255,255,255,.2)]">
            {segments.map((g, i) => (
              <span
                key={i}
                className="h-full rounded-pill"
                style={{ flexGrow: g.seconds, background: arm && i === segments.length - 1 ? REC : "#fff" }}
              />
            ))}
            {recording && <span className="h-full rounded-pill" style={{ flexGrow: Math.max(0.1, elapsed), background: REC }} />}
          </div>
        )}
        <span className="font-mono text-sm tabular-nums" style={{ color: recording ? REC : "rgba(255,255,255,.85)" }}>
          {recording || segments.length
            ? `${recording ? "● " : ""}${formatTime((segments.reduce((t, g) => t + g.seconds, 0) + (recording ? elapsed : 0)) * 1e6)}${segments.length ? ` · ${segments.length + (recording ? 1 : 0)} trecho${segments.length + (recording ? 1 : 0) > 1 ? "s" : ""}` : ""}`
            : `${wpmOf(settings.speed)} palavras/min · ~${mmss(readingSeconds(script.text, settings.speed))}`}
        </span>
        {arm && <span className="text-xs text-[#fff]">Toque de novo para apagar o último trecho (o texto volta para onde ele começou)</span>}
        <div className="flex w-full items-center justify-between">
          <RoundButton label="Fechar teleprompter" caption="Fechar" onClick={onClose} disabled={recording}>
            <X className="size-6" />
          </RoundButton>
          <RoundButton
            label={arm ? "Confirmar: apagar último trecho" : "Apagar último trecho"}
            caption="Apagar trecho"
            onClick={() => {
              if (!arm) return setArm(true);
              setArm(false);
              onDropLast();
            }}
            disabled={recording || !segments.length}
            danger={arm}
          >
            <Delete className="size-6" />
          </RoundButton>
          <button
            type="button"
            aria-label={recording ? "Pausar gravação" : segments.length ? "Continuar gravando" : "Gravar"}
            onClick={onRecord}
            disabled={!cam || !size}
            className="flex size-20 items-center justify-center rounded-full border-4 border-[#fff] disabled:opacity-40"
          >
            <span className={cn("block transition-all", recording ? "size-8 rounded-md" : "size-16 rounded-full")} style={{ background: REC }} />
          </button>
          <RoundButton label="Concluir" caption="Concluir" onClick={onDone} disabled={recording || !segments.length} accent>
            <Check className="size-6" />
          </RoundButton>
          <RoundButton label="Virar câmera" caption="Virar câmera" onClick={flip}>
            <SwitchCamera className="size-6" />
          </RoundButton>
        </div>
      </div>

      </div>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen} title="Teleprompter">
        <div className="flex flex-col gap-4">
          <Slider label="Velocidade" value={settings.speed} min={1} max={10} defaultValue={5} format={(v) => `${v} · ${wpmOf(v)} palavras/min`} onChange={(speed) => setSettings({ speed })} />
          {settings.quality === 2160 && (
            <p className="rounded-md border border-[#fbbf24]/50 p-2 text-xs text-[#fcd34d]">
              Para gravações longas, prefira 1080p e 30 fps. O formato 4K ocupa muito mais armazenamento no iPhone e aumenta o risco de interrupção.
            </p>
          )}
          <Slider label="Tamanho do texto" value={settings.fontSize} min={18} max={64} defaultValue={30} onChange={(fontSize) => setSettings({ fontSize })} />
          <Slider label="Altura da caixa" value={Math.round(settings.boxHeight * 100)} min={25} max={70} defaultValue={38} format={(v) => `${v}%`} onChange={(v) => setSettings({ boxHeight: v / 100 })} />
          <Slider label="Fundo do texto" value={Math.round(settings.boxOpacity * 100)} min={20} max={95} defaultValue={55} format={(v) => `${v}%`} onChange={(v) => setSettings({ boxOpacity: v / 100 })} />
          <div className="flex flex-col gap-2">
            <span className="text-xs text-text-muted">Cor do texto</span>
            <div role="radiogroup" aria-label="Cor do texto" className="flex gap-3">
              {COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={settings.color === c}
                  aria-label={`Cor ${c}`}
                  onClick={() => setSettings({ color: c })}
                  className={cn("size-9 rounded-full border-2", settings.color === c ? "border-accent" : "border-transparent")}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
          <Choice
            label="Contagem antes de gravar"
            value={String(settings.countdown)}
            options={[
              ["0", "Sem"],
              ["3", "3 s"],
              ["5", "5 s"],
            ]}
            onChange={(v) => setSettings({ countdown: Number(v) as PrompterSettings["countdown"] })}
          />
          <Choice
            label="Qualidade solicitada"
            value={String(settings.quality)}
            options={[
              ["720", "720p"],
              ["1080", "1080p"],
              ["1440", "2K / 1440p"],
              ["2160", "4K"],
            ]}
            disabled={segments.length > 0}
            onChange={(v) => {
              const quality = Number(v) as PrompterSettings["quality"];
              setSettings({ quality, ...(quality === 2160 ? { fps: 30 } : {}) });
            }}
          />
          <Choice
            label="Quadros por segundo"
            value={String(settings.fps)}
            options={settings.quality === 2160 ? [["30", "30 fps (4K)"]] : [["30", "30 fps"], ["60", "60 fps"]]}
            disabled={segments.length > 0}
            onChange={(v) => setSettings({ fps: Number(v) as PrompterSettings["fps"] })}
          />
          <p className="text-xs text-text-muted">
            Resolução real da câmera: {size ? qualityLabel(size, cam?.video.getVideoTracks()[0]?.getSettings().frameRate ?? settings.fps) : "aguardando imagem"}.
            O Safari pode entregar menos que a qualidade solicitada; o aplicativo não aumenta artificialmente a resolução.
          </p>
          {segments.length > 0 && (
            <p className="text-xs text-[#fcd34d]">
              Termine ou salve os trechos atuais antes de mudar resolução e FPS.
            </p>
          )}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-text-muted">Zoom da câmera ({zoom.toFixed(1)}×)</span>
            <Slider
              label="Aproximar / afastar"
              value={Math.round(zoom * 10)}
              min={Math.round((caps.zoom?.min ?? 1) * 10)}
              max={Math.round(Math.max(5, caps.zoom?.max ?? 5) * 10)}
              defaultValue={10}
              format={(v) => `${(v / 10).toFixed(1)}×`}
              onChange={(v) => setZoomLevel(v / 10)}
            />
            <p className="text-xs text-text-muted">
              Use dois dedos sobre a imagem para dar zoom enquanto grava. {caps.zoom
                ? "O navegador informou controle de zoom na câmera; aproximações maiores podem combinar zoom da câmera e recorte digital."
                : "Zoom digital disponível. Para 0,5× verdadeiro, o Safari precisa liberar a lente ultra-angular."}
            </p>
          </div>
          {availableCameras.length > 1 && (
            <label className="flex flex-col gap-2">
              <span className="text-xs text-text-muted">Lente / câmera disponível no Safari</span>
              <select
                value={cameraId}
                disabled={recording || finishing || segments.length > 0}
                onChange={(e) => {
                  const id = e.currentTarget.value;
                  const selected = availableCameras.find((c) => c.deviceId === id);
                  setCameraId(id);
                  if (selected) {
                    const label = selected.label.toLowerCase();
                    if (/front|frontal|user|selfie/.test(label)) setSettings({ facing: "user" });
                    else if (/back|rear|traseira|environment/.test(label)) setSettings({ facing: "environment" });
                  }
                }}
                className="w-full rounded-lg border border-border-input bg-bg p-3 text-sm text-text disabled:opacity-50"
              >
                <option value="">Padrão do iPhone ({settings.facing === "user" ? "frontal" : "traseira"})</option>
                {availableCameras.map((camera, i) => (
                  <option key={camera.deviceId} value={camera.deviceId}>
                    {camera.label || `Câmera disponível ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-xs text-text-muted">
            As lentes listadas são as que o Safari disponibiliza. Se a ultra-angular não estiver na lista, o PWA não pode ativá-la como o app Câmera nativo.
          </p>
          <Choice
            label={settings.format === "auto" ? "Formato (automático: segue o celular em pé ou deitado)" : "Formato"}
            value={settings.format}
            options={[
              ["auto", "Automático"],
              ["vertical", "Vertical"],
              ["horizontal", "Horizontal"],
            ]}
            onChange={(v) => setSettings({ format: v as PrompterSettings["format"] })}
          />
          {!heard && horizontal && (
            // no motion sensor: say which way the phone lies
            <Choice
              label="Topo do celular"
              value={settings.side}
              options={[
                ["left", "À esquerda"],
                ["right", "À direita"],
              ]}
              onChange={(v) => setSettings({ side: v as PrompterSettings["side"] })}
            />
          )}
          <Button variant="secondary" icon={<FlipHorizontal2 aria-hidden className="size-4" />} onClick={() => setSettings({ mirror: !settings.mirror })}>
            {settings.mirror ? "Texto espelhado (para vidro de teleprompter)" : "Espelhar texto"}
          </Button>
        </div>
      </Sheet>
    </main>
  );
}

function RoundButton({
  label,
  onClick,
  disabled,
  danger,
  accent,
  caption,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
  caption?: string; // a short name under it, so look-alike icons are not mixed up
  children: React.ReactNode;
}) {
  const button = (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="flex size-12 items-center justify-center rounded-full disabled:opacity-30"
      style={{ background: danger ? REC : accent && !disabled ? "#fff" : "rgba(0,0,0,.5)", color: accent && !disabled ? "#000" : "#fff" }}
    >
      {children}
    </button>
  );
  if (!caption) return button;
  return (
    <span className={cn("flex w-16 flex-col items-center gap-0.5", disabled && "opacity-60")}>
      {button}
      <span aria-hidden className="text-center text-[10px] leading-tight text-[#fff]" style={{ textShadow: "0 1px 3px rgba(0,0,0,.9)" }}>
        {caption}
      </span>
    </span>
  );
}

function Choice({ label, value, options, onChange, disabled }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            disabled={disabled}
            onClick={() => onChange(v)}
            className={cn("min-w-[68px] h-9 flex-1 rounded-pill border px-2 text-sm disabled:opacity-50", value === v ? "border-accent bg-accent text-on-accent" : "border-border-input")}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
