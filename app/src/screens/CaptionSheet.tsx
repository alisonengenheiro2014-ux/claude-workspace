// S10 Legendas automáticas: generate captions from speech on the iPhone,
// then fix words, timing and style for all of them at once.
import { Captions, Check, ChevronDown, ChevronRight, Languages, ScanText, Trash2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { NoSpeechError, transcribe, type CaptionSource, type TranscribeEvent } from "../captions/transcribe";
import type { AsrModel } from "../captions/asr.worker";
import type { TextStyle } from "../data/db";
import { useEditor } from "../editor/store";
import { CAPTION_STYLE } from "../editor/text";
import { applyCaptionPreset, captionTrack, remove, removeCaptions, setCaptions, setCaptionStyle, setCaptionText } from "../editor/timeline";
import { CAPTION_PRESETS, DEFAULT_CAPTION_PRESET, type CaptionPreset } from "../editor/presets";
import { CaptionTemplateTile } from "../ui/CaptionTemplateTile";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { ProgressBar } from "../ui/Progress";
import { Sheet } from "../ui/Sheet";
import { Tabs } from "../ui/Tabs";
import { useToast } from "../ui/Toast";
import { formatTime } from "../ui/Transport";
import { StyleControls } from "./TextSheet";

export type CaptionTab = "generate" | "templates" | "edit" | "style";

const LANGUAGES = [
  { value: "portuguese", label: "Português" },
  { value: "english", label: "Inglês" },
  { value: "spanish", label: "Espanhol" },
  { value: "", label: "Automático" },
];
const SOURCES: { value: CaptionSource; label: string }[] = [
  { value: "video", label: "Vídeo" },
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
  preset: string;
}
const DEFAULT_PREFS: Prefs = { language: "portuguese", source: "video", model: "base", preset: DEFAULT_CAPTION_PRESET };
function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem("caption-prefs");
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    // defaults
  }
  return DEFAULT_PREFS;
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

// A setting row: icon, name, current value, chevron (opens its own page)
function Row({ icon, label, value, onClick }: { icon: ReactNode; label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex h-14 w-full items-center gap-3 rounded-lg bg-surface-2 px-4 text-left">
      <span aria-hidden className="text-text">
        {icon}
      </span>
      <span className="flex-1 text-sm">{label}</span>
      <span className="text-sm text-text-muted">{value}</span>
      <ChevronRight aria-hidden className="size-4 text-text-muted" />
    </button>
  );
}

function ListPicker<T extends string>({ label, value, options, onPick }: { label: string; value: T; options: { value: T; label: string }[]; onPick: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onPick(o.value)}
          className="flex h-12 items-center justify-between border-b border-border text-left text-sm last:border-b-0"
        >
          {o.label}
          {o.value === value && <Check aria-hidden className="size-5 text-accent" />}
        </button>
      ))}
    </div>
  );
}

function TemplateButton({ preset, checked, onPick, small }: { preset: CaptionPreset; checked: boolean; onPick: (id: string) => void; small?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      aria-label={preset.label}
      data-id={preset.id}
      onClick={() => onPick(preset.id)}
      className={cn(
        "relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-surface-3",
        checked && "ring-2 ring-text",
        small && "w-24 shrink-0",
      )}
    >
      {preset.id === "classic" ? (
        <span className={cn("font-semibold", small ? "text-base" : "text-2xl")}>Padrão</span>
      ) : (
        <CaptionTemplateTile preset={preset} />
      )}
    </button>
  );
}

