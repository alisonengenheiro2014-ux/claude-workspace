// S17 Exportar: settings, progress, then save or share.
import { Download, Share } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useEditor } from "../editor/store";
import { durationOf, frameSize, mainClips } from "../editor/timeline";
import { assetFile, isPending, remainingAssetFile } from "../media/import";
import { shareFile } from "../data/backup";
import { estimateBytes, ExportCancelled, exportTimeline, pickCodecs, videoBitrate, type ExportOptions } from "../export/exporter";
import { loadCompletedExport, rememberCompletedExport } from "../export/completedExport";
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

// "1:20 decorridos · cerca de 3:05 restantes", once there is enough progress to guess.
function timeLeft(fraction: number, startedAt: number) {
  const elapsed = (Date.now() - startedAt) / 1000;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  if (fraction < 0.03 || elapsed < 5) return `${mmss(elapsed)} decorridos`;
  return `${mmss(elapsed)} decorridos · cerca de ${mmss((elapsed / fraction) * (1 - fraction))} restantes`;
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
  | { name: "running"; fraction: number; stage: string; startedAt: number }
  | { name: "done"; file: File }
  | { name: "error"; message: string };

export function ExportSheet({
  open,
  onOpenChange,
  options,
  onOptionsChange,
  onBeforeExport,
  onAfterExport,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ExportOptions;
  onOptionsChange: (o: ExportOptions) => void;
  onBeforeExport?: () => void;
  onAfterExport?: () => void;
}) {
  const toast = useToast();
  const doc = useEditor((s) => s.doc);
  const projectId = useEditor((s) => s.projectId);
  const assets = useEditor((s) => s.assets);
  const [checkingCodec, setCheckingCodec] = useState(false);
  const [recoverableExport, setRecoverableExport] = useState<File | null>(null);
  useEffect(() => {
    if (!open || !projectId) return;
    let alive = true;
    void loadCompletedExport(projectId).then((file) => { if (alive) setRecoverableExport(file); })
      .catch(() => { /* no recoverable export */ });
    return () => { alive = false; };
  }, [open, projectId]);
  const [phase, setPhase] = useState<Phase>({ name: "settings" });
  const abort = useRef<AbortController | null>(null);
  // Keep an OPFS-backed File ready for the share button. iOS needs the
  // share sheet to open directly from a tap (not after an awaited file read).
  const firstVideo = doc ? mainClips(doc).find((c) => assets.get(c.assetId)?.kind === "video") : undefined;
  const originalAsset = firstVideo ? assets.get(firstVideo.assetId) : undefined;
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [partialFile, setPartialFile] = useState<File | null>(null);
  const [originalLoading, setOriginalLoading] = useState(false);
  const [recoverAttempt, setRecoverAttempt] = useState(0);
  useEffect(() => {
    if (!open || !originalAsset) {
      setOriginalFile(null);
      setPartialFile(null);
      setOriginalLoading(false);
      return;
    }
    let alive = true;
    setOriginalFile(null);
    setPartialFile(null);
    setOriginalLoading(true);
    void (async () => {
      // assetFile also repairs an interrupted "importing" status when the
      // complete bytes actually exist on disk.
      const file = await assetFile(originalAsset);
      const remainder = file ? null : await remainingAssetFile(originalAsset);
      if (!alive) return;
      setOriginalFile(file);
      setPartialFile(remainder);
      setOriginalLoading(false);
    })().catch(() => { if (alive) setOriginalLoading(false); });
    return () => { alive = false; };
  }, [open, originalAsset, recoverAttempt]);

  const savePartial = () => {
    if (!partialFile || !originalAsset) return;
    // A partial MP4 is NOT guaranteed to play; share whatever survived so
    // an external repair tool can inspect it without modifying OPFS.
    const name = originalAsset.name.replace(/\.[^.]+$/, "") + "-fragmento.mp4";
    const salvage = new File([partialFile], name, { type: partialFile.type || "video/mp4" });
    void shareFile(salvage).catch((error: unknown) => {
      toast(`Não foi possível salvar o fragmento: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  };
  const saveOriginal = () => {
    if (!originalFile) return;
    // This bypasses the audio mix/video re-encode and preserves the exact
    // recording. It intentionally does not apply any edits to the timeline.
    void shareFile(originalFile).catch((error: unknown) => {
      toast(`Não foi possível salvar o arquivo original: ${error instanceof Error ? error.message : String(error)}`, "error");
    });
  };

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
    const stillCopying = doc.tracks.some((lane) => lane.items.some((item) => item.type === "media" && isPending(item.assetId)));
    if (stillCopying) {
      toast("O vídeo ainda está sendo guardado no iPhone. Aguarde a cópia terminar antes de exportar; você já pode salvar o original.", "error");
      return;
    }
    if (options.shortSide > maxShort) {
      if (!confirm("O original tem no máximo " + (maxShort || "desconhecida") +
        " linhas no lado menor. Exportar em " + options.shortSide +
        "p amplia os pixels mas não cria detalhes novos. Continuar?")) return;
    }
    if (options.shortSide >= 2160 && totalUs > 60_000_000 &&
      !confirm("4K em vídeos longos pode consumir muita memória e tempo. " +
        "Salve o original antes de continuar. Quer tentar mesmo assim?")) return;
    const dimensions = frameSize(doc, assets, options.shortSide);
    // Refuse a predictable disk-full failure before decoding thousands of
    // frames. This never deletes OPFS originals, recovery ZIPs or old exports.
    const estimated = estimateBytes(totalUs, dimensions.width, dimensions.height, options);
    try {
      const quota = await navigator.storage?.estimate?.();
      if (quota?.quota && quota?.usage !== undefined &&
        quota.quota - quota.usage < estimated * 1.15 + 60_000_000) {
        toast("Espaço insuficiente no iPhone para gerar esta exportação. " +
          "Você precisa de aproximadamente " + formatBytes(estimated * 1.15 + 60_000_000) +
          " livres. Não apague os vídeos originais.", "error");
        return;
      }
    } catch { /* Safari may not report quota */ }
    setCheckingCodec(true);
    try {
      const codecs = await pickCodecs(
        dimensions.width, dimensions.height,
        videoBitrate(dimensions.width, dimensions.height, options.fps, options.quality),
      );
      if (!codecs.video) {
        toast("Este iPhone não suporta codificar " + dimensions.width +
          "×" + dimensions.height + ". Tente 1080p ou 2K.", "error");
        return;
      }
    } catch (error) {
      toast("Não consegui verificar o codificador: " + String(error), "error");
      return;
    } finally { setCheckingCodec(false); }
    await useEditor.getState().flush();
    const ctl = new AbortController();
    abort.current = ctl;
    const startedAt = Date.now();
    setPhase({ name: "running", fraction: 0, stage: "Preparando o áudio", startedAt });
    onBeforeExport?.();
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
            startedAt,
            stage: stage === "audio" ? "Preparando o áudio" : stage === "video" ? "Gerando o vídeo" : "Finalizando",
          }),
        ctl.signal,
      );
      if (projectId) {
        const saved = await rememberCompletedExport(projectId, result.file);
        if (saved) setRecoverableExport(result.file);
      }
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
      onAfterExport?.();
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
              note: r.value > maxShort
                ? "Ampliação digital: não cria detalhes originais"
                : undefined,
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
            {options.shortSide > 1080 && " · em 2K e 4K a exportação demora bem mais"}
          </p>
          {maxShort > 0 && options.shortSide > maxShort && (
            <p className="rounded-md border border-[#fbbf24]/50 p-3 text-xs">
              Upscale: fonte até {maxShort}p → arquivo {options.shortSide}p.
              A ampliação não recupera detalhes novos. Para um 4K realmente mais nítido,
              grave originalmente em 4K e escolha Qualidade Máxima.
            </p>
          )}
          <Button variant="primary" size="lg" disabled={totalUs === 0 || checkingCodec} loading={checkingCodec} onClick={() => void run()}>
            {checkingCodec ? "Verificando codificador…" : "Exportar vídeo"}
          </Button>
          {recoverableExport && (
            <div className="rounded-lg border border-accent/50 bg-surface-2 p-3">
              <p className="text-sm font-semibold">Última exportação concluída</p>
              <p className="my-2 text-xs text-text-muted">
                {recoverableExport.name} · {formatBytes(recoverableExport.size)}.
                O arquivo continua no armazenamento deste iPhone.
              </p>
              <Button variant="secondary" icon={<Share className="size-4" />}
                onClick={() => void share(recoverableExport)}>
                Recuperar vídeo exportado
              </Button>
            </div>
          )}
          {originalAsset && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">Proteger a gravação</p>
              <Button
                variant="secondary"
                icon={<Download aria-hidden className="size-5" />}
                disabled={!originalFile || originalLoading}
                onClick={saveOriginal}
              >
                {originalLoading ? "Localizando gravação…" : "Salvar vídeo original"}
              </Button>
              <p className="text-xs text-text-muted">
                {formatBytes(originalAsset.sizeBytes)} · Salva o arquivo da câmera sem reprocessar,
                mesmo se a exportação travar. Não inclui cortes, textos ou efeitos.
              </p>
              {!originalLoading && !originalFile && (
                <div className="flex flex-col gap-2">
                  {partialFile && (
                    <>
                      <p className="text-xs text-text-muted">
                        Encontrei {formatBytes(partialFile.size)} do arquivo de {formatBytes(originalAsset.sizeBytes)}.
                        O fragmento pode não abrir, mas é melhor preservá-lo antes de tentar reparos.
                      </p>
                      <Button variant="secondary" icon={<Download aria-hidden className="size-5" />} onClick={savePartial}>
                        Salvar fragmento encontrado
                      </Button>
                    </>
                  )}
                  {!partialFile && (
                    <p role="alert" className="text-xs text-danger">
                      O arquivo original não está no armazenamento deste PWA; só restaram os dados do projeto e as miniaturas. Se você já salvou o vídeo no app Arquivos, selecione-o para substituir a mídia.
                    </p>
                  )}
                  <Button variant="ghost" onClick={() => setRecoverAttempt((n) => n + 1)}>
                    Verificar armazenamento novamente
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {phase.name === "running" && (
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <ProgressRing value={phase.fraction} label="Exportando" />
          <p className="text-sm" aria-live="polite">
            {phase.stage}
          </p>
          <p className="font-mono text-xs text-text-muted tabular-nums">{timeLeft(phase.fraction, phase.startedAt)}</p>
          <p className="text-xs text-text-muted">
            O iOS pode pausar a exportação ao abrir outro app.
            Se o PWA continuar ativo, ela retoma ao voltar. Arquivos já
            finalizados ficam disponíveis em Última exportação concluída.
          </p>
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
          {originalAsset && (
            <Button
              variant="secondary"
              icon={<Download aria-hidden className="size-5" />}
              onClick={() => {
                setRecoverAttempt((n) => n + 1);
                setPhase({ name: "settings" });
              }}
            >
              Recuperar / salvar gravação original
            </Button>
          )}
        </div>
      )}
    </Sheet>
  );
}
