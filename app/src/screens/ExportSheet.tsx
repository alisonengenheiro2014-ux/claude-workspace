// S17 Exportar: settings, progress, then save or share.
import { Download, Share } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../editor/store";
import { durationOf, frameSize, mainClips } from "../editor/timeline";
import { estimateBytes, ExportCancelled, exportTimeline, type ExportOptions } from "../export/exporter";
import { Button } from "../ui/Button";
import { cn } from "../ui/cn";
import { ProgressRing } from "../ui/Progress";
import { Sheet } from "../ui/Sheet";
import { useToast } from "../ui/Toast";

const RESOLUTIONS: { value: ExportOptions["shortSide"]; label: string }[] = [
  { value: 720, label: "720p" },
  { value: 1080, label: "1080p" },
  { value: 1440, label: "2K" },
  { value: 2160, label: "4K" },
];
const FPS: ExportOptions["fps"][] = [24, 25, 30, 50, 60];
const QUALITY: { value: ExportOptions["quality"]; label: string }[] = [
  { value: "low", label: "Menor arquivo" },
  { value: "recommended", label: "Recomendada" },
  { value: "high", label: "Máxima" },
];

export function resolutionLabel(shortSide: number) {
  return RESOLUTIONS.find((r) => r.value === shortSide)?.label ?? `${shortSide}p`;
}

function formatBytes(n: number) {
  return n < 1e9 ? `${Math.max(1, Math.round(n / 1e6))} MB` : `${(n / 1e9).toFixed(1)} GB`;
}

function Choice<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; label: string; disabled?: boolean; note?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
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
            disabled={o.disabled}
            title={o.note}
            onClick={() => onChange(o.value)}
            className={cn(
              "h-9 min-w-14 rounded-pill border px-3 text-sm disabled:opacity-35",
              o.value === value ? "border-accent bg-accent text-on-accent" : "border-border-input text-text",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

type Phase =
  | { name: "settings" }
  | { name: "running"; fraction: number; stage: string }
  | { name: "done"; file: File }
  | { name: "error"; message: string };

export function ExportSheet({
  open,
  onOpenChange,
  options,
  onOptionsChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ExportOptions;
  onOptionsChange: (o: ExportOptions) => void;
}) {
  const toast = useToast();
  const doc = useEditor((s) => s.doc);
  const assets = useEditor((s) => s.assets);
  const [phase, setPhase] = useState<Phase>({ name: "settings" });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (open && phase.name !== "running") setPhase({ name: "settings" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!doc) return null;
  const totalUs = durationOf(doc);
  // largest short side among the media: no 4K unless some media is 4K
  const maxShort = Math.max(
    0,
    ...mainClips(doc).map((c) => {
      const a = assets.get(c.assetId);
      return a ? Math.min(a.width, a.height) : 0;
    }),
  );
  const size = frameSize(doc, assets, options.shortSide);
  const estimate = estimateBytes(totalUs, size.width, size.height, options);

  async function run() {
    if (!doc) return;
    await useEditor.getState().flush();
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase({ name: "running", fraction: 0, stage: "Preparando o áudio" });
    let lock: WakeLockSentinel | null = null;
    try {
      lock = await navigator.wakeLock?.request("screen").catch(() => null);
      const result = await exportTimeline(
        doc,
        assets,
        options,
        (fraction, stage) =>
          setPhase({
            name: "running",
            fraction,
            stage: stage === "audio" ? "Preparando o áudio" : stage === "video" ? "Gerando o vídeo" : "Finalizando",
          }),
        ctl.signal,
      );
      setPhase({ name: "done", file: result.file });
    } catch (err) {
      if (err instanceof ExportCancelled) {
        setPhase({ name: "settings" });
        toast("Exportação cancelada");
      } else {
        console.error(err);
        setPhase({ name: "error", message: err instanceof Error ? err.message : "Erro desconhecido." });
      }
    } finally {
      await lock?.release().catch(() => {});
      abort.current = null;
    }
  }

  async function share(file: File) {
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
      }
    }
    download(file);
  }

  function download(file: File) {
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  const running = phase.name === "running";

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o && running) return; // closing would hide the progress; cancel first
        onOpenChange(o);
      }}
      title="Exportar"
    >
      {phase.name === "settings" && (
        <div className="flex flex-col gap-5">
          <Choice
            label="Resolução"
            value={options.shortSide}
            onChange={(shortSide) => onOptionsChange({ ...options, shortSide })}
            options={RESOLUTIONS.map((r) => ({
              ...r,
              disabled: r.value > 1080 && r.value > maxShort,
              note: r.value > maxShort ? "Nenhuma mídia do projeto tem essa resolução" : undefined,
            }))}
          />
          <Choice
            label="Quadros por segundo"
            value={options.fps}
            onChange={(fps) => onOptionsChange({ ...options, fps })}
            options={FPS.map((f) => ({ value: f, label: String(f) }))}
          />
          <Choice label="Qualidade" value={options.quality} onChange={(quality) => onOptionsChange({ ...options, quality })} options={QUALITY} />
          <p className="text-xs text-text-muted">
            {size.width}×{size.height} · cerca de {formatBytes(estimate)}
          </p>
          <Button variant="primary" size="lg" disabled={totalUs === 0} onClick={() => void run()}>
            Exportar vídeo
          </Button>
        </div>
      )}

      {phase.name === "running" && (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <ProgressRing value={phase.fraction} label="Exportando" />
          <p className="text-sm" aria-live="polite">
            {phase.stage}
          </p>
          <p className="text-xs text-text-muted">Mantenha o app aberto e a tela ligada até terminar.</p>
          <Button variant="ghost" onClick={() => abort.current?.abort()}>
            Cancelar
          </Button>
        </div>
      )}

      {phase.name === "done" && (
        <div className="flex flex-col gap-3 text-center">
          <p className="text-lg">Vídeo pronto</p>
          <p className="text-xs text-text-muted">{formatBytes(phase.file.size)}</p>
          <Button variant="primary" size="lg" icon={<Share aria-hidden className="size-5" />} onClick={() => void share(phase.file)}>
            Salvar ou compartilhar
          </Button>
          <Button variant="ghost" icon={<Download aria-hidden className="size-4" />} onClick={() => download(phase.file)}>
            Baixar arquivo
          </Button>
        </div>
      )}

      {phase.name === "error" && (
        <div role="alert" className="flex flex-col gap-3 text-center">
          <p className="text-lg">A exportação falhou</p>
          <p className="text-sm text-text-muted">{phase.message}</p>
          <Button variant="primary" onClick={() => void run()}>
            Tentar de novo
          </Button>
          <Button variant="ghost" onClick={() => setPhase({ name: "settings" })}>
            Mudar configurações
          </Button>
        </div>
      )}
    </Sheet>
  );
}
