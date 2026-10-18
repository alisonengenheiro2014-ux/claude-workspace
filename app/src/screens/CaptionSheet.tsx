// S10 Legendas automáticas: generate captions from speech on the iPhone,
// then fix words, timing and style for all of them at once.
import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { NoSpeechError, transcribe, type CaptionSource, type TranscribeEvent } from "../captions/transcribe";
import type { AsrModel } from "../captions/asr.worker";
import type { TextStyle } from "../data/db";
import { useEditor } from "../editor/store";
import { CAPTION_STYLE } from "../editor/text";
import { captionTrack, remove, removeCaptions, setCaptions, setCaptionStyle, setCaptionText } from "../editor/timeline";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { ProgressBar } from "../ui/Progress";
import { Sheet } from "../ui/Sheet";
import { Tabs } from "../ui/Tabs";
import { useToast } from "../ui/Toast";
import { formatTime } from "../ui/Transport";
import { StyleControls } from "./TextSheet";

export type CaptionTab = "generate" | "edit" | "style";

const LANGUAGES = [
  { value: "portuguese", label: "Português" },
  { value: "english", label: "Inglês" },
  { value: "spanish", label: "Espanhol" },
  { value: "", label: "Detectar" },
];
const SOURCES: { value: CaptionSource; label: string }[] = [
  { value: "video", label: "Som dos vídeos" },
  { value: "audio", label: "Narração e áudios" },
  { value: "all", label: "Tudo" },
];
const MODELS: { value: AsrModel; label: string; note: string }[] = [
  { value: "base", label: "Mais precisa", note: "baixa ~75 MB na primeira vez" },
  { value: "tiny", label: "Mais rápida", note: "baixa ~40 MB na primeira vez" },
];

// Set while captions are being generated. If it is still there when the app
// starts, iOS closed the app in the middle (usually memory).
const RUNNING_KEY = "asr-running";
export function takeCrashedCaptionRun(): { model: AsrModel } | null {
  try {
    const raw = localStorage.getItem(RUNNING_KEY);
    if (!raw) return null;
    localStorage.removeItem(RUNNING_KEY);
    return JSON.parse(raw) as { model: AsrModel };
  } catch {
    return null;
  }
}

interface Prefs {
  language: string;
  source: CaptionSource;
  model: AsrModel;
}
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem("caption-prefs");
    if (raw) return { language: "portuguese", source: "video", model: "base", ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    // defaults
  }
  return { language: "portuguese", source: "video", model: "base" };
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-xs text-text-muted">{label}</legend>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={cn("h-9 rounded-pill border px-3 text-sm", o.value === value ? "border-accent bg-accent text-on-accent" : "border-border-input")}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

type Run = { label: string; fraction: number | null } | null;

function describe(e: TranscribeEvent): Run {
  if (e.stage === "mixing") return { label: "Preparando o som", fraction: null };
  if (e.stage === "loading") return { label: e.device === "webgpu" ? "Carregando o modelo (GPU)" : "Carregando o modelo", fraction: null };
  if (e.stage === "download")
    return { label: `Baixando o modelo · ${Math.round(e.loaded / 1e6)} de ${Math.round(e.total / 1e6)} MB`, fraction: e.total ? e.loaded / e.total : null };
  return { label: `Transcrevendo${e.device === "webgpu" ? " (GPU)" : ""}`, fraction: e.fraction };
}

