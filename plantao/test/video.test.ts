import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractFrames } from "../src/media/video.js";

const hasFfmpeg = (() => {
  try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); return true; } catch { return false; }
})();

describe.skipIf(!hasFfmpeg)("quadros de vídeo", () => {
  it("extrai no máximo 8 quadros JPEG de um vídeo de 12s", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "vid-"));
    const file = path.join(dir, "v.mp4");
    execFileSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=12:size=320x240:rate=10", "-pix_fmt", "yuv420p", file]);
    const frames = await extractFrames(readFileSync(file));
    expect(frames).toHaveLength(8);
    expect(frames[0].mimeType).toBe("image/jpeg");
    expect(frames[0].data.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  });
});
