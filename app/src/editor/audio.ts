// Preview audio with Web Audio. Two jobs:
//  1. The <video> element's sound goes through a GainNode, because iOS
//     ignores video.volume: this is what makes clip volume and fades work in
//     the preview on the iPhone.
//  2. Audio lanes (songs, recordings, a video's extracted sound) are decoded
//     once into AudioBuffers and scheduled against the playhead.
// The export mixes the same clips with the same envelope (scheduleEnvelope),
// in an OfflineAudioContext.
import { ALL_FORMATS, AudioBufferSink, BlobSource, Input } from "mediabunny";
import type { AssetRow, Id, MediaClip, TimelineDoc, Us } from "../data/db";
import { assetFile } from "../media/import";
import { gainAt } from "./timeline";

export const PEAKS_PER_SEC = 20;

// Volume envelope (volume × fade in × fade out) of a clip that starts playing
// at local time fromUs, at context time whenS.
export function scheduleEnvelope(param: AudioParam, clip: MediaClip, fromUs: Us, whenS: number) {
  param.cancelScheduledValues(0);
  const plain = !clip.keyframes?.some((k) => k.property === "volume");
  if (plain) {
    // fades only: a few ramps
    param.setValueAtTime(gainAt(clip, fromUs), whenS);
    const at = (localUs: Us) => whenS + (localUs - fromUs) / 1e6;
    if (clip.fadeInUs > fromUs) param.linearRampToValueAtTime(clip.volume, at(clip.fadeInUs));
    const fadeOutStart = clip.durationUs - clip.fadeOutUs;
    if (clip.fadeOutUs > 0) {
      if (fadeOutStart > fromUs) param.setValueAtTime(gainAt(clip, fadeOutStart), at(fadeOutStart));
      param.linearRampToValueAtTime(0, at(clip.durationUs));
    }
    return;
  }
  // volume keyframes: the same curve as gainAt, sampled every 20 ms
  const step = 20_000;
  const n = Math.max(2, Math.ceil((clip.durationUs - fromUs) / step) + 1);
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) curve[i] = gainAt(clip, Math.min(clip.durationUs, fromUs + i * step));
  param.setValueCurveAtTime(curve, whenS, Math.max(0.001, ((n - 1) * step) / 1e6));
}

// Noise reduction (S08 Reduzir ruído): cuts rumble and wind under 90 Hz,
// mains hum at 60 Hz and hiss above 8 kHz, leaving the voice. Not a
// spectral denoiser, but it runs live and the export uses the same nodes.
export function denoiseChain(ctx: BaseAudioContext): { input: AudioNode; output: AudioNode } {
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 90;
  hp.Q.value = 0.7;
  const hum = ctx.createBiquadFilter();
  hum.type = "peaking";
  hum.frequency.value = 60;
  hum.Q.value = 4;
  hum.gain.value = -14;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 8000;
  lp.Q.value = 0.7;
  hp.connect(hum).connect(lp);
  return { input: hp, output: lp };
}

// Voice effects (S08 Efeitos de voz), as Web Audio graphs: the preview and
// the export build the same one.
export const VOICE_FX = [
  { id: "robot", label: "Robô", emoji: "🤖" },
  { id: "echo", label: "Eco", emoji: "🗣️" },
  { id: "radio", label: "Rádio", emoji: "📻" },
  { id: "phone", label: "Telefone", emoji: "☎️" },
  { id: "megaphone", label: "Megafone", emoji: "📢" },
  { id: "cave", label: "Caverna", emoji: "🕳️" },
];

function shaper(ctx: BaseAudioContext, amount: number) {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
  }
  ws.curve = curve;
  return ws;
}

