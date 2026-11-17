// Teleprompter, like CapCut's: write or pick a script (no length limit),
// then the camera fills the screen with the text in a box near the lens.
// Recording starts after a countdown and the text scrolls at reading pace;
// tap it to pause, drag it to move. The take is watched, redone, saved to the
// phone or used in a project (a new one, or appended to the one it came from).
import { Camera, ChevronLeft, FlipHorizontal2, Pencil, Plus, Settings2, SwitchCamera, Trash2, X, Zap, ZapOff } from "lucide-react";
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
  type PrompterSettings,
  type Script,
} from "../editor/prompter";
import { durationOf, insertMedia } from "../editor/timeline";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";
import { useToast } from "../ui/Toast";
import { formatTime } from "../ui/Transport";

type Step = "scripts" | "edit" | "camera" | "review";
const REC = "#ff3b30"; // the record button's red, on camera (raw: no theme token fits)
const COLORS = ["#ffffff", "#ffd400", "#00e5ff", "#7CFF6B", "#ff8a3d"];

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
  const [take, setTake] = useState<File | null>(null);
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
                    setScript(s);
                    setStep("camera");
                  }}
                >
                  <span className="truncate text-sm font-semibold">{s.title || titleOf(s.text)}</span>
                  <span className="text-xs text-text-muted">
                    {s.text.length.toLocaleString("pt-BR")} caracteres · ~{mmss(readingSeconds(s.text, settings.speed))}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`Editar ${s.title || titleOf(s.text)}`}
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
                  aria-label={`Apagar ${s.title || titleOf(s.text)}`}
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
          <input
            aria-label="Título"
            placeholder="Título (opcional)"
            value={script.title}
            onChange={(e) => setScript({ ...script, title: e.target.value })}
            className="h-11 rounded-md border border-border-input bg-surface-2 px-3 text-base text-text"
          />
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

  if (step === "review" && take)
    return (
      <Review
        take={take}
        toProject={!!projectId}
        onRedo={() => {
          setTake(null);
          setStep("camera");
        }}
        onUse={async () => {
          const id = await takeToProject(take, projectId, toast);
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
        onClose={() => setStep("scripts")}
        onEdit={() => setStep("edit")}
        onTake={(file) => {
          setTake(file);
          setStep("review");
        }}
      />
    );

  return null;
}

// The take goes into a project: appended to the one the teleprompter came
// from, or a new one.
async function takeToProject(file: File, projectId: string | undefined, toast: ReturnType<typeof useToast>) {
  const id = projectId ?? (await createProject()).id;
  const [asset] = await runImport(id, [file], () => {}, toast);
  if (!asset) {
    if (!projectId) await removeProject(id);
    return null;
  }
  const loaded = await loadProject(id);
  if (loaded) await saveDoc(id, insertMedia(loaded.doc, [asset], durationOf(loaded.doc)).doc);
  return id;
}

function Review({ take, toProject, onRedo, onUse }: { take: File; toProject: boolean; onRedo: () => void; onUse: () => Promise<void> }) {
  const [url] = useState(() => URL.createObjectURL(take));
  const [busy, setBusy] = useState(false);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return (
    <main className="pt-safe pb-safe flex h-full flex-col bg-[#000]">
      <video src={url} controls playsInline autoPlay className="min-h-0 flex-1 bg-[#000] object-contain" aria-label="Vídeo gravado" />
      <div className="flex gap-2 bg-bg p-3">
        <Button variant="ghost" className="flex-1" onClick={onRedo} disabled={busy}>
          Refazer
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => void shareFile(take)} disabled={busy}>
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

function CameraPrompter({
  script,
  settings,
  setSettings,
  onClose,
  onEdit,
  onTake,
}: {
  script: Script;
  settings: PrompterSettings;
  setSettings: (p: Partial<PrompterSettings>) => void;
  onClose: () => void;
  onEdit: () => void;
  onTake: (file: File) => void;
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
  const scroll = useRef(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);

  // the camera, again whenever the side or the quality changes
  useEffect(() => {
    let alive = true;
    let s: MediaStream | null = null;
    const long = settings.quality === 2160 ? 3840 : settings.quality === 1080 ? 1920 : 1280;
    const short = settings.quality;
    void navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: settings.facing, width: { ideal: long }, height: { ideal: short }, frameRate: { ideal: 30 } },
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
  }, [settings.facing, settings.quality]);

  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream;
  }, [stream]);

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
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      const mime = r.mimeType || type || "video/mp4";
      const ext = mime.includes("webm") ? "webm" : "mp4";
      const stamp = new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(/[/:]/g, "-").replace(", ", " ");
      onTake(new File(chunks.current, `Teleprompter ${stamp}.${ext}`, { type: mime.split(";")[0] }));
    };
    r.start(1000);
    recorder.current = r;
    scroll.current = 0;
    place();
    startedAt.current = performance.now();
    setElapsed(0);
    setPaused(false);
    setRecording(true);
  }

  function onRecord() {
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

  // on the text: a tap pauses or resumes, a drag moves it by hand
  const drag = useRef<{ y: number; s: number; moved: boolean } | null>(null);
  function down(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, s: scroll.current, moved: false };
  }
  function move(e: PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
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
  return (
    <main className="fixed inset-0 overflow-hidden bg-[#000] text-[#fff]">
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        aria-label="Câmera"
        className="absolute inset-0 size-full object-cover"
        style={front ? { transform: "scaleX(-1)" } : undefined}
      />
      {error && <p className="absolute inset-x-6 top-1/2 -translate-y-1/2 rounded-md bg-[rgba(0,0,0,.7)] p-4 text-center text-sm">{error}</p>}

      {/* the text, near the lens */}
      <div
        ref={box}
        role="region"
        aria-label="Texto do teleprompter"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className="pt-safe absolute inset-x-3 top-2 touch-none overflow-hidden rounded-lg"
        style={{ height: `${settings.boxHeight * 100}%`, background: `rgba(0,0,0,${settings.boxOpacity})` }}
      >
        <div className="absolute inset-x-0 top-[22%] z-10 h-0.5 bg-[rgba(255,255,255,.25)]" aria-hidden />
        <div
          ref={textEl}
          className="whitespace-pre-wrap px-5 pb-[60vh] pt-[18%] font-semibold"
          style={{
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
      <div className="absolute right-4 flex flex-col gap-3" style={{ top: `calc(${settings.boxHeight * 100}% + 16px)` }}>
        <RoundButton label="Ajustes do teleprompter" onClick={() => setSettingsOpen(true)} disabled={recording}>
          <Settings2 className="size-5" />
        </RoundButton>
        <RoundButton label="Editar roteiro" onClick={onEdit} disabled={recording}>
          <Pencil className="size-5" />
        </RoundButton>
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
        <span className="font-mono text-sm tabular-nums" style={{ color: recording ? REC : "rgba(255,255,255,.85)" }}>
          {recording ? `● ${formatTime(elapsed * 1e6)}` : `${wpmOf(settings.speed)} palavras/min · ~${mmss(readingSeconds(script.text, settings.speed))}`}
        </span>
        <div className="flex w-full items-center justify-between">
          <RoundButton label="Fechar teleprompter" onClick={onClose} disabled={recording}>
            <X className="size-6" />
          </RoundButton>
          <button
            type="button"
            aria-label={recording ? "Parar gravação" : "Gravar"}
            onClick={onRecord}
            disabled={!stream}
            className="flex size-20 items-center justify-center rounded-full border-4 border-[#fff] disabled:opacity-40"
          >
            <span className={cn("block transition-all", recording ? "size-8 rounded-md" : "size-16 rounded-full")} style={{ background: REC }} />
          </button>
          <RoundButton label="Virar câmera" onClick={() => setSettings({ facing: front ? "environment" : "user" })} disabled={recording}>
            <SwitchCamera className="size-6" />
          </RoundButton>
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
              ["720", "720p"],
              ["1080", "1080p"],
              ["2160", "4K"],
            ]}
            onChange={(v) => setSettings({ quality: Number(v) as PrompterSettings["quality"] })}
          />
          <Button variant="secondary" icon={<FlipHorizontal2 aria-hidden className="size-4" />} onClick={() => setSettings({ mirror: !settings.mirror })}>
            {settings.mirror ? "Texto espelhado (para vidro de teleprompter)" : "Espelhar texto"}
          </Button>
        </div>
      </Sheet>
    </main>
  );
}

function RoundButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} onClick={onClick} disabled={disabled} className="flex size-12 items-center justify-center rounded-full bg-[rgba(0,0,0,.5)] disabled:opacity-30">
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
