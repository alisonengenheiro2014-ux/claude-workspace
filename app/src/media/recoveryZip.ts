// ZIP (store method, no recompression) generated from original OPFS Files.
// Never materializes all videos in JavaScript memory. Both ZIP data and
// CRC-32 are produced incrementally from each source's ReadableStream.
// Classic ZIP uses 32-bit offsets; reject >4 GB rather than generate corrupt ZIP.
export interface RecoveryZipEntry { name: string; file: Blob; modifiedAt?: number }
export interface ZipProgress { readBytes: number; totalBytes: number; index: number; files: number }
type Append = (chunk: Uint8Array) => void | Promise<void>;

const encoder = new TextEncoder();
const MAX_U32 = 0xffffffff;
const crcTable = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  crcTable[i] = c >>> 0;
}

export function zipCrc32(data: Uint8Array, previous = 0xffffffff) {
  let crc = previous;
  for (let i = 0; i < data.length; i++)
    crc = crcTable[(crc ^ data[i]) & 255] ^ (crc >>> 8);
  return crc >>> 0;
}

export function sanitizeZipName(name: string) {
  const clean = name.replace(/[\\/\0\r\n:<>|?*"\u0000-\u001f]/g, "_").replace(/^\.+/, "_").trim();
  return clean.slice(0, 180) || "arquivo";
}
export function recoveryZipEntries(files: Array<{ name: string; project: string; file: File; status: string }>): RecoveryZipEntry[] {
  return files.map((item, i) => ({
    // Prefix index because separate projects sometimes contain same original filename.
    name: String(i + 1).padStart(2, "0") + "_" +
      (item.status === "partial" ? "POSSIVEL_PARCIAL_" : "") +
      sanitizeZipName(item.project).slice(0, 65) + "__" +
      sanitizeZipName(item.name).slice(0, 100),
    file: item.file,
    modifiedAt: item.file.lastModified,
  }));
}
function encodedNames(entries: RecoveryZipEntry[]) {
  return entries.map((e) => encoder.encode(sanitizeZipName(e.name)));
}
export function estimateZipSize(entries: RecoveryZipEntry[]) {
  const names = encodedNames(entries);
  let size = 22; // EOCD
  if (entries.length > 65535) throw new Error("Há mais arquivos que um ZIP clássico suporta.");
  for (let i = 0; i < entries.length; i++) {
    if (names[i].length > 65535 || entries[i].file.size > MAX_U32) throw new Error("Arquivo grande demais para o formato ZIP.");
    size += entries[i].file.size + 30 + names[i].length + 16 + 46 + names[i].length;
  }
  if (size > MAX_U32) throw new Error("O conjunto ultrapassa 4 GB. Divida o resgate em lotes.");
  return size;
}
function put16(v: DataView, offset: number, n: number) { v.setUint16(offset, n, true); }
function put32(v: DataView, offset: number, n: number) { v.setUint32(offset, n >>> 0, true); }
function dosDateTime(ms: number) {
  const d = new Date(ms || Date.now());
  const year = Math.min(2107, Math.max(1980, d.getFullYear()));
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}
function header(length: number) {
  const bytes = new Uint8Array(length);
  return { bytes, view: new DataView(bytes.buffer) };
}

export async function writeRecoveryZip(
  entries: RecoveryZipEntry[],
  append: Append,
  onProgress?: (progress: ZipProgress) => void,
) {
  const size = estimateZipSize(entries);
  const names = encodedNames(entries);
  const central: Uint8Array[] = [];
  const totalBytes = entries.reduce((sum, e) => sum + e.file.size, 0);
  let readBytes = 0, position = 0;
  const push = async (bytes: Uint8Array) => { await append(bytes); position += bytes.length; };
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const name = names[index];
    const offset = position;
    const when = dosDateTime(entry.modifiedAt ?? Date.now());
    const local = header(30);
    put32(local.view, 0, 0x04034b50);
    put16(local.view, 4, 20); // version needed
    put16(local.view, 6, 0x0808); // UTF8 + trailing CRC descriptor
    put16(local.view, 8, 0); // store, no video recompression
    put16(local.view, 10, when.time);
    put16(local.view, 12, when.date);
    put16(local.view, 26, name.length);
    await push(local.bytes);
    await push(name);
    let crc = 0xffffffff;
    let count = 0;
    const reader = entry.file.stream().getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value?.length) continue;
        crc = zipCrc32(value, crc);
        count += value.byteLength;
        readBytes += value.byteLength;
        if (count > entry.file.size) throw new Error("Arquivo mudou durante a cópia ZIP.");
        await push(value);
        onProgress?.({ readBytes, totalBytes, index, files: entries.length });
      }
    } finally { reader.releaseLock(); }
    if (count !== entry.file.size) throw new Error("Arquivo incompleto durante a criação do ZIP: " + entry.name);
    crc = (crc ^ 0xffffffff) >>> 0;
    const descriptor = header(16);
    put32(descriptor.view, 0, 0x08074b50);
    put32(descriptor.view, 4, crc);
    put32(descriptor.view, 8, count);
    put32(descriptor.view, 12, count);
    await push(descriptor.bytes);
    const cd = header(46 + name.length);
    put32(cd.view, 0, 0x02014b50);
    put16(cd.view, 4, 20);
    put16(cd.view, 6, 20);
    put16(cd.view, 8, 0x0808);
    put16(cd.view, 10, 0);
    put16(cd.view, 12, when.time);
    put16(cd.view, 14, when.date);
    put32(cd.view, 16, crc);
    put32(cd.view, 20, count);
    put32(cd.view, 24, count);
    put16(cd.view, 28, name.length);
    put32(cd.view, 42, offset);
    cd.bytes.set(name, 46);
    central.push(cd.bytes);
  }
  const centralStart = position;
  for (const cd of central) await push(cd);
  const centralSize = position - centralStart;
  const eocd = header(22);
  put32(eocd.view, 0, 0x06054b50);
  put16(eocd.view, 8, entries.length);
  put16(eocd.view, 10, entries.length);
  put32(eocd.view, 12, centralSize);
  put32(eocd.view, 16, centralStart);
  await push(eocd.bytes);
  if (position !== size) throw new Error("Tamanho do ZIP divergente: " + position + " de " + size + " bytes.");
  return { size, files: entries.length };
}
