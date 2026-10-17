import {
  ArrowLeftRight,
  AudioLines,
  Blend,
  ChevronLeft,
  Copy,
  Crop,
  Film,
  Gauge,
  Layers,
  Palette,
  Plus,
  RectangleHorizontal,
  Scissors,
  SlidersHorizontal,
  Smile,
  Sparkles,
  Trash2,
  Type,
  Volume2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import tokens from "../../../replica/design/tokens.json";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DraftCard } from "../ui/DraftCard";
import { IconButton } from "../ui/IconButton";
import { KeyframeButton } from "../ui/KeyframeButton";
import { MediaTile } from "../ui/MediaTile";
import { OptionGrid } from "../ui/OptionGrid";
import { ProgressBar, ProgressRing } from "../ui/Progress";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";
import { Tabs } from "../ui/Tabs";
import { AddClipButton, Playhead, TimelineClip, TransitionMarker } from "../ui/Timeline";
import { useToast } from "../ui/Toast";
import { Toolbar, ToolbarItem } from "../ui/Toolbar";
import { TopBar } from "../ui/TopBar";
import { Transport } from "../ui/Transport";

// Every primitive in every state, in isolation. This page is the design
// system check: screenshot it after any token change.

function Section({ title, ids, children }: { title: string; ids?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-b border-border px-4 py-6">
      <h2 className="text-lg">
        {title}
        {ids && <span className="ml-2 font-mono text-xs text-text-subtle">{ids}</span>}
      </h2>
      {children}
    </section>
  );
}

// Tailwind only sees whole class names, so the type scale is listed here.
const typeClass: Record<string, string> = {
  "2xs": "text-2xs",
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
};
const swatch = (c: string) => <span className="size-full" style={{ background: c }} />;
const wave = Array.from({ length: 40 }, (_, i) => 0.3 + 0.6 * Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.23)));
const thumbs = (
  <>
    {Array.from({ length: 6 }, (_, i) => (
      <span key={i} className="h-full flex-1 border-r border-bg/40" style={{ background: `hsl(${210 + i * 8} 25% ${22 + (i % 3) * 6}%)` }} />
    ))}
  </>
);

