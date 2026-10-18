import { describe, expect, it } from "vitest";
import { wavFile } from "./tts";

describe("text to speech output", () => {
  it("is a 16-bit mono WAV of the samples", async () => {
    const f = wavFile(new Float32Array([0, 1, -1, 0.5]), 16_000, "Voz.wav");
    const v = new DataView(await f.arrayBuffer());
    expect(f.size).toBe(44 + 8);
    expect(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3))).toBe("RIFF");
    expect([v.getUint16(22, true), v.getUint32(24, true), v.getUint16(34, true)]).toEqual([1, 16_000, 16]);
    expect([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true), v.getInt16(50, true)]).toEqual([0, 32767, -32767, 16383]);
  });
});
