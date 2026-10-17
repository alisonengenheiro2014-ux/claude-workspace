import type { ImportProgress } from "./importFlow";

// Shown only while the picked files' metadata is read (well under a second
// per file). Copying happens later, in the background, while you edit.
export function ImportOverlay({ progress }: { progress: ImportProgress }) {
  return (
    <div role="dialog" aria-modal aria-label="Abrindo mídia" className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/70 px-8">
      <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-5 py-4 shadow-pop">
        <span aria-hidden className="size-5 animate-spin rounded-pill border-2 border-surface-3 border-t-accent" />
        <p className="text-sm">{progress.total > 1 ? `Abrindo ${progress.total} arquivos…` : "Abrindo vídeo…"}</p>
      </div>
    </div>
  );
}
