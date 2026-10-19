// S01 Início: new project and the drafts list.
import { Archive, ArchiveRestore, Copy, Film, ImageIcon, LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { FilePicker } from "../app/FilePicker";
import { ImportOverlay } from "../app/ImportOverlay";
import { markImport, runImport } from "../app/importFlow";
import { navigate } from "../app/router";
import { applyUpdate, useUpdateReady } from "../app/updates";
import type { Id, ProjectRow } from "../data/db";
import { requestPersistence, storageInfo } from "../data/opfs";
import {
  createProject,
  duplicateProject,
  listProjects,
  loadProject,
  removeProject,
  renameProject,
  saveDoc,
  thumbsFor,
} from "../data/projects";
import { insertMedia } from "../editor/timeline";
import type { ImportProgress } from "../app/importFlow";
import { importsInProgress } from "../media/import";
import { makeBackup, restoreBackup, shareFile } from "../data/backup";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DraftCard } from "../ui/DraftCard";
import { Sheet } from "../ui/Sheet";
import { TextField } from "../ui/TextField";
import { useToast } from "../ui/Toast";

function formatBytes(n: number) {
  if (n < 1e6) return `${Math.round(n / 1e3)} KB`;
  if (n < 1e9) return `${(n / 1e6).toFixed(0)} MB`;
  return `${(n / 1e9).toFixed(1)} GB`;
}

