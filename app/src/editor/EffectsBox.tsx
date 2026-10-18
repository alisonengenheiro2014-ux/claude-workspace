// The preview's effects (S13): a box around the picture (video, overlays)
// that moves, zooms and filters, with flashes, darkening, vignette, light
// leak and cinema bars on top. Updated every frame without re-rendering.
import { useEffect, useRef, type ReactNode } from "react";
import { effectsAt, fxCss, leakCss } from "./effects";
import { vignetteCss } from "./look";
import { useEditor } from "./store";

export function EffectsBox({ width, children }: { width: number; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const black = useRef<HTMLDivElement>(null);
  const vig = useRef<HTMLDivElement>(null);
  const leak = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const set = (el: HTMLElement | null, prop: "transform" | "filter" | "opacity" | "background" | "height", v: string) => {
      if (el && el.style[prop] !== v) el.style[prop] = v;
    };
    const apply = () => {
      const s = useEditor.getState();
      const d = s.draft ?? s.doc;
      const f = d ? effectsAt(d, s.playheadUs) : null;
      const css = fxCss(f, width);
      set(box.current, "transform", css.transform);
      set(box.current, "filter", css.filter);
      set(flash.current, "opacity", f?.flash ? String(Math.min(1, f.flash)) : "0");
      set(black.current, "opacity", f?.black ? String(Math.min(1, f.black)) : "0");
      set(vig.current, "background", f?.vignette ? vignetteCss(f.vignette) : "");
      set(leak.current, "background", f?.leak ? leakCss(f.leak) : "");
      const bars = f?.bars ? `${f.bars * 100}%` : "0%";
      set(top.current, "height", bars);
      set(bottom.current, "height", bars);
    };
    apply();
    return useEditor.subscribe(apply);
  }, [width]);

  return (
    <>
      <div ref={box} className="pointer-events-none absolute inset-0">
        {children}
      </div>
      <div aria-hidden className="pointer-events-none absolute inset-0 z-[3]">
        <div ref={leak} className="absolute inset-0" />
        <div ref={vig} className="absolute inset-0" />
        <div ref={flash} className="absolute inset-0 bg-white" style={{ opacity: 0 }} />
        <div ref={black} className="absolute inset-0 bg-black" style={{ opacity: 0 }} />
        <div ref={top} className="absolute inset-x-0 top-0 bg-black" style={{ height: 0 }} />
        <div ref={bottom} className="absolute inset-x-0 bottom-0 bg-black" style={{ height: 0 }} />
      </div>
    </>
  );
}
