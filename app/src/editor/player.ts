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
import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { durationOf, frameSize, gainAt, mainClips, mainTrack, sourceTimeUs, transitionAt } from "./timeline";
import { fxOf, layerCss, type LayerFx } from "./transitions";
import { containDraw, frameBgOf, drawFrame } from "./frame";

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

  // still frames for transitions: the last frame of A, the first of B
  private stills = new Map<string, Promise<ImageBitmap | null>>();
  private stillsReady = new Map<string, ImageBitmap>();
  private fxShown = "";

  constructor(
    private video: HTMLVideoElement,
    private canvas: HTMLCanvasElement,
    private fxCanvas: HTMLCanvasElement,
    private dip: HTMLElement,
    private bgCanvas: HTMLCanvasElement,
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
    for (const b of this.stillsReady.values()) b.close();
  }

  // A frame of a clip's media as an ImageBitmap, decoded once and cached.
  private still(asset: AssetRow, us: Us): ImageBitmap | null {
    const key = `${asset.id}@${Math.round(us / 1000)}`;
    const ready = this.stillsReady.get(key);
    if (ready) return ready;
    if (!this.stills.has(key)) {
      const p = (async () => {
        if (asset.kind === "image") {
          const bmp = await this.imageFor(asset);
          return bmp ? createImageBitmap(bmp) : null;
        }
        const file = await assetFile(asset);
        if (!file) return null;
        const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
        try {
          const track = await input.getPrimaryVideoTrack();
          if (!track) return null;
          const s = Math.min(1, 1080 / Math.max(track.displayWidth, track.displayHeight));
          const sink = new CanvasSink(track, { width: Math.round(track.displayWidth * s), height: Math.round(track.displayHeight * s), fit: "fill" });
          const wc = await sink.getCanvas(us / 1e6);
          return wc ? createImageBitmap(wc.canvas) : null;
        } finally {
          input.dispose();
        }
      })().catch(() => null);
      this.stills.set(key, p);
      void p.then((b) => {
        if (!b) return;
        this.stillsReady.set(key, b);
        const s = useEditor.getState();
        if (!s.playing) this.applyTransition(s.playheadUs);
        this.bgKey = "";
        this.paintBg();
      });
    }
    return null;
  }

  private style(el: HTMLElement, fx: LayerFx | null, z: number) {
    const css = fx ? layerCss(fx) : { opacity: "", transform: "", clipPath: "" };
    el.style.opacity = css.opacity ?? "";
    el.style.transform = css.transform ?? "";
    el.style.clipPath = css.clipPath ?? "";
    el.style.zIndex = fx ? String(z) : "";
  }

  // Blurred background behind a video that does not fill the frame: a
  // still of the clip, softened with CSS. Light, and the blur hides that it
  // does not move.
  private bgKey = "";
  paintBg() {
    const { doc, draft, assets } = useEditor.getState();
    const d = draft ?? doc;
    const clip = d && mainClips(d).find((c) => c.id === this.clipId);
    const asset = clip && assets.get(clip.assetId);
    if (!d || d.canvas.background.type !== "blur" || !clip || !asset || asset.kind === "image") {
      this.bgCanvas.style.visibility = "hidden";
      this.bgKey = "";
      return;
    }
    const key = `${clip.id}`;
    if (this.bgKey === key) return;
    const bmp = this.still(asset, clip.inUs);
    if (!bmp) return; // painted when the still is ready
    const c = this.bgCanvas;
    c.width = 160;
    c.height = Math.round((160 * this.video.clientHeight) / Math.max(1, this.video.clientWidth)) || 284;
    const ctx = c.getContext("2d")!;
    const s = Math.max(c.width / bmp.width, c.height / bmp.height);
    ctx.drawImage(bmp, (c.width - bmp.width * s) / 2, (c.height - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
    c.style.visibility = "visible";
    this.bgKey = key;
  }

  // Shows the transition under tUs, or clears it. The playing clip is the
  // <video> (or the image canvas); the other clip is a still on fxCanvas.
  applyTransition(tUs: Us) {
    const { doc, draft, assets } = useEditor.getState();
    const d = draft ?? doc;
    const w = d ? transitionAt(d, tUs) : null;
    if (!d || !w) {
      if (this.fxShown) {
        this.fxShown = "";
        this.style(this.video, null, 0);
        this.style(this.canvas, null, 0);
        this.fxCanvas.style.visibility = "hidden";
        this.dip.style.opacity = "0";
      }
      return;
    }
    const liveIsA = tUs < w.cutUs;
    const liveClip = liveIsA ? w.from : w.to;
    const stillClip = liveIsA ? w.to : w.from;
    const liveAsset = assets.get(liveClip.assetId);
    const stillAsset = assets.get(stillClip.assetId);
    const liveEl = liveAsset?.kind === "image" ? this.canvas : this.video;
    const fx = fxOf(w.type, w.p);
    const liveFx = liveIsA ? fx.a : fx.b;
    const stillFx = liveIsA ? fx.b : fx.a;
    const liveOnTop = (fx.top === "a") === liveIsA;
    this.style(liveEl, liveFx, liveOnTop ? 2 : 1);

    const bmp = stillAsset ? this.still(stillAsset, liveIsA ? stillClip.inUs : Math.max(stillClip.inUs, stillClip.outUs - 34_000)) : null;
    const { width, height } = frameSize(d, assets, 720);
    if (this.fxCanvas.width !== width || this.fxCanvas.height !== height) {
      this.fxCanvas.width = width;
      this.fxCanvas.height = height;
    }
    const key = `${stillClip.id}:${liveIsA}`;
    if (bmp && this.fxShown !== key) {
      drawFrame(this.fxCanvas.getContext("2d")!, frameBgOf(d), containDraw(bmp, bmp.width, bmp.height));
      this.fxShown = key;
    } else if (!bmp) this.fxShown = "pending";
    this.fxCanvas.style.visibility = bmp ? "visible" : "hidden";
    this.style(this.fxCanvas, stillFx, liveOnTop ? 1 : 2);
    this.dip.style.background = fx.dip?.color ?? "transparent";
    this.dip.style.opacity = String(fx.dip?.alpha ?? 0);
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
    drawFrame(this.canvas.getContext("2d")!, frameBgOf(d), containDraw(bmp, bmp.width, bmp.height));
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
    this.applyTransition(atUs);
    const hit = this.current(d, atUs);
    const asset = hit && assets.get(hit.clip.assetId);
    if (!hit || !asset) return this.show("none");
    this.clipId = hit.clip.id;
    this.paintBg();
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

  // Plays just a range (to show a transition), then stops at its end.
  playRange(fromUs: Us, toUs: Us) {
    useEditor.getState().setPlayhead(fromUs);
    this.stopAt = toUs;
    this.play();
  }
  private stopAt: Us | null = null;

  pause() {
    this.stopAt = null;
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
    this.paintBg();
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
      // browsers cap playback rate (16x); the export uses the real speed
      this.video.playbackRate = Math.min(16, Math.max(0.1, clip.speed));
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

    this.applyTransition(t);
    if (this.stopAt !== null && t >= this.stopAt) {
      s.setPlayhead(this.stopAt);
      this.pause();
      return;
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
