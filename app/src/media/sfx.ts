// Sound effects (S07 Efeitos sonoros), made by the app itself with Web Audio
// (no recordings from anyone else): each is a short recipe of oscillators,
// noise, filters and envelopes rendered offline into a WAV.
import { wavFile } from "../captions/tts";

type Make = (ctx: OfflineAudioContext, out: AudioNode) => void;

export const SR = 44_100;

function noise(ctx: BaseAudioContext, seconds: number) {
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate);
  const d = buf.getChannelData(0);
  let seed = 7;
  for (let i = 0; i < d.length; i++) {
    seed = (seed * 16807) % 2147483647;
    d[i] = (seed / 2147483647) * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  return src;
}

function env(ctx: BaseAudioContext, at: number, attack: number, hold: number, release: number, peak = 1) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + attack);
  g.gain.setValueAtTime(peak, at + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release);
  return g;
}

function tone(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, at: number, len: number, peak = 0.6) {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, at);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + len);
  const g = env(ctx, at, 0.005, 0, len, peak);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + len + 0.05);
}

function bell(ctx: BaseAudioContext, out: AudioNode, f: number, at: number, len = 1.2, peak = 0.4) {
  for (const [mult, amp] of [
    [1, 1],
    [2.76, 0.4],
    [5.4, 0.2],
  ]) tone(ctx, out, "sine", f * mult, f * mult, at, len / mult ** 0.3, peak * amp);
}

function whooshNoise(ctx: BaseAudioContext, out: AudioNode, at: number, len: number, f0: number, f1: number, peak = 0.7) {
  const n = noise(ctx, len + 0.1);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(f0, at);
  bp.frequency.exponentialRampToValueAtTime(f1, at + len);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(peak, at + len * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len);
  n.connect(bp).connect(g).connect(out);
  n.start(at);
}

export const SFX: { id: string; label: string; emoji: string; seconds: number; make: Make }[] = [
  { id: "whoosh", label: "Whoosh", emoji: "💨", seconds: 0.7, make: (c, o) => whooshNoise(c, o, 0, 0.6, 300, 3000) },
  { id: "swoosh-down", label: "Descida", emoji: "⬇️", seconds: 0.7, make: (c, o) => whooshNoise(c, o, 0, 0.6, 3000, 250) },
  { id: "pop", label: "Pop", emoji: "🫧", seconds: 0.25, make: (c, o) => tone(c, o, "sine", 900, 180, 0, 0.12, 0.8) },
  { id: "click", label: "Clique", emoji: "🖱️", seconds: 0.1, make: (c, o) => tone(c, o, "square", 2200, 1200, 0, 0.02, 0.4) },
  { id: "ding", label: "Ding", emoji: "🔔", seconds: 1.4, make: (c, o) => bell(c, o, 1320, 0) },
  {
    id: "success",
    label: "Sucesso",
    emoji: "✅",
    seconds: 1.1,
    make: (c, o) => [523, 659, 784, 1047].forEach((f, i) => tone(c, o, "triangle", f, f, i * 0.09, 0.5, 0.35)),
  },
  {
    id: "error",
    label: "Erro",
    emoji: "❌",
    seconds: 0.6,
    make: (c, o) => {
      tone(c, o, "square", 220, 200, 0, 0.18, 0.25);
      tone(c, o, "square", 180, 160, 0.22, 0.25, 0.25);
    },
  },
  {
    id: "cash",
    label: "Dinheiro",
    emoji: "💰",
    seconds: 1.3,
    make: (c, o) => {
      const n = noise(c, 0.12);
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 3000;
      n.connect(hp).connect(env(c, 0, 0.002, 0.03, 0.08, 0.5)).connect(o);
      n.start(0);
      bell(c, o, 2093, 0.08, 1.1, 0.35);
      bell(c, o, 2637, 0.16, 1.0, 0.25);
    },
  },
  {
    id: "boom",
    label: "Impacto",
    emoji: "💥",
    seconds: 1.4,
    make: (c, o) => {
      tone(c, o, "sine", 120, 35, 0, 1.2, 1);
      const n = noise(c, 0.5);
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 900;
      n.connect(lp).connect(env(c, 0, 0.002, 0.02, 0.4, 0.6)).connect(o);
      n.start(0);
    },
  },
  { id: "laser", label: "Laser", emoji: "🔫", seconds: 0.4, make: (c, o) => tone(c, o, "sawtooth", 2400, 200, 0, 0.3, 0.3) },
  { id: "rise", label: "Subida", emoji: "🚀", seconds: 1.6, make: (c, o) => tone(c, o, "sawtooth", 120, 1600, 0, 1.4, 0.25) },
  {
    id: "notify",
    label: "Notificação",
    emoji: "📱",
    seconds: 0.8,
    make: (c, o) => {
      tone(c, o, "sine", 1046, 1046, 0, 0.18, 0.45);
      tone(c, o, "sine", 1568, 1568, 0.14, 0.4, 0.45);
    },
  },
  {
    id: "shutter",
    label: "Câmera",
    emoji: "📸",
    seconds: 0.35,
    make: (c, o) => {
      for (const at of [0, 0.11]) {
        const n = noise(c, 0.08);
        const bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 2500;
        n.connect(bp).connect(env(c, at, 0.001, 0.01, 0.06, 0.9)).connect(o);
        n.start(at);
      }
    },
  },
  {
    id: "drumroll",
    label: "Rufar",
    emoji: "🥁",
    seconds: 2.2,
    make: (c, o) => {
      for (let t = 0; t < 1.6; t += 0.045) {
        const n = noise(c, 0.06);
        const bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1800;
        n.connect(bp).connect(env(c, t, 0.002, 0, 0.05, 0.15 + (t / 1.6) * 0.4)).connect(o);
        n.start(t);
      }
      tone(c, o, "sine", 90, 50, 1.65, 0.5, 0.9);
    },
  },
  {
    id: "tick",
    label: "Relógio",
    emoji: "⏱️",
    seconds: 2.1,
    make: (c, o) => {
      for (let i = 0; i < 4; i++) tone(c, o, "square", i % 2 ? 1500 : 2000, i % 2 ? 1400 : 1900, i * 0.5, 0.02, 0.35);
    },
  },
  {
    id: "typing",
    label: "Digitando",
    emoji: "⌨️",
    seconds: 1.6,
    make: (c, o) => {
      let t = 0;
      let seed = 3;
      while (t < 1.4) {
        seed = (seed * 16807) % 2147483647;
        const n = noise(c, 0.03);
        const bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 3000 + (seed % 2000);
        n.connect(bp).connect(env(c, t, 0.001, 0.005, 0.02, 0.6)).connect(o);
        n.start(t);
        t += 0.07 + (seed % 100) / 1000;
      }
    },
  },
];

export async function renderSfx(id: string): Promise<AudioBuffer> {
  const s = SFX.find((x) => x.id === id)!;
  const ctx = new OfflineAudioContext(1, Math.ceil(SR * s.seconds), SR);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  s.make(ctx, master);
  return ctx.startRendering();
}

export async function sfxFile(id: string): Promise<File> {
  const buf = await renderSfx(id);
  const s = SFX.find((x) => x.id === id)!;
  return wavFile(buf.getChannelData(0), buf.sampleRate, `Efeito - ${s.label}.wav`);
}
