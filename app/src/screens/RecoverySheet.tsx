import { useState } from "react";
import { ArchiveRestore, Download, FolderSearch, Share2 } from "lucide-react";
import { scanRecoveryFiles, type RecoveryFile } from "../media/recoveryScan";
import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";

function mb(n: number) {
  return n >= 1e9 ? (n / 1e9).toFixed(2) + " GB" : (n / 1e6).toFixed(1) + " MB";
}
function nativeFile(item: RecoveryFile) {
  const type = item.mime && item.mime !== "application/octet-stream" ? item.mime : item.file.type || "application/octet-stream";
  const extension = type.includes("webm") ? "webm" : type.includes("mp4") ? "mp4" : "bin";
  const suffix = item.name.split(".").pop()?.toLowerCase();
  const name = /^(mp4|mov|m4v|webm)$/i.test(suffix ?? "")
    ? item.name
    : "Resgate_" + item.path.split("/").pop() + "." + extension;
  return new File([item.file], name, { type });
}

export function RecoverySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (value: boolean) => void }) {
  const [files, setFiles] = useState<RecoveryFile[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  async function scan() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const found = await scanRecoveryFiles();
      setFiles(found);
      if (!found.length) setInfo("Nenhum arquivo encontrado nas pastas de mídia do PWA. Isso não comprova que outros dados foram perdidos.");
    } catch (e) {
      setError("Não foi possível examinar o armazenamento: " + (e instanceof Error ? e.message : String(e)));
    } finally { setBusy(false); }
  }
  function share(item: RecoveryFile) {
    setError(null);
    setInfo(null);
    const file = nativeFile(item);
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (!nav.share || !nav.canShare?.({ files: [file] })) {
      setError("O iOS não permite compartilhar diretamente este arquivo. Use Baixar arquivo.");
      return;
    }
    void nav.share({ files: [file], title: file.name })
      .then(() => setInfo("Confira se o arquivo chegou ao app Arquivos. O compartilhamento não comprova que ele foi salvo."))
      .catch((e: unknown) => setError("Não foi possível compartilhar: " + (e instanceof Error ? e.message : String(e))));
  }
  function download(item: RecoveryFile) {
    const file = nativeFile(item);
    const href = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = href;
    a.download = file.name;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(href), 180_000);
    setInfo("Confira no app Arquivos se o arquivo realmente foi baixado antes de apagar qualquer projeto.");
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Resgatar arquivos locais">
      <div className="flex flex-col gap-3 pb-8">
        <p className="text-sm text-text">
          Verificação somente de leitura. Procura vídeos ainda armazenados no iPhone,
          inclusive arquivos de projetos que aparecem com 00:00.
          <strong> Nenhum arquivo será apagado ou enviado à VPS.</strong>
        </p>
        <p className="rounded-md border border-[#fbbf24]/50 p-3 text-xs text-text">
          Antes de fazer limpeza, tente salvar cada original separadamente.
          “Arquivo completo” significa apenas que o número de bytes corresponde ao registro;
          a reprodução ainda precisa ser conferida.
        </p>
        <Button icon={<FolderSearch className="size-5" />} loading={busy} onClick={() => void scan()}>
          Procurar arquivos no iPhone
        </Button>
        {error && <p role="alert" className="rounded-md border border-danger p-2 text-sm text-danger">{error}</p>}
        {info && <p role="status" className="rounded-md border border-border p-2 text-xs">{info}</p>}
        {files && files.length > 0 && (
          <>
            <p className="text-sm font-semibold">
              {files.length} arquivo(s) encontrados · {mb(files.reduce((total, f) => total + f.size, 0))}
            </p>
            {files.map((item) => (
              <div key={item.path} className="rounded-md border border-border bg-surface-2 p-3">
                <p className="break-words text-sm font-semibold">{item.name}</p>
                <p className="mt-1 text-xs text-text-muted">{item.project}</p>
                <p className="mt-1 break-all text-xs text-text-subtle">{item.path}</p>
                <p className="mt-1 text-xs">
                  {mb(item.size)} · {
                    item.status === "complete"
                      ? "Tamanho confere com o original cadastrado"
                      : item.status === "partial"
                      ? "Tamanho diferente — possível arquivo parcial"
                      : "Sem cadastro — integridade desconhecida"
                  }
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Button variant="secondary" icon={<Share2 className="size-4" />} onClick={() => share(item)}>
                    Compartilhar
                  </Button>
                  <Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download(item)}>
                    Baixar arquivo
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
        <p className="flex items-center gap-2 text-xs text-text-muted"><ArchiveRestore className="size-4" />
          Se encontrar um arquivo, salve e teste a reprodução fora do PWA antes de excluir algo.
        </p>
      </div>
    </Sheet>
  );
}
