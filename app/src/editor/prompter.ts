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
  quality: 720 | 1080 | 2160;
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
  quality: 1080,
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
export const loadSettings = (): PrompterSettings => ({ ...DEFAULT_SETTINGS, ...read<Partial<PrompterSettings>>(SETTINGS, {}) });
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
