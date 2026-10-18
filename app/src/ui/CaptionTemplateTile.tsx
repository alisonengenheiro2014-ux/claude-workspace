// A caption template playing a short sample, drawn with the same code as the
// video. Tiles share one animation clock and only animate while on screen.
import { useEffect, useRef } from "react";
import type { CaptionClip } from "../data/db";
import type { CaptionPreset } from "../editor/presets";
import { captionDrawable, drawText, loadFonts } from "../editor/text";
import { groupWords, type SpeechWord } from "../editor/timeline";

const SAMPLE = "Sua legenda fica assim";
const WORD_US = 420_000;
const CYCLE_US = SAMPLE.split(" ").length * WORD_US + 700_000;

const WORDS: SpeechWord[] = SAMPLE.split(" ").map((word, i) => ({
  word,
  start: (i * WORD_US) / 1e6,
  end: ((i + 1) * WORD_US - 60_000) / 1e6,
}));

// the captions a template makes from the sample words
function sampleCaptions(p: CaptionPreset): CaptionClip[] {
  return groupWords(WORDS, p.group, p.maxWords).map((g, i, all) => {
    const startUs = Math.round(g[0].start * 1e6);
    const next = all[i + 1];
    const endUs = next ? Math.round(next[0].start * 1e6) : CYCLE_US; // no blank gap before it loops
    return {
      id: `s${i}`,
      type: "caption",
      text: g.map((w) => w.word).join(" "),
      words: g.map((w) => ({ startUs: Math.round(w.start * 1e6) - startUs, endUs: Math.round(w.end * 1e6) - startUs, word: w.word })),
      startUs,
      durationUs: endUs - startUs,
      transform: { x: 0.5, y: 0.5, scale: 1, rotation: p.rotation ?? 0 },
      opacity: 1,
      blendMode: "normal",
      animation: { in: p.anim, out: null, loop: null },
      keyframes: [],
    };
  });
}

// one requestAnimationFrame loop for every visible tile, ~24 fps
const subscribers = new Set<(us: number) => void>();
let raf = 0;
let last = 0;
function tick(now: number) {
  raf = subscribers.size ? requestAnimationFrame(tick) : 0;
  if (now - last < 40) return;
  last = now;
  const us = (now * 1000) % CYCLE_US;
  for (const f of subscribers) f(us);
}
function subscribe(f: (us: number) => void) {
  subscribers.add(f);
  if (!raf) raf = requestAnimationFrame(tick);
  return () => void subscribers.delete(f);
}

const still = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function CaptionTemplateTile({ preset, size = 300 }: { preset: CaptionPreset; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const caps = sampleCaptions(preset);
    let fit = 1;
    const measure = () => {
      let widest = 1;
      for (const cap of caps) {
        const box = drawText(ctx, { ...captionDrawable(cap, preset.style, preset.id, 0), transform: { ...cap.transform } }, size, size, 0, false);
        if (box) widest = Math.max(widest, box.w);
      }
      fit = Math.min(2.4, (size * 0.84) / widest);
    };
    const draw = (us: number) => {
      ctx.clearRect(0, 0, size, size);
      const cap = caps.find((x) => us >= x.startUs && us < x.startUs + x.durationUs);
      if (!cap) return;
      const local = us - cap.startUs;
      const item = captionDrawable({ ...cap, transform: { ...cap.transform, scale: fit } }, preset.style, preset.id, local);
      drawText(ctx, item, size, size, local, true);
    };
    let stop: (() => void) | null = null;
    let visible = false;
    const sync = () => {
      stop?.();
      stop = visible && !still ? subscribe(draw) : null;
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      sync();
    });
    const ready = () => {
      measure();
      draw(WORD_US * 1.5); // a frame with the second word spoken
    };
    ready();
    void loadFonts().then(ready);
    io.observe(c);
    return () => {
      io.disconnect();
      stop?.();
    };
  }, [preset, size]);
  return <canvas ref={ref} width={size} height={size} aria-hidden className="size-full" />;
}