function band(ctx: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.7) {
  const b = ctx.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

export function voiceChain(ctx: BaseAudioContext, id: string): { input: AudioNode; output: AudioNode } | null {
  const input = ctx.createGain();
  const output = ctx.createGain();
  if (id === "robot") {
    // ring modulation: the voice times a 60 Hz wave
    const ring = ctx.createGain();
    ring.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.frequency.value = 60;
    osc.connect(ring.gain);
    osc.start();
    input.connect(ring).connect(output);
    output.gain.value = 1.6;
  } else if (id === "echo") {
    const delay = ctx.createDelay(2);
    delay.delayTime.value = 0.28;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    input.connect(output);
    input.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(output);
  } else if (id === "radio") {
    input.connect(band(ctx, "highpass", 500)).connect(band(ctx, "lowpass", 3500)).connect(shaper(ctx, 8)).connect(output);
    output.gain.value = 0.7;
  } else if (id === "phone") {
    input.connect(band(ctx, "highpass", 400)).connect(band(ctx, "lowpass", 3200)).connect(output);
    output.gain.value = 1.4;
  } else if (id === "megaphone") {
    input.connect(band(ctx, "bandpass", 1600, 1.2)).connect(shaper(ctx, 30)).connect(output);
    output.gain.value = 0.6;
  } else if (id === "cave") {
    // a long, dark reverb from a generated impulse
    const conv = ctx.createConvolver();
    const len = Math.round(ctx.sampleRate * 2.5);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let seed = 11 + c;
      for (let i = 0; i < len; i++) {
        seed = (seed * 16807) % 2147483647;
        d[i] = ((seed / 2147483647) * 2 - 1) * Math.pow(1 - i / len, 3);
      }
    }
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.5;
    input.connect(output);
    input.connect(band(ctx, "lowpass", 2500)).connect(conv).connect(wet).connect(output);
  } else return null;
  return { input, output };
}

// Noise reduction and/or a voice effect, in that order (null: nothing to do).
export function soundChain(ctx: BaseAudioContext, clip: { denoise?: boolean; voiceFx?: string | null }) {
  const parts = [clip.denoise ? denoiseChain(ctx) : null, clip.voiceFx ? voiceChain(ctx, clip.voiceFx) : null].filter(
    (x): x is { input: AudioNode; output: AudioNode } => !!x,
  );
  if (!parts.length) return null;
  for (let i = 1; i < parts.length; i++) parts[i - 1].output.connect(parts[i].input);
  return { input: parts[0].input, output: parts[parts.length - 1].output };
}

// Decodes a file's whole audio track into one AudioBuffer.
export async function decodeAudio(file: File): Promise<AudioBuffer | null> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const chunks: { buffer: AudioBuffer; timestamp: number }[] = [];
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) chunks.push({ buffer, timestamp });
    if (!chunks.length) return null;
    const sr = chunks[0].buffer.sampleRate;
    const channels = Math.max(...chunks.map((c) => c.buffer.numberOfChannels));
    const t0 = chunks[0].timestamp;
    const last = chunks[chunks.length - 1];
    const length = Math.ceil((last.timestamp - t0) * sr) + last.buffer.length;
    const out = new AudioBuffer({ length, numberOfChannels: channels, sampleRate: sr });
    for (const { buffer, timestamp } of chunks) {
      const offset = Math.max(0, Math.round((timestamp - t0) * sr));
      for (let ch = 0; ch < channels; ch++) {
        const src = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
        out.copyToChannel(src.subarray(0, Math.min(src.length, length - offset)), ch, offset);
      }
    }
    return out;
  } finally {
    input.dispose();
  }
}

// Peak level per 1/PEAKS_PER_SEC s, 0..1, for the timeline waveform.
export function peaksOf(buf: AudioBuffer): number[] {
  const step = Math.max(1, Math.floor(buf.sampleRate / PEAKS_PER_SEC));
  const n = Math.ceil(buf.length / step);
  const out = new Array<number>(n).fill(0);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      let m = 0;
      const end = Math.min(d.length, (i + 1) * step);
      for (let j = i * step; j < end; j += 4) m = Math.max(m, Math.abs(d[j]));
      out[i] = Math.max(out[i], m);
    }
  }
  const top = Math.max(0.05, ...out);
  return out.map((v) => Math.round((v / top) * 100) / 100);
}

type AudioContextCtor = typeof AudioContext;

class AudioEngine {
  private ctx: AudioContext | null = null;
  private videoGain: GainNode | null = null;
  private videoSrc: MediaElementAudioSourceNode | null = null;
  private attached = new WeakSet<HTMLMediaElement>();
  private buffers = new Map<Id, Promise<AudioBuffer | null>>();
  private nodes: AudioBufferSourceNode[] = [];
  private session = 0; // bumps on every play/stop so late decodes don't start
  private clock: { ctxS: number; us: Us } | null = null;

