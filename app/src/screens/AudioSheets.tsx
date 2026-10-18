// S07 Áudio (add music, extract a video's sound, record a voice-over) and
// the S08 fade sheet.
import { Mic, Music, Square, Split } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { MediaClip } from "../data/db";
import { audio } from "../editor/audio";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";
import { formatTime } from "../ui/Transport";

export function AudioMenu({
  open,
  onOpenChange,
  onMusic,
  onExtract,
  canExtract,
  onRecord,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onMusic: () => void;
  onExtract: () => void;
  canExtract: boolean;
  onRecord: () => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Áudio">
      <div className="flex flex-col gap-2">
        <Button className="justify-start" icon={<Music aria-hidden className="size-5" />} onClick={onMusic}>
          Música ou som do iPhone
        </Button>
        <Button className="justify-start" icon={<Mic aria-hidden className="size-5" />} onClick={onRecord}>
          Gravar narração
        </Button>
        <Button className="justify-start" icon={<Split aria-hidden className="size-5" />} disabled={!canExtract} onClick={onExtract}>
          Extrair o som do clipe
        </Button>
        <p className="mt-2 text-xs text-text-muted">
          A música entra no ponto do cursor e termina junto com o vídeo; ajuste depois arrastando as bordas. Use músicas suas:
          mp3, m4a ou wav salvos no app Arquivos.
        </p>
      </div>
    </Sheet>
  );
}

// Fade in / out for one clip; at most half its length each.
export function FadeSheet({
  clip,
  onChange,
  onClose,
}: {
  clip: MediaClip | null;
  onChange: (patch: Partial<MediaClip>) => void;
  onClose: () => void;
}) {
  const maxS = clip ? Math.max(0.1, Math.floor((clip.durationUs / 2e6) * 10) / 10) : 1;
  return (
    <Sheet open={!!clip} onOpenChange={(o) => !o && onClose()} title="Aparecer e sumir">
      {clip && (
        <div className="flex flex-col gap-4">
          <Slider
            label="Aparecer gradualmente"
            value={Math.min(maxS, clip.fadeInUs / 1e6)}
            min={0}
            max={Math.min(10, maxS)}
            step={0.1}
            defaultValue={0}
            format={(v) => `${v.toFixed(1)} s`}
            onChange={(v) => onChange({ fadeInUs: Math.round(v * 1e6) })}
          />
          <Slider
            label="Sumir gradualmente"
            value={Math.min(maxS, clip.fadeOutUs / 1e6)}
            min={0}
            max={Math.min(10, maxS)}
            step={0.1}
            defaultValue={0}
            format={(v) => `${v.toFixed(1)} s`}
            onChange={(v) => onChange({ fadeOutUs: Math.round(v * 1e6) })}
          />
        </div>
      )}
    </Sheet>
  );
}

// What went wrong with the microphone, in words, with the browser's reason.
function micError(err: unknown) {
  const name = err instanceof DOMException ? err.name : "Error";
  const detail = err instanceof Error && err.message ? ` (${name}: ${err.message})` : ` (${name})`;
  if (name === "NotAllowedError" || name === "SecurityError")
    return `O iPhone negou o microfone. Veja Ajustes → Apps → Safari → Microfone e, se o app está na tela de início, abra-o pelo Safari uma vez e permita${detail}.`;
  if (name === "NotFoundError") return `Nenhum microfone encontrado${detail}.`;
  if (name === "NotReadableError" || name === "AbortError" || name === "InvalidStateError")
    return `O microfone está ocupado (uma ligação ou outro app gravando?)${detail}.`;
  return `Não foi possível usar o microfone${detail}.`;
}

function pickMime() {
  for (const m of ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return "";
}

// Voice-over: the video plays silently from the cursor while the mic records.
export function RecordSheet({
  open,
  onOpenChange,
  onStartPlayback,
  onStopPlayback,
  onDone,
  onError,
  cursorUs,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cursorUs: () => number; // where the recording will be placed
  onStartPlayback: () => void;
  onStopPlayback: () => void;
  onDone: (file: File, startedAtTimelineUs: number) => void;
  onError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "count" | "rec">("idle");
  const [count, setCount] = useState(3);
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; chunks: Blob[]; startedAt: number; tl: number } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    clearInterval(timer.current);
    if (rec.current) {
      rec.current.stream.getTracks().forEach((t) => t.stop());
      audio.setSessionType("playback");
    }
  }

  // The mic is asked for on the tap (iOS wants a gesture); playback starts
  // after a 3 s countdown so you can get ready.
  async function start(timelineUs: number) {
    // switch the audio session before asking: in "playback" iOS refuses the mic
    audio.setSessionType("play-and-record");
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch (err) {
      audio.setSessionType("playback");
      onError(micError(err));
      return;
    }
    const mime = pickMime();
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.current = { recorder, stream, chunks, startedAt: 0, tl: timelineUs };
    setPhase("count");
    setCount(3);
    let n = 3;
    timer.current = setInterval(() => {
      n -= 1;
      setCount(n);
      if (n > 0) return;
      clearInterval(timer.current);
      recorder.start(250);
      onStartPlayback();
      rec.current!.startedAt = performance.now();
      setPhase("rec");
      timer.current = setInterval(() => setElapsed(performance.now() - rec.current!.startedAt), 200);
    }, 1000);
  }

  function stop() {
    const r = rec.current;
    if (!r) return;
    clearInterval(timer.current);
    onStopPlayback();
    r.recorder.onstop = () => {
      r.stream.getTracks().forEach((t) => t.stop());
      audio.setSessionType("playback");
      const type = r.recorder.mimeType || "audio/mp4";
      const ext = type.includes("webm") ? "webm" : "m4a";
      const stamp = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).replace(/:/g, "");
      onDone(new File(r.chunks, `narracao-${stamp}.${ext}`, { type }), r.tl);
      rec.current = null;
      setPhase("idle");
      setElapsed(0);
    };
    if (r.recorder.state !== "inactive") r.recorder.stop();
    else r.recorder.onstop(new Event("stop"));
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o && phase !== "idle") return; // stop first
        onOpenChange(o);
      }}
      title="Gravar narração"
    >
      <div className="flex flex-col items-center gap-4 py-2 text-center">
        {phase === "idle" && (
          <>
            <p className="text-sm text-text-muted">O vídeo toca sem som a partir do cursor enquanto você grava. Use fone para um som mais limpo.</p>
            <Button variant="danger" size="lg" icon={<Mic aria-hidden className="size-5" />} onClick={() => void start(cursorUs())}>
              Começar a gravar
            </Button>
          </>
        )}
        {phase === "count" && (
          <p className="font-mono text-xl tabular-nums" aria-live="assertive">
            {count}
          </p>
        )}
        {phase === "rec" && (
          <>
            <p className="flex items-center gap-2 text-sm" aria-live="polite">
              <span aria-hidden className="size-3 animate-pulse rounded-pill bg-danger" /> Gravando {formatTime(elapsed * 1000)}
            </p>
            <Button variant="primary" size="lg" icon={<Square aria-hidden className="size-5" />} onClick={stop}>
              Parar
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
