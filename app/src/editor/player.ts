// Preview playback. One <video> element plays whichever clip is under the
// playhead and is painted onto the preview canvas. A single element matters
// on iOS: once the user has started it with a tap, later play() calls on the
// same element are allowed, even after its source changes.
//
// This is the first version. The WebGL compositor (overlays, filters,
// transitions) replaces the paint step later; the clock logic stays.
import type { AssetRow, Id, MediaClip, TimelineDoc, Us } from "../data/db";
import { readFile } from "../data/opfs";
import { useEditor } from "./store";
import { durationOf, frameSize, mainClips, sourceTimeUs } from "./timeline";

type Drawable = HTMLVideoElement | ImageBitmap;

export function drawContain(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  src: Drawable | HTMLCanvasElement | OffscreenCanvas,
  srcW: number,
  srcH: number,
  bg: string,
) {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  if (!srcW || !srcH) return;
  const s = Math.min(W / srcW, H / srcH);
  const w = srcW * s;
  const h = srcH * s;
  ctx.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
}

function bgOf(doc: TimelineDoc) {
  return doc.canvas.background.type === "color" ? doc.canvas.background.color : "#000000";
}

export class Player {
  private urls = new Map<Id, string>();
  private images = new Map<Id, ImageBitmap>();
  private clipId: Id | null = null;
  private raf = 0;
  private imageClock: { wall: number; t: Us } | null = null;
  private seekTarget: number | null = null;
  private seeking = false;
  private disposed = false;

  constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
  ) {
    video.playsInline = true;
    video.preload = "auto";
    video.addEventListener("seeked", this.onSeeked);
    video.addEventListener("loadeddata", this.onSeeked);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.video.pause();
    this.video.removeEventListener("seeked", this.onSeeked);
    this.video.removeEventListener("loadeddata", this.onSeeked);
    this.video.removeAttribute("src");
    this.video.load();
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    for (const b of this.images.values()) b.close();
  }

  // Preview resolution: the project shape at 720p, scaled for the screen.
  resize() {
    const { doc, assets } = useEditor.getState();
    if (!doc) return;
    const { width, height } = frameSize(doc, assets, 720);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private async urlFor(asset: AssetRow) {
    let url = this.urls.get(asset.id);
    if (!url) {
      const file = await readFile(asset.opfsPath);
      if (!file) return null;
      url = URL.createObjectURL(file);
      this.urls.set(asset.id, url);
    }
    return url;
  }

  private async imageFor(asset: AssetRow) {
    let bmp = this.images.get(asset.id);
    if (!bmp) {
      const file = await readFile(asset.opfsPath);
      if (!file) return null;
      bmp = await createImageBitmap(file);
      this.images.set(asset.id, bmp);
    }
    return bmp;
  }

  private current(doc: TimelineDoc, atUs: Us): { clip: MediaClip; offsetUs: Us } | null {
    const clips = mainClips(doc);
    for (const clip of clips) {
      if (atUs < clip.startUs + clip.durationUs) return { clip, offsetUs: Math.max(0, atUs - clip.startUs) };
    }
    const last = clips[clips.length - 1];
    return last ? { clip: last, offsetUs: last.durationUs - 1 } : null;
  }

  private paint(src: Drawable | null, w: number, h: number) {
    const { doc, draft } = useEditor.getState();
    const d = draft ?? doc;
    if (!d) return;
    this.resize();
    const ctx = this.canvas.getContext("2d")!;
    if (src) drawContain(ctx, src, w, h, bgOf(d));
    else {
      ctx.fillStyle = bgOf(d);
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  private paintVideo() {
    if (this.video.readyState >= 2) this.paint(this.video, this.video.videoWidth, this.video.videoHeight);
  }

  private onSeeked = () => {
    this.seeking = false;
    if (this.seekTarget !== null) {
      const t = this.seekTarget;
      this.seekTarget = null;
      this.seekVideo(t);
      return;
    }
    if (!useEditor.getState().playing) this.paintVideo();
  };

  // Coalesces seeks: while one is running, only the latest target is kept.
  private seekVideo(seconds: number) {
    if (this.seeking) {
      this.seekTarget = seconds;
      return;
    }
    this.seeking = true;
    this.video.currentTime = seconds;
  }

  // Shows the frame under the playhead while paused.
  async showAt(atUs: Us) {
    const { doc, draft, assets } = useEditor.getState();
    const d = draft ?? doc;
    if (!d) return;
    const hit = this.current(d, atUs);
    if (!hit) return this.paint(null, 0, 0);
    const asset = assets.get(hit.clip.assetId);
    if (!asset) return this.paint(null, 0, 0);
    this.clipId = hit.clip.id;
    if (asset.kind === "image") {
      const bmp = await this.imageFor(asset);
      if (!this.disposed && bmp) this.paint(bmp, bmp.width, bmp.height);
      return;
    }
    const url = await this.urlFor(asset);
    if (!url || this.disposed) return;
    if (this.video.src !== url) {
      this.seeking = false;
      this.seekTarget = null;
      this.video.src = url;
    }
    this.seekVideo(sourceTimeUs(hit.clip, hit.offsetUs) / 1e6);
  }

  // Must be called straight from the tap handler (iOS needs the gesture).
  play() {
    const s = useEditor.getState();
    if (!s.doc || durationOf(s.doc) === 0) return;
    let at = s.playheadUs;
    if (at >= durationOf(s.doc) - 1000) at = 0; // at the end: start over
    s.setPlayhead(at);
    s.setPlaying(true);
    const hit = this.current(s.doc, at);
    if (hit) this.startClip(hit.clip, hit.offsetUs);
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
  }

  pause() {
    useEditor.getState().setPlaying(false);
    cancelAnimationFrame(this.raf);
    this.video.pause();
    this.imageClock = null;
  }

  private startClip(clip: MediaClip, offsetUs: Us) {
    const asset = useEditor.getState().assets.get(clip.assetId);
    this.clipId = clip.id;
    this.imageClock = null;
    if (!asset || asset.kind === "image") {
      this.video.pause();
      this.imageClock = { wall: performance.now(), t: clip.startUs + offsetUs };
      if (asset) void this.imageFor(asset).then((b) => b && this.paint(b, b.width, b.height));
      return;
    }
    const url = this.urls.get(asset.id);
    const go = () => {
      this.video.playbackRate = clip.speed;
      this.video.muted = clip.volume === 0;
      this.video.currentTime = sourceTimeUs(clip, offsetUs) / 1e6;
      void this.video.play().catch(() => this.pause());
    };
    if (url && this.video.src === url) go();
    else if (url) {
      this.video.src = url;
      go();
    } else {
      // not loaded yet: load, then start (may lose the iOS gesture on first play)
      void this.urlFor(asset).then((u) => {
        if (!u || !useEditor.getState().playing) return;
        this.video.src = u;
        go();
      });
    }
  }

  private tick = () => {
    const s = useEditor.getState();
    if (!s.playing || !s.doc || this.disposed) return;
    const clips = mainClips(s.doc);
    const i = clips.findIndex((c) => c.id === this.clipId);
    const clip = clips[i];
    if (!clip) return this.pause();

    let t: Us;
    let done: boolean;
    if (this.imageClock) {
      t = this.imageClock.t + (performance.now() - this.imageClock.wall) * 1000;
      done = t >= clip.startUs + clip.durationUs;
    } else {
      const srcUs = this.video.currentTime * 1e6;
      t = clip.startUs + (srcUs - clip.inUs) / clip.speed;
      done = srcUs >= clip.outUs - 1000 || this.video.ended;
      this.paintVideo();
    }

    if (done) {
      const next = clips[i + 1];
      if (!next) {
        s.setPlayhead(durationOf(s.doc));
        this.pause();
        return;
      }
      s.setPlayhead(next.startUs);
      this.startClip(next, 0);
    } else s.setPlayhead(t);
    this.raf = requestAnimationFrame(this.tick);
  };
}