  context() {
    if (!this.ctx) {
      const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext: AudioContextCtor }).webkitAudioContext) as AudioContextCtor;
      this.ctx = new Ctor();
      // play through the ring/silent switch, like a video app
      this.setSessionType("playback");
    }
    return this.ctx;
  }

  // iOS audio session: "playback" plays through the silent switch but does
  // not allow the microphone; recording a voice-over needs "play-and-record".
  setSessionType(type: "playback" | "play-and-record") {
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (!session) return;
    try {
      session.type = type;
    } catch {
      // older Safari: no audio session API
    }
  }

  // Call from the play tap: iOS only starts audio from a user gesture.
  unlock() {
    const ctx = this.context();
    if (ctx.state !== "running") void ctx.resume();
  }

  attachVideo(video: HTMLVideoElement) {
    if (this.attached.has(video)) return;
    const ctx = this.context();
    this.videoGain = ctx.createGain();
    this.videoSrc = ctx.createMediaElementSource(video);
    this.videoSrc.connect(this.videoGain);
    this.videoGain.connect(ctx.destination);
    this.attached.add(video);
  }

  setVideoGain(g: number) {
    if (this.videoGain && this.ctx) this.videoGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.015);
  }

  // The playing clip's noise reduction and voice effect on the video's sound;
  // the graph is rebuilt only when they change.
  private videoChainKey = "";
  private videoChain: { input: AudioNode; output: AudioNode } | null = null;
  setVideoSound(clip: { denoise?: boolean; voiceFx?: string | null }) {
    const key = `${!!clip.denoise}|${clip.voiceFx ?? ""}`;
    if (key === this.videoChainKey || !this.videoSrc || !this.videoGain || !this.ctx) return;
    this.videoChainKey = key;
    this.videoSrc.disconnect();
    this.videoChain?.output.disconnect();
    this.videoChain = soundChain(this.ctx, clip);
    if (this.videoChain) {
      this.videoSrc.connect(this.videoChain.input);
      this.videoChain.output.connect(this.videoGain);
    } else this.videoSrc.connect(this.videoGain);
  }

  buffer(asset: AssetRow): Promise<AudioBuffer | null> {
    let p = this.buffers.get(asset.id);
    if (!p) {
      p = assetFile(asset).then((f) => (f ? decodeAudio(f) : null)).catch((err) => {
        console.warn("audio decode failed", asset.name, err);
        return null;
      });
      this.buffers.set(asset.id, p);
    }
    return p;
  }

  // Timeline position of the running audio clock, or null when stopped.
  position(): Us | null {
    if (!this.clock || !this.ctx) return null;
    return this.clock.us + (this.ctx.currentTime - this.clock.ctxS) * 1e6;
  }

  stop() {
    this.session++;
    this.clock = null;
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {
        // never started
      }
      n.disconnect();
    }
    this.nodes = [];
  }

  // Starts every audio-lane clip that is still ahead of atUs.
  play(doc: TimelineDoc, assets: Map<Id, AssetRow>, atUs: Us) {
    this.stop();
    const ctx = this.context();
    const session = this.session;
    this.clock = { ctxS: ctx.currentTime, us: atUs };
    for (const track of doc.tracks) {
      if (track.kind !== "audio" || track.muted || track.hidden) continue;
      for (const clip of track.items as MediaClip[]) {
        if (clip.type !== "media" || clip.startUs + clip.durationUs <= atUs) continue;
        const asset = assets.get(clip.assetId);
        if (!asset) continue;
        void this.buffer(asset).then((buf) => {
          if (buf && session === this.session) this.schedule(clip, buf);
        });
      }
    }
  }

  private schedule(clip: MediaClip, buf: AudioBuffer) {
    const ctx = this.ctx!;
    const now = this.position();
    if (now === null) return;
    const local = Math.max(0, now - clip.startUs);
    if (local >= clip.durationUs) return;
    const whenS = ctx.currentTime + Math.max(0, clip.startUs - now) / 1e6;
    const offsetS = (clip.inUs + local * clip.speed) / 1e6;
    const lengthS = (clip.outUs - clip.inUs - local * clip.speed) / 1e6;
    if (offsetS >= buf.duration || lengthS <= 0) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = clip.speed;
    const gain = ctx.createGain();
    scheduleEnvelope(gain.gain, clip, local, whenS);
    const chain = soundChain(ctx, clip);
    if (chain) {
      src.connect(chain.input);
      chain.output.connect(gain);
    } else src.connect(gain);
    gain.connect(ctx.destination);
    src.start(whenS, offsetS, lengthS);
    this.nodes.push(src);
  }
}

export const audio = new AudioEngine();
