import type { ImportProgress } from "../media/import";
import { ProgressBar } from "../ui/Progress";

// S02 in this PWA: iOS shows its own photo picker, so our screen is the
// import that follows it (copying into the app and making thumbnails).
export function ImportOverlay({ progress }: { progress: ImportProgress }) {
  return (
    <div role="dialog" aria-modal aria-label="Importando mídia" className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/70 px-8">
      <div className="flex w-full max-w-xs flex-col gap-3 rounded-lg bg-surface-2 p-5 shadow-pop">
        <p className="text-sm font-semibold">
          Importando {progress.index + 1} de {progress.total}
        </p>
        <ProgressBar value={progress.fraction} label="Importando mídia" />
        <p className="text-xs text-text-muted">Mantenha o app aberto até terminar.</p>
      </div>
    </div>
  );
}
