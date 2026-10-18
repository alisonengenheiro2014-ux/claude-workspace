// Chroma key for overlays (S12): makes one colour (a green or blue screen)
// see-through. Done per pixel on a canvas in both preview and export, with
// the same function, so they match.
import type { MediaClip } from "../data/db";

export type Chroma = NonNullable<MediaClip["chroma"]>;

export const KEY_COLORS = [
  { color: "#00b140", label: "Verde" },
  { color: "#00ff00", label: "Verde vivo" },
  { color: "#0047bb", label: "Azul" },
  { color: "#ffffff", label: "Branco" },
  { color: "#000000", label: "Preto" },
];

const hex = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
const cbOf = (r: number, g: number, b: number) => -0.168736 * r - 0.331264 * g + 0.5 * b;
const crOf = (r: number, g: number, b: number) => 0.5 * r - 0.418688 * g - 0.081312 * b;

// Distance from the key colour in the colour plane (ignores brightness, so
// shadows on the screen still go) for black/white keys uses brightness instead.
export function keyImage(img: ImageData, c: Chroma) {
  const [kr, kg, kb] = hex(c.color);
  const kcb = cbOf(kr, kg, kb);
  const kcr = crOf(kr, kg, kb);
  const grey = Math.hypot(kcb, kcr) < 0.05; // white or black: key on brightness
  const ky = 0.299 * kr + 0.587 * kg + 0.114 * kb;
  const t0 = 0.04 + c.intensity * 0.3;
  const t1 = t0 + 0.08;
  const spill = 0.3 + c.shadow * 0.7;
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255;
    const g = d[i + 1] / 255;
    const b = d[i + 2] / 255;
    const dist = grey ? Math.abs(0.299 * r + 0.587 * g + 0.114 * b - ky) * 0.7 : Math.hypot(cbOf(r, g, b) - kcb, crOf(r, g, b) - kcr);
    if (dist >= t1 + 0.15) continue;
    const a = dist <= t0 ? 0 : dist >= t1 ? 1 : (dist - t0) / (t1 - t0);
    d[i + 3] = d[i + 3] * a;
    if (!grey) {
      // take the screen's colour off the edges (spill)
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      const k = Math.min(1, (1 - Math.min(1, (dist - t0) / (t1 + 0.15 - t0))) * spill);
      d[i] = (r + (y - r) * k) * 255;
      d[i + 1] = (g + (y - g) * k) * 255;
      d[i + 2] = (b + (y - b) * k) * 255;
    }
  }
}
