// Text items: fonts, defaults, animation and drawing. The same drawText()
// paints the preview overlay and the exported frames, so what you see while
// editing is what the file gets.
import "@fontsource/montserrat/latin-800.css";
import "@fontsource/inter/latin-700.css";
import "@fontsource/bebas-neue/latin-400.css";
import "@fontsource/anton/latin-400.css";
import "@fontsource/oswald/latin-700.css";
import "@fontsource/pacifico/latin-400.css";
import "@fontsource/permanent-marker/latin-400.css";
import "@fontsource/montserrat/latin-800-italic.css";
import "@fontsource/poppins/latin-800.css";
import "@fontsource/poppins/latin-800-italic.css";
import "@fontsource/lilita-one/latin-400.css";
import "@fontsource/luckiest-guy/latin-400.css";
import "@fontsource/dm-serif-display/latin-400.css";
import "@fontsource/bangers/latin-400.css";
import "@fontsource/chewy/latin-400.css";
import "@fontsource/playfair-display/latin-800.css";
import "@fontsource/playfair-display/latin-800-italic.css";
import "@fontsource/montserrat/latin-900.css";
import "@fontsource/montserrat/latin-900-italic.css";
import "@fontsource/racing-sans-one/latin-400.css";
import "@fontsource/orbitron/latin-900.css";
import "@fontsource/audiowide/latin-400.css";
import "@fontsource/russo-one/latin-400.css";
import "@fontsource/black-ops-one/latin-400.css";
import "@fontsource/teko/latin-600.css";
import "@fontsource/kanit/latin-800.css";
import "@fontsource/archivo-black/latin-400.css";
import "@fontsource/bungee/latin-400.css";
import "@fontsource/righteous/latin-400.css";
import "@fontsource/fredoka/latin-700.css";
import "@fontsource/caveat/latin-700.css";
import "@fontsource/dancing-script/latin-700.css";
import "@fontsource/lobster/latin-400.css";
import "@fontsource/abril-fatface/latin-400.css";
import "@fontsource/great-vibes/latin-400.css";
import type { AnimRef, CaptionClip, TextClip, TextStyle, Track, Us } from "../data/db";
import { animatedAt } from "./keyframes";
import { captionPreset, type CaptionPreset, type WordHighlight } from "./presets";

// Open fonts shipped with the app (OFL / Apache), latin subset only.
export const FONTS: { id: string; label: string; family: string; weight: number }[] = [
  { id: "montserrat", label: "Montserrat", family: "Montserrat", weight: 800 },
  { id: "inter", label: "Inter", family: "Inter", weight: 700 },
  { id: "bebas", label: "Bebas", family: "Bebas Neue", weight: 400 },
  { id: "anton", label: "Anton", family: "Anton", weight: 400 },
  { id: "oswald", label: "Oswald", family: "Oswald", weight: 700 },
  { id: "pacifico", label: "Pacifico", family: "Pacifico", weight: 400 },
  { id: "marker", label: "Marker", family: "Permanent Marker", weight: 400 },
  { id: "poppins", label: "Poppins", family: "Poppins", weight: 800 },
  { id: "lilita", label: "Lilita", family: "Lilita One", weight: 400 },
  { id: "luckiest", label: "Luckiest", family: "Luckiest Guy", weight: 400 },
  { id: "dmserif", label: "Serifa", family: "DM Serif Display", weight: 400 },
  { id: "playfair", label: "Playfair", family: "Playfair Display", weight: 800 },
  { id: "black", label: "Montserrat Black", family: "Montserrat", weight: 900 },
  { id: "bangers", label: "Bangers", family: "Bangers", weight: 400 },
  { id: "chewy", label: "Chewy", family: "Chewy", weight: 400 },
  // racing, tech and title faces for car videos, then handwriting
  { id: "racing", label: "Racing", family: "Racing Sans One", weight: 400 },
  { id: "orbitron", label: "Orbitron", family: "Orbitron", weight: 900 },
  { id: "audiowide", label: "Audiowide", family: "Audiowide", weight: 400 },
  { id: "russo", label: "Russo", family: "Russo One", weight: 400 },
  { id: "blackops", label: "Black Ops", family: "Black Ops One", weight: 400 },
  { id: "teko", label: "Teko", family: "Teko", weight: 600 },
  { id: "kanit", label: "Kanit", family: "Kanit", weight: 800 },
  { id: "archivo", label: "Archivo Black", family: "Archivo Black", weight: 400 },
  { id: "bungee", label: "Bungee", family: "Bungee", weight: 400 },
  { id: "righteous", label: "Righteous", family: "Righteous", weight: 400 },
  { id: "fredoka", label: "Fredoka", family: "Fredoka", weight: 700 },
  { id: "caveat", label: "Caveat", family: "Caveat", weight: 700 },
  { id: "dancing", label: "Dancing", family: "Dancing Script", weight: 700 },
  { id: "lobster", label: "Lobster", family: "Lobster", weight: 400 },
  { id: "abril", label: "Abril", family: "Abril Fatface", weight: 400 },
  { id: "vibes", label: "Great Vibes", family: "Great Vibes", weight: 400 },
];