export function Home() {
  const toast = useToast();
  const picker = useRef<HTMLInputElement>(null);
  const photoPicker = useRef<HTMLInputElement>(null);
  const updateReady = useUpdateReady();
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [thumbs, setThumbs] = useState<Map<Id, string>>(new Map());
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [importing, setImporting] = useState<ImportProgress | null>(null);
  const [menuFor, setMenuFor] = useState<ProjectRow | null>(null);
  const [renaming, setRenaming] = useState<ProjectRow | null>(null);
  const [newName, setNewName] = useState("");
  const [deleting, setDeleting] = useState<ProjectRow | null>(null);
  const backupPicker = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await listProjects();
      setProjects(list);
      const keys = list.map((p) => p.thumbAssetKey).filter((k): k is string => !!k);
      const rows = await thumbsFor(keys);
      setThumbs((old) => {
        old.forEach((u) => URL.revokeObjectURL(u));
        return new Map(rows.filter((r) => r.blobs?.length).map((r) => [r.assetId, URL.createObjectURL(r.blobs![0])]));
      });
      setStorage(await storageInfo());
    } catch (err) {
      console.error(err);
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void requestPersistence();
  }, [refresh]);

  async function onFiles(files: File[]) {
    const startedAt = performance.now();
    const project = await createProject();
    const assets = await runImport(project.id, files, setImporting, toast);
    if (!assets.length) {
      await removeProject(project.id);
      return;
    }
    const loaded = await loadProject(project.id);
    if (loaded) await saveDoc(project.id, insertMedia(loaded.doc, assets, 0).doc);
    markImport(project.id, startedAt);
    navigate(`/p/${project.id}`);
  }

  // Editar foto: a photo project with the one picture, then its editor
  async function onPhoto(files: File[]) {
    const project = await createProject({ photo: true });
    const assets = await runImport(project.id, files.slice(0, 1), setImporting, toast);
    if (assets[0]?.kind !== "image") {
      await removeProject(project.id);
      if (assets.length) toast("Escolha uma foto.");
      return;
    }
    const loaded = await loadProject(project.id);
    if (loaded) await saveDoc(project.id, insertMedia(loaded.doc, assets, 0).doc);
    navigate(`/p/${project.id}`);
  }

  async function onDuplicate(p: ProjectRow) {
    setMenuFor(null);
    if (importsInProgress()) return toast("Espere terminar de guardar os vídeos para duplicar.");
    await duplicateProject(p.id);
    toast("Projeto duplicado");
    await refresh();
  }

  async function onBackup(p: ProjectRow) {
    setMenuFor(null);
    if (importsInProgress()) return toast("Espere terminar de guardar os vídeos para fazer o backup.");
    setWorking("Preparando o backup…");
    try {
      await shareFile(await makeBackup(p.id));
    } catch (err) {
      toast(`Não foi possível fazer o backup: ${err instanceof Error ? err.message : err}`, "error");
    } finally {
      setWorking(null);
    }
  }

  async function onRestore(file: File | undefined) {
    if (!file) return;
    setWorking("Abrindo o backup…");
    try {
      const id = await restoreBackup(file);
      navigate(`/p/${id}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setWorking(null);
    }
  }

  // Modelos: a project kept as a starting point; using one makes a copy
  async function onSaveTemplate(p: ProjectRow) {
    setMenuFor(null);
    if (importsInProgress()) return toast("Espere terminar de guardar os vídeos.");
    await duplicateProject(p.id, { template: true, name: `Modelo – ${p.name}` });
    toast("Salvo em Modelos");
    await refresh();
  }
  async function onUseTemplate(p: ProjectRow) {
    const id = await duplicateProject(p.id, { name: p.name.replace(/^Modelo – /, "") });
    if (id) navigate(`/p/${id}`);
  }

  async function onRename() {
    if (!renaming) return;
    await renameProject(renaming.id, newName);
    setRenaming(null);
    await refresh();
  }

  async function onDelete() {
    if (!deleting) return;
    await removeProject(deleting.id);
    setDeleting(null);
    toast("Projeto excluído");
    await refresh();
  }

  return (
    <main className="pt-safe pb-safe mx-auto flex min-h-full max-w-[440px] flex-col bg-bg">
      <header className="px-4 pb-4 pt-6">
        <h1 className="text-xl">Editor</h1>
      </header>

      {updateReady && (
        <div role="status" className="mx-4 mb-4 flex items-center gap-3 rounded-lg bg-surface-2 py-2 pl-4 pr-2">
          <span className="flex-1 text-sm">Nova versão do app</span>
          <Button variant="primary" onClick={applyUpdate}>
            Atualizar
          </Button>
        </div>
      )}

      <div className="px-4">
        {/* like CapCut: a video project, or a photo edited on its own */}
        <div className="grid grid-cols-2 gap-3">
          <button type="button" onClick={() => picker.current?.click()} className="flex h-28 flex-col items-center justify-center gap-2 rounded-lg bg-accent text-on-accent active:brightness-90">
            <Plus aria-hidden className="size-7" />
            <span className="text-base font-semibold">Novo vídeo</span>
          </button>
          <button type="button" onClick={() => photoPicker.current?.click()} className="flex h-28 flex-col items-center justify-center gap-2 rounded-lg bg-surface-2 text-text active:brightness-90">
            <ImageIcon aria-hidden className="size-7" />
            <span className="text-base font-semibold">Editar foto</span>
          </button>
        </div>
        <FilePicker ref={picker} onFiles={(f) => void onFiles(f)} />
        <FilePicker ref={photoPicker} accept="image/*" onFiles={(f) => void onPhoto(f)} />
        <Button variant="ghost" className="mt-2 w-full" icon={<ArchiveRestore aria-hidden className="size-4" />} onClick={() => backupPicker.current?.click()}>
          Abrir backup
        </Button>
        <input
          ref={backupPicker}
          type="file"
          accept=".garagem,application/octet-stream"
          hidden
          onChange={(e) => {
            void onRestore(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <p className="mt-2 text-xs text-text-muted">
          Dica: pela Fototeca, o iPhone converte o vídeo antes de entregar (demora e perde qualidade). Para abrir na hora, salve o
          vídeo em Arquivos e escolha <span className="text-text">Escolher Arquivo</span>.
        </p>
      </div>

      {projects && projects.some((p) => p.template) && (
        <section aria-labelledby="templates" className="mt-6 px-3">
          <h2 id="templates" className="px-1 pb-2 text-sm font-semibold">
            Modelos
          </h2>
          <ul className="flex flex-col gap-1">
            {projects
              .filter((p) => p.template)
              .map((p) => (
                <li key={p.id}>
                  <DraftCard
                    name={p.name}
                    durationUs={p.durationUs}
                  photo={p.photo}
                    updatedAt={p.updatedAt}
                    thumb={p.thumbAssetKey ? thumbs.get(p.thumbAssetKey) : undefined}
                    onOpen={() => void onUseTemplate(p)}
                    onMenu={() => setMenuFor(p)}
                  />
                </li>
              ))}
          </ul>
          <p className="px-1 pt-1 text-xs text-text-muted">Tocar num modelo abre uma cópia; o modelo continua igual.</p>
        </section>
      )}

      <section aria-labelledby="drafts" className="mt-6 flex flex-1 flex-col px-3">
        <div className="flex items-baseline justify-between px-1 pb-2">
          <h2 id="drafts" className="text-sm font-semibold">
            Projetos
          </h2>
          {storage && storage.usage > 0 && (
            <span className="text-xs text-text-subtle">{formatBytes(storage.usage)} usados</span>
          )}
        </div>

        {loadError ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm">Não foi possível abrir seus projetos.</p>
            <Button onClick={() => location.reload()}>Tentar de novo</Button>
          </div>
        ) : projects === null ? (
          <div aria-busy aria-label="Carregando projetos" className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-3 p-1">
                <span className="size-16 animate-pulse rounded-sm bg-surface-2" />
                <span className="h-4 w-40 animate-pulse rounded-xs bg-surface-2" />
              </div>
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="mx-1 flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-10 text-center">
            <Film aria-hidden className="size-8 text-text-subtle" />
            <p className="text-sm">Nenhum projeto ainda</p>
            <p className="text-xs text-text-muted">Toque em Novo vídeo para editar vídeos, ou em Editar foto para uma foto.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {projects.filter((p) => !p.template).map((p) => (
              <li key={p.id}>
                <DraftCard
                  name={p.name}
                  durationUs={p.durationUs}
                  photo={p.photo}
                  updatedAt={p.updatedAt}
                  thumb={p.thumbAssetKey ? thumbs.get(p.thumbAssetKey) : undefined}
                  onOpen={() => navigate(`/p/${p.id}`)}
                  onMenu={() => setMenuFor(p)}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <Sheet open={!!menuFor} onOpenChange={(o) => !o && setMenuFor(null)} title={menuFor?.name ?? ""}>
        <div className="flex flex-col gap-2">
          <Button
            className="justify-start"
            icon={<Pencil aria-hidden className="size-4" />}
            onClick={() => {
              setNewName(menuFor!.name);
              setRenaming(menuFor);
              setMenuFor(null);
            }}
          >
            Renomear
          </Button>
          <Button className="justify-start" icon={<Copy aria-hidden className="size-4" />} onClick={() => void onDuplicate(menuFor!)}>
            Duplicar
          </Button>
          {menuFor?.template ? (
            <Button className="justify-start" icon={<LayoutTemplate aria-hidden className="size-4" />} onClick={() => (setMenuFor(null), void onUseTemplate(menuFor))}>
              Usar modelo
            </Button>
          ) : (
            <Button className="justify-start" icon={<LayoutTemplate aria-hidden className="size-4" />} onClick={() => void onSaveTemplate(menuFor!)}>
              Salvar como modelo
            </Button>
          )}
          <Button className="justify-start" icon={<Archive aria-hidden className="size-4" />} onClick={() => void onBackup(menuFor!)}>
            Salvar backup (arquivo)
          </Button>
          <Button
            variant="danger"
            className="justify-start"
            icon={<Trash2 aria-hidden className="size-4" />}
            onClick={() => {
              setDeleting(menuFor);
              setMenuFor(null);
            }}
          >
            Excluir
          </Button>
        </div>
      </Sheet>

      <Sheet open={!!renaming} onOpenChange={(o) => !o && setRenaming(null)} title="Renomear projeto">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void onRename();
          }}
        >
          <TextField label="Nome" value={newName} maxLength={120} autoFocus onChange={(e) => setNewName(e.target.value)} />
          <Button type="submit" variant="primary">
            Salvar
          </Button>
        </form>
      </Sheet>

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Excluir projeto?"
        description="O projeto e as mídias importadas para ele saem deste iPhone. Os originais no Rolo da Câmera continuam lá."
        confirmLabel="Excluir"
        danger
        onConfirm={() => void onDelete()}
      />

      {working && (
        <div role="dialog" aria-modal aria-label={working} className="fixed inset-0 z-40 flex items-center justify-center bg-scrim/70 px-8">
          <div className="flex items-center gap-3 rounded-lg bg-surface-2 px-5 py-4 shadow-pop">
            <span aria-hidden className="size-5 animate-spin rounded-pill border-2 border-surface-3 border-t-accent" />
            <p className="text-sm">{working}</p>
          </div>
        </div>
      )}
      {importing && <ImportOverlay progress={importing} />}
    </main>
  );
}
