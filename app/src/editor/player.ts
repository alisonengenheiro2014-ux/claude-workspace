// Preview playback. The <video> element itself is the preview for video
// clips: Safari shows HDR (the iPhone's default recording) correctly there,
// while copying an HDR frame onto a canvas can come out black. Image clips
// are drawn on a canvas that sits in the same place.
//
// One <video> element plays every clip. On iOS, once the user has started it
// with a tap, later play() calls on the same element are allowed, even after
// its source changes.
import type { AssetRow, Id, MediaClip, TimelineDoc, Us } from "../data/db";
import { assetFile } from "../media/import";
import { useEditor } from "./store";
import { audio } from "./audio";
import { durationOf, frameSize, gainAt, mainClips, mainTrack, sourceTimeUs } from "./timeline";

export function drawContain(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  src: CanvasImageSource,
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

export class Player {
  private urls = new Map<Id, string>();
  private images = new Map<Id, ImageBitmap>();
  private clipId: Id | null = null;
  private raf = 0;
  private imageClock: { wall: number; t: Us } | null = null;
  private seekTarget: number | null = null;
  private seeking = false;
  private seekTimer: ReturnType<typeof setTimeout> | undefined;
  private waitingMeta = false;
  private disposed = false;
  private lastSync = 0;
  // While recording a voice-over: play the picture silently so the mic does
  // not pick the soundtrack back up.
  monitorMuted = false;

  constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
  ) {
    video.playsInline = true;
    video.preload = "auto";
    // the video's sound goes through Web Audio so volume works on iOS
    audio.attachVideo(video);
    video.addEventListener("seeked", this.onSeeked);
    video.addEventListener("loadedmetadata", this.onMeta);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.release();
    this.video.removeEventListener("seeked", this.onSeeked);
    this.video.removeEventListener("loadedmetadata", this.onMeta);
    clearTimeout(this.seekTimer);
    for (const u of this.urls.values()) URL.revokeObjectURL(u);
    for (const b of this.images.values()) b.close();
  }

  // Frees the hardware decoder (the export needs it). showAt() reloads.
  release() {
    this.pause();
    this.video.removeAttribute("src");
    this.video.load();
    this.seeking = false;
    this.waitingMeta = false;
    this.seekTarget = null;
  }

  private show(which: "video" | "image" | "none") {
    this.video.style.visibility = which === "video" ? "visible" : "hidden";
    this.canvas.style.visibility = which === "image" ? "visible" : "hidden";
  }

  private async urlFor(asset: AssetRow) {
    let url = this.urls.get(asset.id);
    if (!url) {
      const file = await assetFile(asset);
      if (!file) return null;
      url = URL.createObjectURL(file);
      this.urls.set(asset.id, url);
    }
    return url;
  }

  private async imageFor(asset: AssetRow) {
    let bmp = this.images.get(asset.id);
    if (!bmp) {
      const file = await assetFile(asset);
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

  private async paintImage(asset: AssetRow) {
    const bmp = await this.imageFor(asset);
    const { doc, draft, assets } = useEditor.getState();
    const d = draft ?? doc;
    if (!bmp || !d || this.disposed) return;
    const { width, height } = frameSize(d, assets, 720);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const bg = d.canvas.background.type === "color" ? d.canvas.background.color : "#000000";
    drawContain(this.canvas.getContext("2d")!, bmp, bmp.width, bmp.height, bg);
    this.show("image");
  }

  // Safari ignores a seek made before the file's metadata has loaded, and
  // then never fires "seeked": the preview stayed black. Seeks wait for it.
  private onMeta = () => {
    this.waitingMeta = false;
    const t = this.seekTarget;
    this.seekTarget = null;
    if (t !== null) this.seekVideo(t);
  };

  private onSeeked = () => {
    clearTimeout(this.seekTimer);
    this.seeking = false;
    if (this.seekTarget !== null) {
      const t = this.seekTarget;
      this.seekTarget = null;
      this.seekVideo(t);
    }
  };

  // Coalesces seeks: while one is running, only the latest target is kept.
  private seekVideo(seconds: number) {
    if (this.seeking || this.waitingMeta) {
      this.seekTarget = seconds;
      return;
    }
    if (this.video.readyState < HTMLMediaElement.HAVE_METADATA) {
      this.waitingMeta = true;
      this.seekTarget = seconds;
      return;
    }
    this.seeking = true;
    this.video.currentTime = seconds;
    // if "seeked" never comes (same time, or the browser skipped it), unblock
    clearTimeout(this.seekTimer);
    this.seekTimer = setTimeout(() => this.seeking && this.onSeeked(), 1500);
  }

  // Shows the frame under the playhead while paused.
  async showAt(atUs: Us) {
    const { doc, draft, assets } = useEditor.getState();
    const d = draft ?? doc;
    if (!d) return;
    const hit = this.current(d, atUs);
    const asset = hit && assets.get(hit.clip.assetId);
    if (!hit || !asset) return this.show("none");
    this.clipId = hit.clip.id;
    if (asset.kind === "image") return this.paintImage(asset);
    const url = await this.urlFor(asset);
    if (!url || this.disposed) return this.show("none");
    if (this.video.getAttribute("src") !== url) {
      this.seeking = false;
      this.waitingMeta = false;
      this.seekTarget = null;
      this.video.src = url;
      this.video.load();
    }
    this.show("video");
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
    audio.unlock();
    if (!this.monitorMuted) audio.play(s.doc, s.assets, at);
    this.lastSync = performance.now();
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
    audio.stop();
  }

  private startClip(clip: MediaClip, offsetUs: Us) {
    const asset = useEditor.getState().assets.get(clip.assetId);
    this.clipId = clip.id;
    this.imageClock = null;
    if (!asset || asset.kind === "image") {
      this.video.pause();
      this.imageClock = { wall: performance.now(), t: clip.startUs + offsetUs };
      if (asset) void this.paintImage(asset);
      else this.show("none");
      return;
    }
    const url = this.urls.get(asset.id);
    const go = () => {
      this.show("video");
      this.video.playbackRate = clip.speed;
      // volume and fades are a GainNode now; muted only while recording a
      // voice-over, which also lets iOS start it without a tap
      this.video.muted = this.monitorMuted;
      this.video.currentTime = sourceTimeUs(clip, offsetUs) / 1e6;
      void this.video.play().catch(() => this.pause());
    };
    if (url && this.video.getAttribute("src") === url) go();
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
    }

    // clip volume, fades and the main track's mute, applied to the video sound
    const muted = mainTrack(s.doc).muted;
    audio.setVideoGain(muted || this.monitorMuted ? 0 : gainAt(clip, Math.max(0, t - clip.startUs)));

    // keep the audio lanes in step with the video: restart them if they drift
    const now = performance.now();
    if (!this.monitorMuted && now - this.lastSync > 500) {
      this.lastSync = now;
      const pos = audio.position();
      if (pos !== null && Math.abs(pos - t) > 120_000) audio.play(s.doc, s.assets, t);
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