export function fontOf(id: string) {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

// Canvas text only uses a web font once it has loaded.
let fontsReady: Promise<unknown> | null = null;
export function loadFonts() {
  fontsReady ??= Promise.all([
    ...FONTS.map((f) => document.fonts.load(`${f.weight} 48px "${f.family}"`)),
    document.fonts.load(`italic 800 48px "Montserrat"`),
    document.fonts.load(`italic 800 48px "Poppins"`),
    document.fonts.load(`italic 800 48px "Playfair Display"`),
    document.fonts.load(`italic 900 48px "Montserrat"`),
  ]);
  return fontsReady;
}

// Captions: bold, white with a dark outline, readable over any video.
export const CAPTION_STYLE: TextStyle = {
  font: "montserrat",
  size: 56,
  color: "#ffffff",
  stroke: { color: "#000000", width: 10 },
  shadow: null,
  background: null,
  align: "center",
  bold: true,
  italic: false,
};
export const CAPTION_Y = 0.78; // a little above the bottom, clear of app UI on Reels/TikTok

export const TEXT_COLORS = ["#ffffff", "#000000", "#ffd400", "#ff3b30", "#ff9500", "#34c759", "#0a84ff", "#bf5af2", "#ff2d92"];

export const DEFAULT_TEXT_US: Us = 3_000_000;

// Stickers are emoji text items: big, no outline or shadow.
export const STICKERS = [
  "🔥", "😂", "❤️", "👍", "💯", "✨", "🎉", "😍", "😮", "👀", "⚡", "💰",
  "📞", "📶", "🚀", "🏠", "🎮", "💡", "🏆", "⚠️", "🙏", "😎", "🤩", "🥳",
  "👇", "👉", "👆", "✅", "❌", "⭐", "📢", "🛒", "🎁", "📱", "💻", "🤑",
  "😱", "🤯", "😭", "🥰", "😡", "🤔", "👏", "💪", "🙌", "🎯", "📈", "🆕",
];
export const STICKER_STYLE: TextStyle = {
  font: "montserrat",
  size: 200,
  color: "#ffffff",
  stroke: null,
  shadow: null,
  background: null,
  align: "center",
  bold: false,
  italic: false,
};

export const DEFAULT_STYLE: TextStyle = {
  font: "montserrat",
  size: 72, // px for a 1080-wide frame; scales with the frame
  color: "#ffffff",
  stroke: null,
  shadow: { color: "#000000", blur: 12, x: 0, y: 4 },
  background: null,
  align: "center",
  bold: true,
  italic: false,
};

// Our own animation presets. "in" plays at the start, "out" at the end.
export const ANIMS_IN = [
  { id: "fade", label: "Surgir" },
  { id: "slide-up", label: "Subir" },
  { id: "pop", label: "Pular" },
  { id: "typewriter", label: "Digitar" },
  { id: "blur", label: "Desfocar" },
];
export const ANIMS_OUT = [
  { id: "fade", label: "Sumir" },
  { id: "slide-down", label: "Descer" },
  { id: "pop", label: "Encolher" },
];
// "loop" plays over and over for as long as the item shows (stickers, mostly).
export const ANIMS_LOOP = [
  { id: "pulse", label: "Pulsar" },
  { id: "bounce", label: "Quicar" },
  { id: "wobble", label: "Balançar" },
  { id: "spin", label: "Girar" },
  { id: "blink", label: "Piscar" },
];
export const LOOP_US: Us = 1_000_000;
export const ANIM_US: Us = 500_000;

const ease = (t: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);

interface AnimState {
  alpha: number;
  dy: number; // fraction of the font size
  scale: number;
  chars: number; // 0..1 of the text shown
  blur: number; // 0..1, out of focus
  rot: number; // degrees
}

const STILL: AnimState = { alpha: 1, dy: 0, scale: 1, chars: 1, blur: 0, rot: 0 };

function animState(clip: TextClip, localUs: Us): AnimState {
  const s: AnimState = { ...STILL };
  const apply = (a: AnimRef | null, p: number, entering: boolean) => {
    if (!a) return;
    const k = ease(p); // 0 = hidden, 1 = fully shown
    if (a.id === "fade") s.alpha *= k;
    else if (a.id === "slide-up") {
      s.alpha *= k;
      s.dy += (1 - k) * 0.8;
    } else if (a.id === "slide-down") {
      s.alpha *= k;
      s.dy += (1 - k) * 0.8;
    } else if (a.id === "pop") {
      s.alpha *= Math.min(1, k * 2);
      s.scale *= entering ? 0.4 + 0.6 * k + Math.sin(k * Math.PI) * 0.15 : 0.4 + 0.6 * k;
    } else if (a.id === "typewriter") s.chars = Math.min(s.chars, p);
    else if (a.id === "blur") {
      s.alpha *= Math.min(1, 0.3 + k);
      s.blur = Math.max(s.blur, 1 - k);
    }
  };
  const { in: aIn, out: aOut, loop } = clip.animation;
  if (loop) {
    const ph = (localUs / (loop.durationUs || LOOP_US)) % 1;
    const wave = Math.sin(ph * Math.PI * 2);
    if (loop.id === "pulse") s.scale *= 1 + 0.08 * wave;
    else if (loop.id === "bounce") s.dy -= Math.abs(Math.sin(ph * Math.PI)) * 0.35;
    else if (loop.id === "wobble") s.rot += 8 * wave;
    else if (loop.id === "spin") s.rot += ph * 360;
    else if (loop.id === "blink") s.alpha *= ph < 0.5 ? 1 : 0.15;
  }
  if (aIn) apply(aIn, localUs / aIn.durationUs, true);
  if (aOut) apply(aOut, (clip.durationUs - localUs) / aOut.durationUs, false);
  return s;
}

export interface TextBox {
  cx: number; // centre, frame pixels
  cy: number;
  w: number; // unrotated size, frame pixels
  h: number;
  rotation: number; // degrees
}

function fontCss(style: TextStyle, px: number) {
  const f = fontOf(style.font);
  return `${style.italic ? "italic " : ""}${f.weight} ${px}px "${f.family}"`;
}

const EMOJI_FONT = `"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;

// How a caption's words are laid out and coloured, from its template, at
// one moment: which word is being spoken and how long ago each one started.
export interface CaptionLook {
  index: number; // the word being spoken
  sinceUs: number[]; // per word: time since it was spoken (negative = not yet)
  highlight: WordHighlight | null;
  reveal?: boolean; // hide the words not spoken yet
  wordPop?: boolean; // each word pops in as it is spoken
  future?: string; // colour of the words not spoken yet
  colors?: string[]; // per word, by position
  scales?: number[];
  perLine?: number; // words per line (1 = stacked)
  stagger?: number[]; // per line, sideways shift in font sizes
  align?: "left" | "center" | "right";
  emoji?: string | null; // drawn above the caption
  cursor?: boolean; // a typing cursor after the last letter
}

// Draws one text item onto a frame of size W×H at local time localUs (from
// the item's start). Returns its box for hit-testing, or null if hidden.
// animate=false draws it fully shown: the paused preview, so a text sitting
// at the start of its entrance animation is still visible while you edit.
export type DrawableText = TextClip & { look?: CaptionLook };

export function drawText(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  clip: DrawableText,
  W: number,
  H: number,
  localUs: Us,
  animate = true,
): TextBox | null {
  const st = clip.style;
  const look = clip.look;
  const anim = animate ? animState(clip, localUs) : STILL;
  const unit = Math.min(W, H) / 1080;
  const k0 = clip.transform.scale;
  const px = Math.max(4, st.size * unit * k0);
  const shape = (t: string) => (st.uppercase ? t.toLocaleUpperCase("pt-BR") : t);
  const full = shape(clip.text || " ");
  const shown = anim.chars < 1 ? full.slice(0, Math.ceil(full.length * anim.chars)) : full;

  ctx.save();
  ctx.font = fontCss(st, px);
  const space = ctx.measureText(" ").width;

  // lines of words; captions may re-flow the words by their template
  type Word = { text: string; index: number; scale: number; width: number };
  type Line = { words: Word[]; width: number; height: number; dx: number };
  let rows: string[][];
  if (look?.perLine) {
    const all = full.split(/\s+/).filter(Boolean);
    rows = [];
    for (let i = 0; i < all.length; i += look.perLine) rows.push(all.slice(i, i + look.perLine));
  } else rows = full.split("\n").map((l) => (look ? l.split(" ").filter(Boolean) : [l]));
  let n = 0;
  const lines: Line[] = rows.map((row, li) => {
    let height = 0;
    const words = row.map((text) => {
      const index = n++;
      let scale = look?.scales?.length ? look.scales[index % look.scales.length] : 1;
      if (look?.highlight?.scale && index === look.index) scale *= look.highlight.scale;
      if (scale !== 1) ctx.font = fontCss(st, px * scale);
      const width = ctx.measureText(text || " ").width;
      if (scale !== 1) ctx.font = fontCss(st, px);
      height = Math.max(height, px * scale * 1.18);
      return { text, index, scale, width };
    });
    const width = words.reduce((a, w) => a + w.width, 0) + space * Math.max(0, words.length - 1);
    const dx = look?.stagger?.length ? look.stagger[li % look.stagger.length] * px : 0;
    return { words, width, height: height || px * 1.18, dx };
  });
  const pad = st.background ? st.background.padding * unit * k0 : 0;
  const w = Math.max(...lines.map((l) => l.width + Math.abs(l.dx) * 2)) + pad * 2;
  const h = lines.reduce((a, l) => a + l.height, 0) + pad * 2;
  const cx = clip.transform.x * W;
  const cy = clip.transform.y * H;
  const box: TextBox = { cx, cy, w, h, rotation: clip.transform.rotation };

  const alpha = clip.opacity * anim.alpha;
  if (alpha <= 0.001) {
    ctx.restore();
    return box;
  }
  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy + anim.dy * px);
  ctx.rotate(((clip.transform.rotation + anim.rot) * Math.PI) / 180);
  ctx.scale(anim.scale, anim.scale);

  if (st.background) {
    ctx.fillStyle = st.background.color;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, st.background.radius * unit * k0);
    ctx.fill();
  }

  // one run of text with every layer of the style: glow, shadow, outline, fill
  const paint = (t: string, x: number, y: number, color: string, size: number) => {
    const fill = () => {
      if (st.gradient?.length && color === st.color) {
        const g = ctx.createLinearGradient(0, y - size * 0.45, 0, y + size * 0.45);
        st.gradient.forEach((c, i) => g.addColorStop(i / Math.max(1, st.gradient!.length - 1), c));
        ctx.fillStyle = g;
      } else ctx.fillStyle = color;
    };
    if (anim.blur > 0.02) {
      // out of focus: draw only the shadow, moved back under the text (a
      // canvas blur filter is missing in some Safari versions)
      const m = ctx.getTransform();
      ctx.shadowColor = color;
      ctx.shadowBlur = anim.blur * size * 0.5 * Math.hypot(m.a, m.b);
      ctx.shadowOffsetX = m.a * 10000;
      ctx.shadowOffsetY = m.b * 10000;
      ctx.fillStyle = color;
      ctx.fillText(t, x - 10000, y);
      ctx.shadowColor = "transparent";
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      return;
    }
    if (st.glow) {
      ctx.shadowColor = st.glow.color;
      ctx.shadowBlur = st.glow.blur * unit;
      ctx.fillStyle = st.glow.color;
      ctx.fillText(t, x, y);
      ctx.fillText(t, x, y);
    }
    if (st.shadow && !st.background) {
      ctx.shadowColor = st.shadow.color;
      ctx.shadowBlur = st.shadow.blur * unit;
      ctx.shadowOffsetX = st.shadow.x * unit;
      ctx.shadowOffsetY = st.shadow.y * unit;
    } else ctx.shadowColor = "transparent";
    if (st.stroke) {
      ctx.lineJoin = "round";
      ctx.lineWidth = st.stroke.width * unit * k0 * (size / px);
      ctx.strokeStyle = st.stroke.color;
      ctx.strokeText(t, x, y);
      ctx.shadowColor = "transparent";
    }
    fill();
    ctx.fillText(t, x, y);
    ctx.shadowColor = "transparent";
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
  };

  ctx.textBaseline = "middle";
  const align = look?.align ?? st.align;
  const xStart = (lw: number) => (align === "left" ? -w / 2 + pad : align === "right" ? w / 2 - pad - lw : -lw / 2);
  let y = -h / 2 + pad;

  if (!look) {
    ctx.textAlign = st.align;
    const shownLines = shown.split("\n");
    lines.forEach((l, i) => {
      y += l.height / 2;
      paint(shownLines[i] ?? "", st.align === "left" ? -w / 2 + pad : st.align === "right" ? w / 2 - pad : 0, y, st.color, px);
      y += l.height / 2;
    });
  } else {
    // word by word, so each word can have its own colour, size and timing
    ctx.textAlign = "left";
    let charsLeft = anim.chars < 1 ? shown.length : Infinity;
    let end: { x: number; y: number; size: number } | null = null;
    for (const l of lines) {
      y += l.height / 2;
      let x = xStart(l.width) + l.dx;
      for (const word of l.words) {
        const i = word.index;
        const on = i === look.index;
        const since = look.sinceUs[i] ?? 0;
        const visible = !((look.reveal || look.wordPop) && since < 0) && charsLeft > 0;
        const text = charsLeft < word.text.length ? word.text.slice(0, charsLeft) : word.text;
        charsLeft -= word.text.length + 1;
        if (visible) {
          const size = px * word.scale;
          ctx.font = fontCss(st, size);
          ctx.save();
          if (look.wordPop && since < 180_000) {
            const k = ease(since / 180_000);
            const cxw = x + word.width / 2;
            ctx.translate(cxw, y);
            ctx.scale(0.3 + 0.7 * k + Math.sin(k * Math.PI) * 0.15, 0.3 + 0.7 * k + Math.sin(k * Math.PI) * 0.15);
            ctx.translate(-cxw, -y);
            ctx.globalAlpha *= Math.min(1, k * 2);
          }
          const hl = look.highlight;
          if (on && hl?.box) {
            const b = hl.box;
            const bp = b.padding * unit * k0 * word.scale;
            const bh = size * 1.12 + bp;
            ctx.beginPath();
            ctx.roundRect(x - bp, y - bh / 2, word.width + bp * 2, bh, b.radius * unit * k0);
            if (b.color !== "transparent") {
              ctx.fillStyle = b.color;
              ctx.fill();
            }
            if (b.border) {
              ctx.lineWidth = 4 * unit * k0;
              ctx.strokeStyle = b.border;
              ctx.stroke();
            }
          }
          const color =
            on && hl?.color
              ? hl.color
              : look.future && since < 0
                ? look.future
                : look.colors?.length
                  ? look.colors[i % look.colors.length]
                  : st.color;
          paint(text, x, y, color, size);
          ctx.restore();
          ctx.font = fontCss(st, px);
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          end = { x: x + ctx.measureText(text).width * word.scale, y, size };
        }
        x += word.width + space;
      }
      y += l.height / 2;
    }
    if (look.cursor && end && (anim.chars < 1 || Math.floor(localUs / 450_000) % 2 === 0)) {
      ctx.fillStyle = st.color;
      ctx.fillRect(end.x + end.size * 0.06, end.y - end.size * 0.5, end.size * 0.42, end.size);
    }
    if (look.emoji) {
      ctx.textAlign = "center";
      ctx.font = `${px * 1.1}px ${EMOJI_FONT}`;
      ctx.fillText(look.emoji, 0, -h / 2 - px * 0.7);
    }
  }
  ctx.restore();
  return box;
}

// A caption drawn like a text item, in its track's style.
export function captionAsText(c: CaptionClip, style: TextStyle | undefined): TextClip {
  return {
    id: c.id,
    type: "text",
    text: c.text,
    style: style ?? CAPTION_STYLE,
    startUs: c.startUs,
    durationUs: c.durationUs,
    transform: c.transform,
    opacity: c.opacity,
    blendMode: c.blendMode,
    animation: c.animation,
    keyframes: c.keyframes,
  };
}

// Every text item and caption visible at timeline time tUs, bottom track first.
export function textsAt(tracks: Track[], tUs: Us): DrawableText[] {
  const out: DrawableText[] = [];
  for (const t of tracks) {
    if ((t.kind !== "text" && t.kind !== "caption") || t.hidden) continue;
    for (const c of t.items) {
      if (tUs < c.startUs || tUs >= c.startUs + c.durationUs) continue;
      if (c.type === "text") out.push(c.keyframes.length ? { ...c, ...animatedAt(c, tUs - c.startUs) } : c);
      else if (c.type === "caption") out.push(captionDrawable(c, t.style, t.preset, tUs - c.startUs));
    }
  }
  return out;
}

// Small word -> emoji list for the emoji templates (Portuguese and English).
const EMOJIS: [RegExp, string][] = [
  [/^(dinheiro|grana|lucro|pre[cç]o|r\$|money|cash)/i, "💰"],
  [/^(amor|amo|cora[cç][aã]o|love)/i, "❤️"],
  [/^(fogo|quente|incr[ií]vel|top|fire|hot)/i, "🔥"],
  [/^(rir|risada|engra[cç]ad|kkk|haha)/i, "😂"],
  [/^(internet|wi-?fi|conex|fibra|velocidade|r[aá]pid|mega|giga)/i, "⚡"],
  [/^(ligue|liga|telefone|whats|contato|chama)/i, "📞"],
  [/^(casa|lar|home)/i, "🏠"],
  [/^(jogo|jogar|game|gamer)/i, "🎮"],
  [/^(dica|ideia|idea)/i, "💡"],
  [/^(sucesso|ganh|venc|win)/i, "🏆"],
  [/^(aten[cç][aã]o|cuidado|alerta)/i, "⚠️"],
  [/^(feliz|alegr|happy)/i, "😄"],
  [/^(obrigad|valeu|thanks)/i, "🙏"],
];
export function emojiFor(text: string, fallback: string | null): string | null {
  for (const w of text.split(/\s+/)) {
    const clean = w.replace(/[^\p{L}\p{N}$-]/gu, "");
    for (const [re, e] of EMOJIS) if (re.test(clean)) return e;
  }
  return fallback;
}

// A caption at localUs from its start, laid out by its template.
export function captionDrawable(c: CaptionClip, style: TextStyle | undefined, presetId: string | undefined, localUs: Us): DrawableText {
  const item: DrawableText = captionAsText(c, style);
  const p: CaptionPreset = captionPreset(presetId);
  const words = c.words.length ? c.words : c.text.split(/\s+/).filter(Boolean).map(() => ({ startUs: 0, endUs: c.durationUs, word: "" }));
  let index = 0;
  words.forEach((w, i) => {
    if (localUs >= w.startUs) index = i;
  });
  item.look = {
    index: p.highlight || p.future || p.reveal || p.wordPop ? index : -1,
    sinceUs: words.map((w) => localUs - w.startUs),
    highlight: p.highlight,
    reveal: p.reveal,
    wordPop: p.wordPop,
    future: p.future,
    colors: p.wordColors,
    scales: p.wordScales,
    perLine: p.layout?.perLine,
    stagger: p.layout?.stagger,
    align: p.layout?.align,
    emoji: p.emoji ? emojiFor(c.text, p.emoji) : null,
    cursor: p.cursor,
  };
  return item;
}

// Is a frame point inside a (rotated) text box?
export function hitBox(b: TextBox, x: number, y: number, slack = 0) {
  const a = (-b.rotation * Math.PI) / 180;
  const dx = x - b.cx;
  const dy = y - b.cy;
  const rx = dx * Math.cos(a) - dy * Math.sin(a);
  const ry = dx * Math.sin(a) + dy * Math.cos(a);
  return Math.abs(rx) <= b.w / 2 + slack && Math.abs(ry) <= b.h / 2 + slack;
}
