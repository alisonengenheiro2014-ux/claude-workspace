import { describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import {
  estimateZipSize, recoveryZipEntries, sanitizeZipName, writeRecoveryZip, zipCrc32,
  type RecoveryZipEntry,
} from "./recoveryZip";

const filename = "/tmp/garagem-edits-resgate-fixture-20261125.zip";

async function generate(entries: RecoveryZipEntry[]) {
  const chunks: Uint8Array[] = [];
  const reports: number[] = [];
  const report = await writeRecoveryZip(entries, (chunk) => {
    chunks.push(chunk.slice());
  }, (progress) => reports.push(progress.readBytes));
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const buffer = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
  expect(report.size).toBe(estimateZipSize(entries));
  expect(buffer.length).toBe(report.size);
  return { buffer, reports };
}

describe("ZIP recuperável de todos os vídeos", () => {
  it("calculates the standard CRC-32", () => {
    const crc = zipCrc32(new TextEncoder().encode("123456789")) ^ 0xffffffff;
    expect(crc >>> 0).toBe(0xcbf43926);
  });
  it("keeps original files separate even with identical names from different projects", () => {
    const demo = new File(["dados"], "Teleprompter.mp4", { type: "video/mp4" });
    const entries = recoveryZipEntries([
      { name: demo.name, project: "Projeto 08:51", file: demo, status: "complete" },
      { name: demo.name, project: "Projeto 08:36", file: demo, status: "complete" },
      { name: demo.name, project: "Projeto 08:34", file: demo, status: "partial" },
    ]);
    expect(entries.map((i) => i.name)).toEqual([
      "01_Projeto 08_51__Teleprompter.mp4",
      "02_Projeto 08_36__Teleprompter.mp4",
      "03_POSSIVEL_PARCIAL_Projeto 08_34__Teleprompter.mp4",
    ]);
    expect(new Set(entries.map((i) => i.name)).size).toBe(3);
    expect(sanitizeZipName("../malicioso.mp4")).not.toContain("/");
  });
  it("writes a complete ZIP with UTF-8 names and correct CRC and descriptor", async () => {
    const entries: RecoveryZipEntry[] = [
      { name: "01_Projeto 25-11 08_51__Vídeo.mp4", file: new Blob(["VIDEO123456789"]) },
      { name: "02_Projeto 25-11 08_36__Vídeo.mp4", file: new Blob([new Uint8Array([0, 1, 255, 0, 57])]) },
    ];
    const { buffer, reports } = await generate(entries);
    expect(reports.at(-1)).toBe(entries.reduce((t, e) => t + e.file.size, 0));
    const view = new DataView(buffer.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const eocd = buffer.length - 22;
    expect(view.getUint32(eocd, true)).toBe(0x06054b50);
    expect(view.getUint16(eocd + 10, true)).toBe(2);
    const cdPos = view.getUint32(eocd + 16, true);
    expect(view.getUint32(cdPos, true)).toBe(0x02014b50);
    const firstNameLength = view.getUint16(26, true);
    const firstName = new TextDecoder().decode(buffer.slice(30, 30 + firstNameLength));
    expect(firstName).toBe(entries[0].name);
    expect(new TextDecoder().decode(buffer.slice(30 + firstNameLength, 30 + firstNameLength + 14))).toBe("VIDEO123456789");
    expect(view.getUint32(30 + firstNameLength + 14, true)).toBe(0x08074b50);
    writeFileSync(filename, buffer);
  });
  it("supports an empty file in an otherwise valid archive", async () => {
    const entries: RecoveryZipEntry[] = [{ name: "vazio.mp4", file: new Blob([]) }];
    const { buffer } = await generate(entries);
    expect(buffer.length).toBe(30 + "vazio.mp4".length + 16 + 46 + "vazio.mp4".length + 22);
  });
  it("rejects archive sizes exceeding classic ZIP bounds instead of truncating offsets", () => {
    const oversized = { name: "grande.mp4", file: { size: 0x100000000 } as Blob };
    expect(() => estimateZipSize([oversized])).toThrow(/grande demais/i);
  });
});
