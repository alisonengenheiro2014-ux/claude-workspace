// Teleprompter, like CapCut's: write or pick a script (no length limit),
// then the camera fills the screen with the text in a box near the lens.
// Recording starts after a countdown and the text scrolls at reading pace;
// tap it to pause, drag it to move. The take is watched, redone, saved to the
// phone or used in a project (a new one, or appended to the one it came from).
import { Camera, Check, ChevronLeft, Delete, RectangleHorizontal, RectangleVertical, RotateCw, FlipHorizontal2, Pencil, Plus, Settings2, SwitchCamera, Trash2, X, Zap, ZapOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { runImport } from "../app/importFlow";
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
  horizontalTurn,
  type PrompterSettings,
  type Script,
} from "../editor/prompter";
import { durationOf, insertMedia } from "../editor/timeline";
import { rotateTake } from "../media/rotate";
import type { Rotation } from "mediabunny";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";
import { useToast } from "../ui/Toast";
import { formatTime } from "../ui/Transport";

type Step = "scripts" | "edit" | "camera" | "review";
const REC = "#ff3b30"; // the record button's red, on camera (raw: no theme token fits)
const COLORS = ["#ffffff", "#ffd400", "#00e5ff", "#7CFF6B", "#ff8a3d"];

// "3840×2160 · 30 fps", as the take will play (turned when horizontal)
function qualityLabel(real: { w: number; h: number; fps: number }, horizontal: boolean, turn: number) {
  const [w, h] = turn ? [real.h, real.w] : [real.w, real.h];
  const long = Math.max(w, h);
  const name = long >= 3800 ? "4K" : long >= 1900 ? "1080p" : long >= 1260 ? "720p" : `${Math.min(w, h)}p`;
  return `${name} · ${w}×${h} · ${real.fps} fps${horizontal ? " · horizontal" : ""}`;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export function Teleprompter({ projectId }: { projectId?: string }) {
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
  const [turns, setTurns] = useState(0); // the takes were turned: watch them again
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

  // "Girar 180°": every take turned (no re-encoding), and the turn remembered
  // for those cameras, sides and frame shapes
  async function turnTakes() {
    const files = await Promise.all(segments.map((g) => rotateTake(g.file, 180)));
    const turnFix = { ...settings.turnFix };
    for (const g of segments) if (g.fixKey) turnFix[g.fixKey] = ((g.fix ?? 0) + 180) % 360;
    setSegments(segments.map((g, i) => ({ ...g, file: files[i], fix: ((g.fix ?? 0) + 180) % 360 })));
    setSettings({ turnFix });
    setTurns((n) => n + 1);
  }

  if (step === "review" && segments.length)
    return (
      <Review
        key={turns}
        takes={segments.map((g) => g.file)}
        onTurn={segments.some((g) => g.fixKey) ? turnTakes : undefined}
        toProject={!!projectId}
        onBack={() => setStep("camera")}
        onUse={async () => {
          const id = await takesToProject(segments.map((g) => g.file), projectId, toast);
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
  fixKey?: string; // horizontal: camera, side and frame shape it was filmed with
  fix?: number; // the extra turn it got for that
}

// The takes go into a project, in order, one clip each: appended to the
// project the teleprompter came from, or a new one.
async function takesToProject(files: File[], projectId: string | undefined, toast: ReturnType<typeof useToast>) {
  const id = projectId ?? (await createProject()).id;
  const assets = await runImport(id, files, () => {}, toast);
  if (!assets.length) {
    if (!projectId) await removeProject(id);
    return null;
  }
  const loaded = await loadProject(id);
  if (loaded) await saveDoc(id, insertMedia(loaded.doc, assets, durationOf(loaded.doc)).doc);
  return id;
}

// The takes, played one after another, before they go into a project.
function Review({
  takes,
  toProject,
  onBack,
  onUse,
  onTurn,
}: {
  takes: File[];
  toProject: boolean;
  onBack: () => void;
  onUse: () => Promise<void>;
  onTurn?: () => Promise<void>; // horizontal takes: turn them all 180°
}) {
  const [urls] = useState(() => takes.map((f) => URL.createObjectURL(f)));
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return (
    <main className="pt-safe pb-safe flex h-full flex-col bg-[#000]">
      <div className="flex items-center justify-center gap-3 py-2">
        {takes.length > 1 && (
          <span className="text-xs text-[rgba(255,255,255,.75)]">
            Trecho {i + 1} de {takes.length}
          </span>
        )}
        {onTurn && (
          <Button
            variant="secondary"
            size="sm"
            icon={<RotateCw aria-hidden className="size-4" />}
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onTurn().finally(() => setBusy(false));
            }}
          >
            Girar 180°
          </Button>
        )}
      </div>
      <video
        key={urls[i]}
        src={urls[i]}
        controls
        playsInline
        autoPlay
        onEnded={() => i < urls.length - 1 && setI(i + 1)}
        className="min-h-0 flex-1 bg-[#000] object-contain"
        aria-label="Vídeo gravado"
      />
      <div className="flex gap-2 bg-bg p-3">
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
            setBusy(true);
            void onUse().finally(() => setBusy(false));
          }}
        >
          {toProject ? "Usar no projeto" : "Editar vídeo"}
        </Button>
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
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const textEl = useRef<HTMLDivElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [caps, setCaps] = useState<{ zoom?: { min: number; max: number }; torch?: boolean }>({});
  const [zoom, setZoom] = useState(1);
  const [torch, setTorch] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [arm, setArm] = useState(false); // the last take marked; a second tap deletes it
  const recorder = useRef<MediaRecorder | null>(null);
  const startedAt = useRef(0);
  const saving = useRef<Promise<void>>(Promise.resolve()); // takes are stored in order
  const resume = useRef(false); // the camera was turned mid-take: record again once it is back
  const lastTap = useRef(0);
  // what the camera really gives (shown, so the quality is never a guess)
  const [real, setReal] = useState<{ w: number; h: number; fps: number } | null>(null);
  const horizontal = settings.orientation === "horizontal";
  const turn = horizontalTurn(settings.side);

  // the camera, again whenever the side, the quality or the frame rate changes
  useEffect(() => {
    let alive = true;
    let s: MediaStream | null = null;
    const long = settings.quality === 2160 ? 3840 : settings.quality === 1080 ? 1920 : 1280;
    const short = settings.quality;
    void navigator.mediaDevices
      ?.getUserMedia({
        // the best the phone's camera has up to the chosen size: nothing upscaled
        video: { facingMode: settings.facing, width: { ideal: long }, height: { ideal: short }, frameRate: { ideal: settings.fps } },
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      .then((got) => {
        if (!alive) return got.getTracks().forEach((t) => t.stop());
        s = got;
        setStream(got);
        setError(null);
        const track = got.getVideoTracks()[0];
        const c = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { zoom?: { min: number; max: number }; torch?: boolean };
        setCaps({ zoom: c.zoom && c.zoom.max > c.zoom.min ? { min: c.zoom.min, max: Math.min(c.zoom.max, 10) } : undefined, torch: !!c.torch });
        setZoom(1);
        setTorch(false);
        const st = track.getSettings();
        setReal(st.width && st.height ? { w: st.width, h: st.height, fps: Math.round(st.frameRate ?? settings.fps) } : null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        const name = e instanceof DOMException ? e.name : "";
        setError(
          name === "NotAllowedError"
            ? "O app não tem permissão para a câmera. No iPhone: Ajustes › Safari › Câmera e Microfone › Permitir (ou toque em aA › Ajustes do site)."
            : "Não foi possível abrir a câmera.",
        );
      });
    if (!navigator.mediaDevices) setError("Este navegador não dá acesso à câmera.");
    return () => {
      alive = false;
      s?.getTracks().forEach((t) => t.stop());
    };
  }, [settings.facing, settings.quality, settings.fps]);

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream;
    // turned the camera while recording: carry on with the other one
    if (stream && resume.current) {
      resume.current = false;
      begin();
    }
  }, [stream]); // eslint-disable-line react-hooks/exhaustive-deps

  // the frames' real shape: upright-shaped frames while filming horizontally
  // get turned (preview stays as the phone shows it; the take is marked)
  const [frameWide, setFrameWide] = useState(false);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const on = () => setFrameWide(v.videoWidth > v.videoHeight);
    v.addEventListener("resize", on);
    v.addEventListener("loadedmetadata", on);
    return () => {
      v.removeEventListener("resize", on);
      v.removeEventListener("loadedmetadata", on);
    };
  }, []);
  const takeTurn = horizontal && !frameWide ? turn.take : 0;

  // the screen stays on while the teleprompter is open
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> } };
    void nav.wakeLock?.request("screen").then((l) => (lock = l)).catch(() => {});
    return () => void lock?.release().catch(() => {});
  }, []);

  const applyTrack = useCallback(
    (c: MediaTrackConstraintSet & { zoom?: number; torch?: boolean }) => {
      const track = stream?.getVideoTracks()[0];
      void track?.applyConstraints({ advanced: [c] }).catch(() => {});
    },
    [stream],
  );

  const place = () => {
    if (textEl.current) textEl.current.style.transform = `translateY(${-scroll.current}px)`;
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

  function begin() {
    if (!stream) return;
    const type = recorderType();
    if (type === null) return toast("Este aparelho não grava vídeo pelo navegador.", "error");
    const r = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: videoBitrate(settings.quality), audioBitsPerSecond: 128_000 });
    const scrollStart = scroll.current; // the next take carries on where the text is
    const n = segments.length + 1 + takesPending.current;
    // horizontal: the turn the frames need, plus the remembered fix. Wide
    // frames (the iPhone turned them itself) have come out upside down,
    // so they get 180° unless "Girar 180°" said otherwise.
    const fixKey = horizontal ? `${settings.facing}-${settings.side}-${frameWide ? "wide" : "tall"}` : undefined;
    const fix = fixKey ? (settings.turnFix[fixKey] ?? (frameWide ? 180 : 0)) : 0;
    const rot = ((takeTurn + fix) % 360) as Rotation;
    const own: Blob[] = [];
    const t0 = performance.now();
    r.ondataavailable = (e) => e.data.size && own.push(e.data);
    r.onstop = () => {
      const seconds = (performance.now() - t0) / 1000;
      const mime = r.mimeType || type || "video/mp4";
      const ext = mime.includes("webm") ? "webm" : "mp4";
      const stamp = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/[/:]/g, "-").replace(", ", " ");
      const raw = new File(own, `Teleprompter ${stamp} (${n}).${ext}`, { type: mime.split(";")[0] });
      takesPending.current += 1;
      // horizontal: marked with the turn (no re-encoding), in the order recorded
      saving.current = saving.current.then(async () => {
        const file = rot ? await rotateTake(raw, rot) : raw;
        takesPending.current -= 1;
        onSegment({ file, seconds, scrollStart, fixKey, fix });
      });
    };
    r.start(1000);
    recorder.current = r;
    startedAt.current = performance.now();
    setElapsed(0);
    setPaused(false);
    setRecording(true);
  }

  const takesPending = useRef(0);

  // turn the camera, also mid-take: the take ends, the other camera starts a
  // new one at once, in the same format (two quick taps on the picture too)
  function flip() {
    if (resume.current) return; // still turning: one turn at a time
    if (recording) {
      resume.current = true;
      setRecording(false);
      recorder.current?.stop();
      recorder.current = null;
    }
    setSettings({ facing: settings.facing === "user" ? "environment" : "user" });
  }
  function onBackgroundTap(e: PointerEvent) {
    if (e.target !== e.currentTarget && !(e.target instanceof HTMLVideoElement)) return;
    const now = performance.now();
    if (now - lastTap.current < 320) {
      lastTap.current = 0;
      flip();
    } else lastTap.current = now;
  }

  function onRecord() {
    setArm(false);
    if (recording) {
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
  const along = (e: PointerEvent) => (!horizontal ? e.clientY : turn.ui > 0 ? -e.clientX : e.clientX);
  const drag = useRef<{ y: number; s: number; moved: boolean } | null>(null);
  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: along(e), s: scroll.current, moved: false };
  }
  function move(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dy = along(e) - d.y;
    if (Math.abs(dy) > 6) d.moved = true;
    if (!d.moved) return;
    scroll.current = Math.max(0, Math.min(textEl.current?.scrollHeight ?? 0, d.s - dy));
    place();
  }
  function up() {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved && recording) setPaused((p) => !p);
  }

  const front = settings.facing === "user";
  // Horizontal: the controls and the text turn to face whoever holds the
  // phone on its side. The picture stays as the phone shows it (it already
  // looks upright to them), unless the frames themselves come wide.
  const turned = horizontal ? { position: "fixed" as const, top: "50%", left: "50%", width: "100vh", height: "100vw", transform: `translate(-50%, -50%) rotate(${turn.ui}deg)` } : { position: "fixed" as const, inset: 0 };
  // one video element always (moving it would drop the camera); turned with
  // the controls only when the frames themselves come wide
  const wideTurned = horizontal && frameWide;
  // the text box: as tall as set when upright; turned, the same size it has
  // upright (as wide as the phone, short enough for the controls below)
  const boxH = horizontal ? `min(${settings.boxHeight * 100}vh, calc(100vw - 110px))` : `${settings.boxHeight * 100}%`;
  const lens = settings.side === "left" ? ("left" as const) : ("right" as const); // the top of the phone, with the front camera
  const picture = (
    <video
      ref={video}
      autoPlay
      playsInline
      muted
      aria-label="Câmera"
      className="object-cover"
      style={{
        ...(wideTurned ? turned : { position: "absolute", inset: 0, width: "100%", height: "100%" }),
        maxWidth: "none", // the base styles cap videos at 100% wide: turned, it is wider
        // the selfie mirror goes last in the same transform (on its own it would flip the turn's offset)
        transform: `${wideTurned ? turned.transform : ""}${front ? " scaleX(-1)" : ""}` || undefined,
      }}
    />
  );
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#000] text-[#fff]">
      {picture}
      <div style={turned} className="touch-manipulation" onPointerUp={onBackgroundTap}>
      {error && <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-md bg-[rgba(0,0,0,.7)] p-4 text-center text-sm">{error}</p>}
      {real && !recording && (
        <span className="absolute rounded-pill bg-[rgba(0,0,0,.55)] px-2 py-0.5 font-mono text-[11px]" style={{ top: `calc(${boxH} + 20px)`, [horizontal ? lens : "left"]: 16 }}>
          {qualityLabel(real, horizontal, takeTurn)}
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
          ...(horizontal ? { [lens]: 12, width: "calc(100vw - 24px)" } : { left: 12, right: 12 }),
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
            transform: "translateY(0px)",
            ...(settings.mirror ? { scale: "-1 1" } : {}),
          }}
        >
          {script.text}
        </div>
        {recording && paused && <span className="absolute bottom-2 right-3 rounded-pill bg-[rgba(0,0,0,.6)] px-2 py-0.5 text-xs">Pausado · toque para seguir</span>}
      </div>

      {/* top-right tools */}
      <div className="absolute flex flex-col gap-3" style={horizontal ? { top: 8, [lens === "left" ? "right" : "left"]: 16 } : { right: 16, top: `calc(${boxH} + 16px)` }}>
        <RoundButton label="Ajustes do teleprompter" onClick={() => setSettingsOpen(true)} disabled={recording}>
          <Settings2 className="size-5" />
        </RoundButton>
        <RoundButton label="Editar roteiro" onClick={onEdit} disabled={recording}>
          <Pencil className="size-5" />
        </RoundButton>
        <RoundButton
          label={horizontal ? "Mudar para vertical" : "Mudar para horizontal"}
          onClick={() => setSettings({ orientation: horizontal ? "vertical" : "horizontal" })}
          disabled={recording || segments.length > 0}
        >
          {horizontal ? <RectangleVertical className="size-5" /> : <RectangleHorizontal className="size-5" />}
        </RoundButton>
        {horizontal && (
          <RoundButton label="Inverter lado (gimbal)" onClick={() => setSettings({ side: settings.side === "left" ? "right" : "left" })} disabled={recording || segments.length > 0}>
            <RotateCw className="size-5" />
          </RoundButton>
        )}
        {caps.torch && (
          <RoundButton
            label={torch ? "Desligar flash" : "Ligar flash"}
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
      <div className="pb-safe absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 bg-gradient-to-t from-[rgba(0,0,0,.7)] to-transparent px-6 pb-6 pt-10">
        {caps.zoom && !recording && (
          <div className="flex gap-2">
            {[1, 2, Math.min(caps.zoom.max, 5)]
              .filter((z, i, a) => z >= caps.zoom!.min && a.indexOf(z) === i)
              .map((z) => (
                <button
                  key={z}
                  type="button"
                  onClick={() => {
                    applyTrack({ zoom: z });
                    setZoom(z);
                  }}
                  className={cn("size-10 rounded-full text-xs font-semibold", zoom === z ? "bg-[#fff] text-[#000]" : "bg-[rgba(0,0,0,.5)]")}
                >
                  {z}x
                </button>
              ))}
          </div>
        )}
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
          <RoundButton label="Fechar teleprompter" onClick={onClose} disabled={recording}>
            <X className="size-6" />
          </RoundButton>
          <RoundButton
            label={arm ? "Confirmar: apagar último trecho" : "Apagar último trecho"}
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
            disabled={!stream}
            className="flex size-20 items-center justify-center rounded-full border-4 border-[#fff] disabled:opacity-40"
          >
            <span className={cn("block transition-all", recording ? "size-8 rounded-md" : "size-16 rounded-full")} style={{ background: REC }} />
          </button>
          <RoundButton label="Concluir" onClick={onDone} disabled={recording || !segments.length} accent>
            <Check className="size-6" />
          </RoundButton>
          <RoundButton label="Virar câmera" onClick={flip}>
            <SwitchCamera className="size-6" />
          </RoundButton>
        </div>
      </div>

      </div>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen} title="Teleprompter">
        <div className="flex flex-col gap-4">
          <Slider label="Velocidade" value={settings.speed} min={1} max={10} defaultValue={5} format={(v) => `${v} · ${wpmOf(v)} palavras/min`} onChange={(speed) => setSettings({ speed })} />
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
            label="Qualidade"
            value={String(settings.quality)}
            options={[
              ["2160", "Máxima (4K)"],
              ["1080", "1080p"],
              ["720", "720p"],
            ]}
            onChange={(v) => setSettings({ quality: Number(v) as PrompterSettings["quality"] })}
          />
          <Choice
            label="Quadros por segundo"
            value={String(settings.fps)}
            options={[
              ["30", "30 fps"],
              ["60", "60 fps"],
            ]}
            onChange={(v) => setSettings({ fps: Number(v) as PrompterSettings["fps"] })}
          />
          <Choice
            label="Formato"
            value={settings.orientation}
            options={[
              ["vertical", "Vertical"],
              ["horizontal", "Horizontal (gimbal)"],
            ]}
            onChange={(v) => setSettings({ orientation: v as PrompterSettings["orientation"] })}
          />
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
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  accent?: boolean;
  children: React.ReactNode;
}) {
  return (
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
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs text-text-muted">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-2">
        {options.map(([v, l]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn("h-9 flex-1 rounded-pill border text-sm", value === v ? "border-accent bg-accent text-on-accent" : "border-border-input")}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}