export function DesignPage() {
  const toast = useToast();
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>("c2");
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(100);
  const [brightness, setBrightness] = useState(0);
  const [filter, setFilter] = useState<string | null>("f2");
  const [tab, setTab] = useState("style");
  const [picked, setPicked] = useState<string[]>(["m2", "m5"]);
  const [kf, setKf] = useState(false);

  const filters = ["Claro", "Quente", "Frio", "P&B", "Filme", "Vívido", "Suave"].map((label, i) => ({
    id: `f${i + 1}`,
    label,
    preview: swatch(`hsl(${i * 47} 35% 40%)`),
  }));

  return (
    <div className="pt-safe pb-safe mx-auto max-w-[440px] bg-bg">
      <header className="px-4 pb-2 pt-6">
        <h1 className="text-xl">Design system</h1>
        <p className="mt-1 text-sm text-text-muted">
          Componentes base do editor, em todos os estados. Valores ainda não medidos do original; accent provisório.
        </p>
      </header>

      <Section title="Cores (papéis)">
        <div className="grid grid-cols-4 gap-2">
          {Object.entries(tokens.color).map(([name, value]) => (
            <div key={name} className="flex flex-col gap-1">
              <span className="h-10 rounded-sm border border-border" style={{ background: value }} />
              <span className="truncate text-2xs text-text-muted">{name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Tipografia">
        {Object.entries(tokens.type)
          .reverse()
          .map(([name, t]) => (
            <p key={name} className={typeClass[name]}>
              <span className="mr-2 font-mono text-2xs text-text-subtle">{name} {t.size}/{t.line}</span>
              Cortar, montar, exportar
            </p>
          ))}
      </Section>

      <Section title="Button">
        <div className="flex flex-wrap gap-2">
          <Button variant="primary">Exportar</Button>
          <Button variant="secondary">Substituir</Button>
          <Button variant="ghost">Cancelar</Button>
          <Button variant="danger" icon={<Trash2 className="size-4" />}>
            Excluir
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm">sm</Button>
          <Button variant="primary" size="md">md</Button>
          <Button variant="primary" size="lg">lg</Button>
          <Button variant="primary" loading>Salvando</Button>
          <Button variant="primary" disabled>Desativado</Button>
        </div>
      </Section>

      <Section title="IconButton e KeyframeButton">
        <div className="flex items-center gap-1">
          <IconButton label="Voltar" icon={<ChevronLeft className="size-6" />} />
          <IconButton label="Duplicar" icon={<Copy className="size-5" />} />
          <IconButton label="Volume" icon={<Volume2 className="size-5" />} pressed />
          <IconButton label="Excluir" icon={<Trash2 className="size-5" />} disabled />
          <KeyframeButton active={kf} onToggle={() => setKf(!kf)} />
          <KeyframeButton active={false} disabled />
        </div>
      </Section>

      <Section title="Editor: barra, transporte, linha do tempo, ferramentas" ids="S03 S04">
        <div className="-mx-4 overflow-hidden border-y border-border">
          <TopBar resolution="1080p" />
          <div className="flex aspect-[9/12] items-center justify-center bg-canvas">
            <div className="flex aspect-[9/16] h-[90%] items-center justify-center bg-surface-2 text-xs text-text-subtle">
              prévia 9:16
            </div>
          </div>
          <Transport
            playing={playing}
            currentUs={12_400_000}
            durationUs={47_000_000}
            canUndo
            canRedo={false}
            onPlay={() => setPlaying(!playing)}
          />
          <div className="relative flex h-[var(--layout-timeline)] flex-col justify-center gap-1.5 overflow-hidden bg-bg">
            <Playhead />
            <div className="flex items-center gap-0.5 pl-24">
              <TimelineClip kind="text" width={120} label="Título" selected={selected === "t1"} onSelect={() => setSelected("t1")} />
            </div>
            <div className="flex items-center gap-0.5 pl-36">
              <TimelineClip kind="overlay" width={90} label="Logo" keyframes={[0.2, 0.7]} />
            </div>
            <div className="flex items-center pl-8">
              <TimelineClip kind="main" width={110} thumbs={thumbs} selected={selected === "c1"} onSelect={() => setSelected("c1")} />
              <TransitionMarker />
              <TimelineClip
                kind="main"
                width={140}
                thumbs={thumbs}
                keyframes={[0.35]}
                selected={selected === "c2"}
                onSelect={() => setSelected("c2")}
              />
              <TransitionMarker active />
              <TimelineClip kind="main" width={80} missing />
              <AddClipButton />
            </div>
            <div className="flex items-center pl-8">
              <TimelineClip kind="audio" width={300} label="Trilha.m4a" waveform={wave} selected={selected === "a1"} onSelect={() => setSelected("a1")} />
            </div>
            <div className="flex items-center gap-0.5 pl-16">
              <TimelineClip kind="caption" width={70} label="Oi, gente" />
              <TimelineClip kind="caption" width={90} label="hoje eu vou" />
              <TimelineClip kind="effect" width={60} label="Brilho" />
            </div>
          </div>
          <Toolbar label="Ferramentas">
            <ToolbarItem icon={<Scissors />} label="Editar" />
            <ToolbarItem icon={<AudioLines />} label="Áudio" />
            <ToolbarItem icon={<Type />} label="Texto" />
            <ToolbarItem icon={<Smile />} label="Stickers" />
            <ToolbarItem icon={<Layers />} label="Sobrepor" />
            <ToolbarItem icon={<Sparkles />} label="Efeitos" />
            <ToolbarItem icon={<Palette />} label="Filtros" />
            <ToolbarItem icon={<SlidersHorizontal />} label="Ajustar" />
            <ToolbarItem icon={<RectangleHorizontal />} label="Formato" />
          </Toolbar>
          <Toolbar
            label="Ferramentas do clipe"
            leading={<IconButton label="Voltar" icon={<ChevronLeft className="size-6" />} onClick={() => setSelected(null)} />}
          >
            <ToolbarItem icon={<Scissors />} label="Dividir" disabled={!selected} />
            <ToolbarItem icon={<Gauge />} label="Velocidade" active onClick={() => setSheet(true)} disabled={!selected} />
            <ToolbarItem icon={<Volume2 />} label="Volume" disabled={!selected} />
            <ToolbarItem icon={<Crop />} label="Recortar" disabled={!selected} />
            <ToolbarItem icon={<Blend />} label="Mistura" disabled={!selected} />
            <ToolbarItem icon={<ArrowLeftRight />} label="Inverter" disabled={!selected} />
            <ToolbarItem icon={<Copy />} label="Duplicar" disabled={!selected} />
            <ToolbarItem icon={<Trash2 />} label="Excluir" disabled={!selected} />
          </Toolbar>
        </div>
        <p className="text-xs text-text-muted">Toque num clipe para selecionar. "Velocidade" abre a folha inferior.</p>
      </Section>

      <Section title="Slider" ids="S05 S08 S14">
        <Slider label="Velocidade" value={speed} onChange={setSpeed} min={0.1} max={10} step={0.1} defaultValue={1} format={(v) => `${v.toFixed(1)}x`} />
        <Slider label="Volume" value={volume} onChange={setVolume} min={0} max={200} defaultValue={100} format={(v) => `${v}%`} />
        <Slider label="Brilho" value={brightness} onChange={setBrightness} min={-50} max={50} defaultValue={0} />
        <Slider label="Desativado" value={30} onChange={() => {}} disabled />
      </Section>

      <Section title="Tabs e OptionGrid" ids="S06 S09 S13 S14">
        <Tabs
          label="Texto"
          value={tab}
          onValueChange={setTab}
          tabs={[
            { value: "style", label: "Estilo", content: <OptionGrid label="Filtros" options={filters} value={filter} onChange={setFilter} /> },
            { value: "effects", label: "Efeitos", content: <OptionGrid label="Efeitos" options={[]} value={null} onChange={() => {}} loading /> },
            { value: "anim", label: "Animação", content: <p className="text-sm text-text-muted">Sem animações ainda.</p> },
          ]}
        />
      </Section>

      <Section title="MediaTile" ids="S02">
        <div className="-mx-4 grid grid-cols-4 gap-0.5">
          {Array.from({ length: 8 }, (_, i) => {
            const id = `m${i + 1}`;
            const order = picked.indexOf(id);
            return (
              <MediaTile
                key={id}
                name={`Vídeo ${i + 1}`}
                durationUs={(i + 2) * 7_300_000}
                order={order === -1 ? undefined : order + 1}
                onToggle={() => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))}
              />
            );
          })}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-text-muted">{picked.length} selecionados</span>
          <Button variant="primary" disabled={picked.length === 0}>
            Adicionar
          </Button>
        </div>
      </Section>

      <Section title="DraftCard e estado vazio" ids="S01">
        <Button variant="primary" size="lg" icon={<Plus className="size-5" />} className="w-full">
          Novo projeto
        </Button>
        <DraftCard name="Reels cliente padaria" durationUs={47_000_000} updatedAt={Date.UTC(2026, 9, 16)} />
        <DraftCard name="Casamento Ana e Leo — teaser com um nome bem longo" durationUs={182_000_000} updatedAt={Date.UTC(2026, 9, 2)} />
        <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center">
          <Film aria-hidden className="size-8 text-text-subtle" />
          <p className="text-sm">Nenhum projeto ainda</p>
          <p className="text-xs text-text-muted">Toque em Novo projeto e escolha vídeos do seu iPhone.</p>
        </div>
      </Section>

      <Section title="Progresso" ids="S10 S17">
        <ProgressBar value={0.42} label="Gerando legendas" />
        <ProgressBar value={0.8} label="Exportação falhou" error />
        <div className="flex justify-center">
          <ProgressRing value={0.67} label="Exportando" />
        </div>
      </Section>

      <Section title="Toast, folha e diálogo">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => toast("Projeto salvo")}>Toast info</Button>
          <Button onClick={() => toast("Sem espaço no iPhone para exportar", "error")}>Toast erro</Button>
          <Button onClick={() => setSheet(true)}>Abrir folha</Button>
          <Button variant="danger" onClick={() => setConfirm(true)}>
            Excluir projeto
          </Button>
        </div>
      </Section>

      <Sheet open={sheet} onOpenChange={setSheet} title="Velocidade">
        <Slider label="Velocidade" value={speed} onChange={setSpeed} min={0.1} max={10} step={0.1} defaultValue={1} format={(v) => `${v.toFixed(1)}x`} />
      </Sheet>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Excluir projeto?"
        description="O projeto e as mídias importadas para ele saem deste iPhone. Não dá para desfazer."
        confirmLabel="Excluir"
        danger
        onConfirm={() => toast("Projeto excluído")}
      />
    </div>
  );
}
