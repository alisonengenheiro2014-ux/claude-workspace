// Extrai quadros de um vídeo com ffmpeg, para a análise de imagem pegar luz piscando.
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function extractFrames(
  video: Buffer,
  opts: { fps?: number; maxFrames?: number; maxSeconds?: number } = {},
): Promise<{ data: Buffer; mimeType: string }[]> {
  const { fps = 1, maxFrames = 8, maxSeconds = 60 } = opts;
  const dir = await mkdtemp(path.join(tmpdir(), "frames-"));
  try {
    const input = path.join(dir, "in");
    await writeFile(input, video);
    await new Promise<void>((resolve, reject) => {
      const ff = spawn("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-t", String(maxSeconds), "-i", input,
        "-vf", `fps=${fps},scale=1024:-2`,
        "-frames:v", String(maxFrames),
        path.join(dir, "f%02d.jpg"),
      ]);
      let err = "";
      ff.stderr.on("data", (d) => (err += d));
      ff.on("error", reject);
      ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg saiu com ${code}: ${err}`))));
    });
    const frames = (await readdir(dir)).filter((f) => f.endsWith(".jpg")).sort();
    return Promise.all(frames.map(async (f) => ({ data: await readFile(path.join(dir, f)), mimeType: "image/jpeg" })));
  } finally {
    // o vídeo do cliente não fica guardado (LGPD)
    await rm(dir, { recursive: true, force: true });
  }
}
