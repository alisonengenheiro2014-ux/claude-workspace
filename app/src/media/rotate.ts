// A take filmed with the phone on its side (a gimbal held horizontally) while
// the app stays upright: its frames come out turned. This marks the file with
// the turn, as the iPhone's own camera does, copying the camera's frames as
// they are: no re-encoding, the quality stays exactly what the camera made.
// Written to the app's storage on disk (long 4K takes don't fit in memory),
// in memory where the browser has no such storage.
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, StreamTarget, type Rotation } from "mediabunny";
import { clearDir, openStreamFile, readFile } from "../data/opfs";

export async function rotateTake(file: File, rotate: Rotation): Promise<File> {
  if (!rotate) return file;
  const name = file.name.replace(/\.\w+$/, ".mp4");
  const path = `takes/${crypto.randomUUID()}.mp4`;
  let stream: WritableStream | null = null;
  try {
    stream = await openStreamFile(path);
  } catch {
    stream = null;
  }
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: stream ? false : "in-memory" }),
    target: stream ? new StreamTarget(stream, { chunked: true, chunkSize: 4 * 1024 * 1024 }) : new BufferTarget(),
  });
  try {
    const c = await Conversion.init({ input, output, video: { rotate, allowTransformationMetadata: true } });
    if (!c.isValid) return file; // can't be marked: keep the take as it was
    await c.execute();
    if (stream) {
      const f = await readFile(path);
      if (f) return new File([f], name, { type: "video/mp4" });
      return file;
    }
    const buf = (output.target as BufferTarget).buffer;
    return buf ? new File([buf], name, { type: "video/mp4" }) : file;
  } catch {
    return file;
  } finally {
    input.dispose();
  }
}

// takes of an earlier session are no longer needed (they were imported or dropped)
export const clearTakes = () => clearDir("takes").catch(() => {});