// all templates, two big tiles per row (the "Modelos" page)
function TemplateGrid({ value, onPick }: { value: string; onPick: (id: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Modelos de legenda" className="grid grid-cols-2 gap-3">
      {CAPTION_PRESETS.map((p) => (
        <TemplateButton key={p.id} preset={p} checked={p.id === value} onPick={onPick} />
      ))}
    </div>
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
  // pages inside the generate view
  const [page, setPage] = useState<"main" | "source" | "language" | "templates">("main");
  const [advanced, setAdvanced] = useState(false);
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
      const words = await transcribe(
        s.doc,
        s.assets,
        { source: prefs.source, language: prefs.language || null, model: prefs.model },
        (e) => setRun(describe(e)),
        ctl.signal,
      );
      const now = useEditor.getState();
      const next = setCaptions(now.doc!, words, prefs.preset);
      now.commit(next, "Legendas automáticas");
      toast(`${captionTrack(next)?.items.length ?? 0} legendas criadas`);
      setPage("main");
      onClose();
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

  const generateMain = (
    <div className="flex flex-col gap-3">
      <Row icon={<ScanText className="size-5" />} label="Gerar a partir de" value={SOURCES.find((o) => o.value === prefs.source)!.label} onClick={() => setPage("source")} />
      <Row icon={<Languages className="size-5" />} label="Idioma de origem" value={LANGUAGES.find((o) => o.value === prefs.language)!.label} onClick={() => setPage("language")} />
      <div className="flex flex-col gap-3 rounded-lg bg-surface-2 pb-4">
        <button type="button" onClick={() => setPage("templates")} className="flex h-14 items-center gap-3 px-4 text-left">
          <Captions aria-hidden className="size-5" />
          <span className="flex-1 text-sm">Modelos</span>
          <ChevronRight aria-hidden className="size-4 text-text-muted" />
        </button>
        <div role="radiogroup" aria-label="Modelos de legenda" className="no-scrollbar flex gap-3 overflow-x-auto px-4 py-1">
          {CAPTION_PRESETS.map((p) => (
            <TemplateButton key={p.id} preset={p} checked={p.id === prefs.preset} onPick={(preset) => savePrefs({ ...prefs, preset })} small />
          ))}
        </div>
      </div>
      <div className="rounded-lg bg-surface-2">
        <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)} className="flex h-14 w-full items-center gap-3 px-4 text-left">
          <span className="flex-1 text-sm">Opções avançadas</span>
          <ChevronDown aria-hidden className={cn("size-4 text-text-muted transition-transform", advanced && "rotate-180")} />
        </button>
        {advanced && (
          <div className="flex flex-col gap-3 px-4 pb-4">
            <Choice label="Qualidade" value={prefs.model} options={MODELS} onChange={(model) => savePrefs({ ...prefs, model })} />
            <p className="text-xs text-text-muted">
              Tudo roda no seu iPhone; nada é enviado. {MODELS.find((m) => m.value === prefs.model)?.note}, depois funciona offline.
            </p>
          </div>
        )}
      </div>
      {track && <p className="text-xs text-text-muted">Gerar de novo substitui as legendas atuais.</p>}
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
          Gerar
        </Button>
      )}
    </div>
  );

  const generatePages = {
    main: { title: "Gere legendas automáticas", body: generateMain },
    source: {
      title: "Gerar a partir de",
      body: <ListPicker label="Gerar a partir de" value={prefs.source} options={SOURCES} onPick={(source) => (savePrefs({ ...prefs, source }), setPage("main"))} />,
    },
    language: {
      title: "Idioma de origem",
      body: <ListPicker label="Idioma de origem" value={prefs.language} options={LANGUAGES} onPick={(language) => (savePrefs({ ...prefs, language }), setPage("main"))} />,
    },
    templates: {
      title: "Modelos",
      body: (
        <>
          <TemplateGrid value={prefs.preset} onPick={(preset) => savePrefs({ ...prefs, preset })} />
          <div className="sticky -bottom-4 -mx-4 -mb-4 mt-4 bg-surface px-4 pb-4 pt-3">
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => {
                setPage("main"); // the progress shows there
                void generate();
              }}
            >
              Gerar
            </Button>
          </div>
        </>
      ),
    },
  }[page];

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

  // Templates on existing captions: the same words, regrouped
  const templatesTab = (
    <TemplateGrid
      value={track?.preset ?? prefs.preset}
      onPick={(id) => {
        savePrefs({ ...prefs, preset: id });
        if (track) draft((d) => applyCaptionPreset(d, id));
      }}
    />
  );

  const styleTab = (
    <div className="flex flex-col gap-4">
      <StyleControls value={style} onChange={(p: Partial<TextStyle>) => draft((d) => setCaptionStyle(d, { ...style, ...p }))} />
      <p className="text-xs text-text-muted">O estilo vale para todas as legendas. Arraste uma legenda na prévia para mudar a posição de todas.</p>
    </div>
  );

  const generating = tab === "generate";
  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o && run) return; // cancel first
        if (!o) {
          setPage("main");
          onClose();
        }
      }}
      title={generating ? generatePages.title : "Legendas"}
      onBack={generating && page !== "main" ? () => setPage("main") : undefined}
    >
      {generating ? (
        generatePages.body
      ) : (
        <Tabs
          label="Legendas"
          value={tab}
          onValueChange={(v) => onTab(v as CaptionTab)}
          tabs={[
            { value: "templates", label: "Modelos", content: templatesTab },
            { value: "edit", label: "Editar", content: editTab },
            { value: "style", label: "Estilo", content: styleTab },
          ]}
        />
      )}
    </Sheet>
  );
}
