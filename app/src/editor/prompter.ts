// Teleprompter: scripts (no length limit), settings, and the scroll pace.
// Kept in localStorage (a phone allows megabytes there: millions of
// characters); every read and write is guarded, so a full or blocked store
// never breaks recording.

export interface Script {
  id: string;
  title: string;
  text: string;
  updatedAt: number;
}

export interface PrompterSettings {
  speed: number; // 1..10, CapCut's scale: about 60..240 words a minute
  fontSize: number; // css px
  color: string;
  mirror: boolean; // text mirrored, for a teleprompter glass
  countdown: 0 | 3 | 5; // seconds before recording starts
  quality: 720 | 1080 | 2160; // asked of the camera; it gives the closest it really has
  fps: 30 | 60;
  // auto: the way the phone is held (upright: vertical; on its side: horizontal)
  format: "auto" | "vertical" | "horizontal";
  side: "left" | "right"; // horizontal without a motion sensor: where the top of the phone points
  boxHeight: number; // 0.25..0.7 of the screen
  boxOpacity: number; // 0.2..0.95, the dark box behind the text
  facing: "user" | "environment";
}

export const DEFAULT_SETTINGS: PrompterSettings = {
  speed: 5,
  fontSize: 30,
  color: "#ffffff",
  mirror: false,
  countdown: 3,
  quality: 2160, // the camera's best (4K on an iPhone Pro, front and back)
  fps: 30,
  format: "auto",
  side: "left",
  boxHeight: 0.38,
  boxOpacity: 0.55,
  facing: "user",
};

const SCRIPTS = "prompter-scripts";
const SETTINGS = "prompter-settings";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // full: the script stays in memory for this session
  }
}

export const loadScripts = () => read<Script[]>(SCRIPTS, []).sort((a, b) => b.updatedAt - a.updatedAt);
export const saveScripts = (s: Script[]) => write(SCRIPTS, s);
export function loadSettings(): PrompterSettings {
  // older versions kept a fixed format and hand-set picture turns: dropped,
  // the phone's own position decides now
  const { orientation: _o, turns: _t, ...saved } = read<Partial<PrompterSettings> & { orientation?: unknown; turns?: unknown }>(SETTINGS, {});
  const s = { ...DEFAULT_SETTINGS, ...saved };
  if (!["auto", "vertical", "horizontal"].includes(s.format)) s.format = "auto";
  return s;
}
export const saveSettings = (s: PrompterSettings) => write(SETTINGS, s);

// a title from the script's first words
export function titleOf(text: string) {
  const first = text.trim().split(/\s+/).slice(0, 6).join(" ");
  return first.length > 40 ? `${first.slice(0, 40)}…` : first || "Roteiro sem título";
}

export const wordsOf = (text: string) => (text.match(/\S+/g) ?? []).length;
export const wpmOf = (speed: number) => 60 + (Math.max(1, Math.min(10, speed)) - 1) * 20;

// How long reading the text takes at a speed, in seconds.
export function readingSeconds(text: string, speed: number) {
  return (wordsOf(text) / wpmOf(speed)) * 60;
}

// Scroll pace in px per second: the whole text height passes in the reading
// time, so the pace follows words, whatever the font size or line width.
export function pxPerSecond(textHeight: number, text: string, speed: number) {
  const secs = readingSeconds(text, speed);
  return secs > 0 ? textHeight / secs : 0;
}

// Recording format: H.264 mp4 where the browser makes it (iPhone, most
// Android phones), else VP8 webm. Not VP9: Chromium writes its VP9 level as
// 0, which decoders then refuse, so the take could not be edited.
export function recorderType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["video/mp4;codecs=avc1,mp4a.40.2", "video/mp4;codecs=avc1", "video/webm;codecs=vp8,opus", "video/webm"])
    if (MediaRecorder.isTypeSupported(t)) return t;
  return "";
}

export function videoBitrate(quality: PrompterSettings["quality"]) {
  return quality === 2160 ? 35_000_000 : quality === 1080 ? 12_000_000 : 6_000_000;
}

// The app stays upright, so with the phone on its side the controls turn
// to face the reader: 90° when the top of the phone points left.
export const uiTurn = (side: PrompterSettings["side"]) => (side === "left" ? 90 : -90);

// The frame being recorded: the camera's own pixels (never upscaled), wide
// for horizontal and tall for vertical, whichever shape the phone hands them in.
export function frameOf(srcW: number, srcH: number, horizontal: boolean) {
  const long = Math.max(srcW, srcH) & ~1;
  const short = Math.min(srcW, srcH) & ~1;
  return horizontal ? { w: long, h: short } : { w: short, h: long };
}

// How the camera's picture is turned into that frame. The app stays
// upright, so with the phone on its side the camera hands over a tall
// picture with the world lying across it: a quarter turn puts it back up.
// The back camera sees the world turned one way and the front camera (it
// looks the other way) the other way, so their turns are opposite. Pictures
// the phone already hands over wide are upright as they are.
export function pictureTurn(horizontal: boolean, srcWide: boolean, side: PrompterSettings["side"], facing: PrompterSettings["facing"]) {
  if (!horizontal || srcWide) return 0;
  const back = side === "left" ? 270 : 90;
  return facing === "user" ? (back + 180) % 360 : back;
}

export type Pose = "portrait" | "left" | "right";
// How the phone is held, from gravity (m/s², as accelerationIncludingGravity
// reports it): upright, or on its side with the top pointing left or right.
// sign: the sign gravity's y has when the phone is upright in this browser
// (WebKit reports the opposite of the spec). Flat or in between: null, the
// last pose holds.
export function poseOf(x: number, y: number, sign: number): Pose | null {
  if (Math.abs(y) > 6 && Math.abs(y) > Math.abs(x) * 1.5) return "portrait";
  if (Math.abs(x) > 6 && Math.abs(x) > Math.abs(y) * 1.5) return x * sign > 0 ? "left" : "right";
  return null;
}