export function CaptionSheet({
  open,
  tab,
  onTab,
  onClose,
  onBeforeRun,
  onAfterRun,
}: {
  open: boolean;
  tab: CaptionTab;
  onTab: (t: CaptionTab) => void;
  onClose: () => void;
  onBeforeRun?: () => void; // free memory (the preview's video) while the model runs
  onAfterRun?: () => void;
}) {
  const toast = useToast();
  const doc = useEditor((s) => s.draft ?? s.doc);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [run, setRun] = useState<Run>(null);
  const abort = useRef<AbortController | null>(null);
  const track = doc ? captionTrack(doc) : undefined;
  const style = track?.style ?? CAPTION_STYLE;

  function savePrefs(p: Prefs) {
    setPrefs(p);
    try {
      localStorage.setItem("caption-prefs", JSON.stringify(p));
    } catch {
      // not important
    }
  }

  async function generate() {
    const s = useEditor.getState();
    if (!s.doc) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setRun({ label: "Preparando o som", fraction: null });
    let lock: WakeLockSentinel | null = null;
    try {
      localStorage.setItem(RUNNING_KEY, JSON.stringify({ model: prefs.model, at: Date.now() }));
    } catch {
      // private mode: no crash guard
    }
    onBeforeRun?.();
    try {
      lock = await navigator.wakeLock?.request("screen").catch(() => null);
      const segments = await transcribe(
        s.doc,
        s.assets,
        { source: prefs.source, language: prefs.language || null, model: prefs.model },
        (e) => setRun(describe(e)),
        ctl.signal,
      );
      const now = useEditor.getState();
      const next = setCaptions(now.doc!, segments, captionTrack(now.doc!)?.style ?? CAPTION_STYLE);
      now.commit(next, "Legendas automáticas");
      toast(`${captionTrack(next)?.items.length ?? 0} legendas criadas`);
      onTab("edit");
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") toast("Legendas canceladas");
      else if (err instanceof NoSpeechError) toast(err.message, "error");
      else {
        console.error(err);
        toast(`Não foi possível gerar as legendas: ${err instanceof Error ? err.message : err}`, "error");
      }
    } finally {
      await lock?.release().catch(() => {});
      try {
        localStorage.removeItem(RUNNING_KEY);
      } catch {
        // nothing to clear
      }
      abort.current = null;
      setRun(null);
      onAfterRun?.();
    }
  }

  // edits go to the draft; closing the sheet makes them one undo step
  function draft(fn: (d: NonNullable<typeof doc>) => NonNullable<typeof doc>) {
    const s = useEditor.getState();
    const cur = s.draft ?? s.doc;
    if (cur) s.setDraft(fn(cur));
  }

  const generateTab = (
    <div className="flex flex-col gap-5">
      <Choice label="Idioma da fala" value={prefs.language} options={LANGUAGES} onChange={(language) => savePrefs({ ...prefs, language })} />
      <Choice label="De onde vem a fala" value={prefs.source} options={SOURCES} onChange={(source) => savePrefs({ ...prefs, source })} />
      <Choice label="Qualidade" value={prefs.model} options={MODELS} onChange={(model) => savePrefs({ ...prefs, model })} />
      <p className="text-xs text-text-muted">
        Tudo roda no seu iPhone; nada é enviado. {MODELS.find((m) => m.value === prefs.model)?.note}, depois funciona offline.
        {track ? " Gerar de novo substitui as legendas atuais." : ""}
      </p>
      {run ? (
        <div className="flex flex-col gap-2" aria-live="polite">
          <p className="text-sm">{run.label}</p>
          {run.fraction !== null ? (
            <ProgressBar value={run.fraction} label={run.label} />
          ) : (
            <div aria-busy className="h-1 w-full animate-pulse rounded-pill bg-surface-3" />
          )}
          <p className="text-xs text-text-muted">Mantenha o app aberto.</p>
          <Button variant="ghost" onClick={() => abort.current?.abort()}>
            Cancelar
          </Button>
        </div>
      ) : (
        <Button variant="primary" size="lg" onClick={() => void generate()}>
          {track ? "Gerar de novo" : "Gerar legendas"}
        </Button>
      )}
    </div>
  );

  const editTab = track ? (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {track.items.map((c) => (
          <li key={c.id} className="flex items-start gap-2">
            <button
              type="button"
              aria-label={`Ir para ${formatTime(c.startUs)}`}
              onClick={() => useEditor.getState().setPlayhead(c.startUs + 1)}
              className="mt-2 w-12 shrink-0 font-mono text-xs text-text-muted tabular-nums"
            >
              {formatTime(c.startUs)}
            </button>
            <textarea
              aria-label={`Legenda em ${formatTime(c.startUs)}`}
              value={c.type === "caption" ? c.text : ""}
              rows={2}
              onChange={(e) => draft((d) => setCaptionText(d, c.id, e.target.value))}
              className="min-w-0 flex-1 resize-none rounded-md border border-border-input bg-surface-2 p-2 text-sm text-text"
            />
            <button
              type="button"
              aria-label={`Apagar legenda de ${formatTime(c.startUs)}`}
              onClick={() => draft((d) => remove(d, c.id))}
              className="flex size-11 shrink-0 items-center justify-center text-text-muted"
            >
              <Trash2 aria-hidden className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      <Button variant="danger" onClick={() => draft(removeCaptions)}>
        Apagar todas as legendas
      </Button>
    </div>
  ) : (
    <p className="text-sm text-text-muted">Ainda não há legendas. Gere na primeira aba.</p>
  );

  const styleTab = (
    <div className="flex flex-col gap-4">
      <StyleControls value={style} onChange={(p: Partial<TextStyle>) => draft((d) => setCaptionStyle(d, { ...style, ...p }))} />
      <p className="text-xs text-text-muted">O estilo vale para todas as legendas. Arraste uma legenda na prévia para mudar a posição de todas.</p>
    </div>
  );

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o && run) return; // cancel first
        if (!o) onClose();
      }}
      title="Legendas"
    >
      <Tabs
        label="Legendas"
        value={tab}
        onValueChange={(v) => onTab(v as CaptionTab)}
        tabs={[
          { value: "generate", label: "Gerar", content: generateTab },
          { value: "edit", label: "Editar", content: editTab },
          { value: "style", label: "Estilo", content: styleTab },
        ]}
      />
    </Sheet>
  );
}
