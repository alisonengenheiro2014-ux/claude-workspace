import { useEffect, useRef } from "react";
import type { TextClip, TextStyle } from "../data/db";
import { drawText, loadFonts } from "../editor/text";

// A small sample of a text style, drawn with the same code as the video.
export function StylePreview({ style, sample }: { style: TextStyle; sample: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#3a3a42";
      ctx.fillRect(0, 0, c.width, c.height);
      const clip: TextClip = {
        id: "preview",
        type: "text",
        text: sample,
        style: { ...style, size: Math.min(style.size, 90) },
        startUs: 0,
        durationUs: 1,
        transform: { x: 0.5, y: 0.5, scale: 1, rotation: 0 },
        opacity: 1,
        blendMode: "normal",
        animation: { in: null, out: null, loop: null },
        keyframes: [],
      };
      // measure first, then size the sample to fill most of the tile
      const box = drawText(ctx, clip, c.width, c.height, 0, false);
      if (box) {
        clip.transform.scale = Math.min(3, (c.width * 0.86) / box.w);
        ctx.fillRect(0, 0, c.width, c.height);
        drawText(ctx, clip, c.width, c.height, 0, false);
      }
    };
    draw();
    void loadFonts().then(draw);
  }, [style, sample]);
  return <canvas ref={ref} width={360} height={360} aria-hidden className="size-full" />;
}
