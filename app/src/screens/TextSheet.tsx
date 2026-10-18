// S09 Texto: the words, the style and the animation of one text item. Every
// change shows live on the preview as a draft; closing the sheet makes it one
// undo step.
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Id, TextClip, TextStyle } from "../data/db";
import { useEditor } from "../editor/store";
import { ANIM_US, ANIMS_IN, ANIMS_OUT, FONTS, TEXT_COLORS } from "../editor/text";
import { findItem, setText } from "../editor/timeline";
import { cn } from "../ui/cn";
import { OptionGrid } from "../ui/OptionGrid";
import { Sheet } from "../ui/Sheet";
import { Slider } from "../ui/Slider";
import { Tabs } from "../ui/Tabs";

export type TextTab = "text" | "style" | "anim";

function Swatches({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="no-scrollbar flex gap-2 overflow-x-auto py-1">
      {TEXT_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={`${label} ${c}`}
          onClick={() => onChange(c)}
          className={cn("size-9 shrink-0 rounded-pill border border-border-input", value === c && "ring-2 ring-accent ring-offset-2 ring-offset-surface")}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

function Toggle({ label, on, onChange, children }: { label: string; on: boolean; onChange: (on: boolean) => void; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex h-11 items-center justify-between text-sm">
        {label}
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-5 accent-[var(--color-accent)]" />
      </label>
      {on && children}
    </div>
  );
}

export function TextSheet({ id, tab, onTab, onClose }: { id: Id | null; tab: TextTab; onTab: (t: TextTab) => void; onClose: () => void }) {
  const doc = useEditor((s) => s.draft ?? s.doc);
  const hit = id && doc ? findItem(doc, id) : null;
  const clip = hit?.clip.type === "text" ? hit.clip : null;

  // apply a change on top of what is already in the draft
  function patch(p: Partial<TextClip>) {
    const s = useEditor.getState();
    const cur = s.draft ?? s.doc;
    const c = id && cur ? findItem(cur, id)?.clip : null;
    if (!s.doc || !c || c.type !== "text") return;
    s.setDraft(setText(s.doc, c.id, { ...c, ...p }));
  }
  const style = (p: Partial<TextStyle>) => clip && patch({ style: { ...clip.style, ...p } });

  return (
    <Sheet open={!!clip} onOpenChange={(o) => !o && onClose()} title="Texto">
      {clip && (
        <Tabs
          label="Texto"
          value={tab}
          onValueChange={(v) => onTab(v as TextTab)}
          tabs={[
            {
              value: "text",
              label: "Texto",
              content: (
                <textarea
                  aria-label="Texto"
                  value={clip.text}
                  autoFocus
                  rows={3}
                  maxLength={300}
                  onChange={(e) => patch({ text: e.target.value })}
                  className="w-full resize-none rounded-md border border-border-input bg-surface-2 p-3 text-base text-text"
                />
              ),
            },
            {
              value: "style",
              label: "Estilo",
              content: (
                <div className="flex flex-col gap-4">
                  <OptionGrid
                    label="Fonte"
                    value={clip.style.font}
                    onChange={(f) => f && style({ font: f })}
                    options={FONTS.map((f) => ({
                      id: f.id,
                      label: f.label,
                      preview: (
                        <span className="text-xl text-text" style={{ fontFamily: `"${f.family}"`, fontWeight: f.weight }}>
                          Aa
                        </span>
                      ),
                    }))}
                  />
                  <Slider label="Tamanho" value={clip.style.size} min={16} max={240} defaultValue={72} onChange={(v) => style({ size: v })} />
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-text-muted">Cor</span>
                    <Swatches label="Cor" value={clip.style.color} onChange={(c) => style({ color: c })} />
                  </div>
                  <div role="radiogroup" aria-label="Alinhamento" className="flex gap-2">
                    {(["left", "center", "right"] as const).map((a) => {
                      const Icon = a === "left" ? AlignLeft : a === "center" ? AlignCenter : AlignRight;
                      return (
                        <button
                          key={a}
                          type="button"
                          role="radio"
                          aria-checked={clip.style.align === a}
                          aria-label={a === "left" ? "Alinhar à esquerda" : a === "center" ? "Centralizar" : "Alinhar à direita"}
                          onClick={() => style({ align: a })}
                          className={cn("flex size-11 items-center justify-center rounded-md border", clip.style.align === a ? "border-accent text-accent" : "border-border-input")}
                        >
                          <Icon aria-hidden className="size-5" />
                        </button>
                      );
                    })}
                  </div>
                  <Toggle
                    label="Contorno"
                    on={!!clip.style.stroke}
                    onChange={(on) => style({ stroke: on ? { color: "#000000", width: 8 } : null })}
                  >
                    {clip.style.stroke && (
                      <>
                        <Swatches label="Cor do contorno" value={clip.style.stroke.color} onChange={(c) => style({ stroke: { ...clip.style.stroke!, color: c } })} />
                        <Slider label="Espessura" value={clip.style.stroke.width} min={1} max={30} defaultValue={8} onChange={(v) => style({ stroke: { ...clip.style.stroke!, width: v } })} />
                      </>
                    )}
                  </Toggle>
                  <Toggle
                    label="Fundo"
                    on={!!clip.style.background}
                    onChange={(on) => style({ background: on ? { color: "#000000", radius: 16, padding: 24 } : null })}
                  >
                    {clip.style.background && (
                      <Swatches
                        label="Cor do fundo"
                        value={clip.style.background.color}
                        onChange={(c) => style({ background: { ...clip.style.background!, color: c } })}
                      />
                    )}
                  </Toggle>
                  <Toggle
                    label="Sombra"
                    on={!!clip.style.shadow}
                    onChange={(on) => style({ shadow: on ? { color: "#000000", blur: 12, x: 0, y: 4 } : null })}
                  />
                  <Slider label="Opacidade" value={Math.round(clip.opacity * 100)} min={0} max={100} defaultValue={100} format={(v) => `${v}%`} onChange={(v) => patch({ opacity: v / 100 })} />
                </div>
              ),
            },
            {
              value: "anim",
              label: "Animação",
              content: (
                <div className="flex flex-col gap-4">
                  <span className="text-xs text-text-muted">Entrada</span>
                  <OptionGrid
                    label="Animação de entrada"
                    value={clip.animation.in?.id ?? null}
                    onChange={(a) => patch({ animation: { ...clip.animation, in: a ? { id: a, durationUs: ANIM_US } : null } })}
                    options={ANIMS_IN.map((a) => ({ id: a.id, label: a.label, preview: <span className="text-xs text-text-muted">{a.label}</span> }))}
                  />
                  <span className="text-xs text-text-muted">Saída</span>
                  <OptionGrid
                    label="Animação de saída"
                    value={clip.animation.out?.id ?? null}
                    onChange={(a) => patch({ animation: { ...clip.animation, out: a ? { id: a, durationUs: ANIM_US } : null } })}
                    options={ANIMS_OUT.map((a) => ({ id: a.id, label: a.label, preview: <span className="text-xs text-text-muted">{a.label}</span> }))}
                  />
                </div>
              ),
            },
          ]}
        />
      )}
    </Sheet>
  );
}
