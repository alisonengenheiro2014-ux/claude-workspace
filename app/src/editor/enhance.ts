// Aprimorar: one tap that looks at the picture (its light, range, colour)
// and sets the Ajustar sliders a photo editor would: exposure towards a
// middle grey, contrast to fill the range, shadows lifted, highlights held,
// a little colour, a colour cast evened out, a touch of sharpness. The
// sliders stay editable afterwards.
import type { Adjust } from "../data/db";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

export function autoAdjust(px: Uint8ClampedArray): Adjust {
  const n = px.length / 4;
  const hist = new Array<number>(256).fill(0);
  let r = 0;
  let g = 0;
  let b = 0;
  let sat = 0;
  for (let i = 0; i < px.length; i += 4) {
    const R = px[i];
    const G = px[i + 1];
    const B = px[i + 2];
    r += R;
    g += G;
    b += B;
    hist[Math.round(0.2126 * R + 0.7152 * G + 0.0722 * B)]++;
    const max = Math.max(R, G, B);
    const min = Math.min(R, G, B);
    sat += max ? (max - min) / max : 0;
  }
  const pct = (p: number) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= p * n) return v / 255;
    return 1;
  };
  let mean = 0;
  for (let v = 0; v < 256; v++) mean += (v / 255) * hist[v];
  mean /= n;
  const lo = pct(0.02);
  const hi = pct(0.98);
  const p10 = pct(0.1);
  const p95 = pct(0.95);
  sat /= n;
  const cast = (b - r) / n / 255; // blue over red: cool, so warm it a little

  return {
    exposure: clamp((0.47 - mean) * 70, -20, 20),
    brightness: 0,
    contrast: clamp((0.85 - (hi - lo)) * 50, 0, 20),
    shadows: clamp((0.14 - p10) * 120, 0, 25),
    highlights: -clamp((p95 - 0.9) * 250, 0, 25),
    saturation: clamp(sat < 0.3 ? (0.38 - sat) * 80 : 6, 0, 18),
    temperature: clamp(cast * 60, -12, 12),
    tint: 0,
    sharpen: 15,
    vignette: 0,
  };
}
