// Speed curve editor (S05 Curva, Personalizar): drag a point up or down to
// change the speed at that moment (0.1x..10x, log scale), left/right to move it.
import { useRef, type PointerEvent } from "react";

type P = { t: number; speed: number };
const W = 300;
const H = 120;
const PAD = 12;
const LO = Math.log(0.1);
const HI = Math.log(10);
const yOf = (v: number) => PAD + (1 - (Math.log(v) - LO) / (HI - LO)) * (H - PAD * 2);
const vOf = (y: number) => Math.exp(LO + (1 - (y - PAD) / (H - PAD * 2)) * (HI - LO));
const xOf = (t: number) => PAD + t * (W - PAD * 2);
const tOf = (x: number) => (x - PAD) / (W - PAD * 2);

export function CurveEditor({ points, onChange, onDone }: { points: P[]; onChange: (p: P[]) => void; onDone: () => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);
  const at = (e: PointerEvent) => {
    const r = svg.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  function move(e: PointerEvent) {
    const i = drag.current;
    if (i === null) return;
    const { x, y } = at(e);
    const next = points.map((p) => ({ ...p }));
    const speed = Math.round(Math.min(10, Math.max(0.1, vOf(y))) * 10) / 10;
    // the ends stay at the ends; the others stay between their neighbours
    const t = i === 0 ? 0 : i === points.length - 1 ? 1 : Math.min(points[i + 1].t - 0.03, Math.max(points[i - 1].t + 0.03, tOf(x)));
    next[i] = { t: Math.round(t * 100) / 100, speed };
    onChange(next);
  }
  return (
    <svg
      ref={svg}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Curva de velocidade: arraste os pontos"
      className="h-32 w-full touch-none rounded-md bg-surface-2"
      onPointerMove={move}
      onPointerUp={() => {
        if (drag.current !== null) onDone();
        drag.current = null;
      }}
      onPointerCancel={() => (drag.current = null)}
    >
      <line x1={PAD} x2={W - PAD} y1={yOf(1)} y2={yOf(1)} className="stroke-border" strokeDasharray="4 4" />
      <text x={W - PAD} y={yOf(1) - 4} textAnchor="end" className="fill-text-subtle text-[9px]">
        1x
      </text>
      <polyline points={points.map((p) => `${xOf(p.t)},${yOf(p.speed)}`).join(" ")} fill="none" className="stroke-accent" strokeWidth="2" />
      {points.map((p, i) => (
        <g key={i}>
          <circle
            cx={xOf(p.t)}
            cy={yOf(p.speed)}
            r="12"
            className="fill-transparent"
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture(e.pointerId);
              drag.current = i;
            }}
          />
          <circle cx={xOf(p.t)} cy={yOf(p.speed)} r="5" className="pointer-events-none fill-text" />
          <text x={xOf(p.t)} y={yOf(p.speed) - 9} textAnchor="middle" className="pointer-events-none fill-text-muted text-[9px]">
            {p.speed.toString().replace(".", ",")}x
          </text>
        </g>
      ))}
    </svg>
  );
}
