// 处理 SharedArrayBuffer -> Blob，避免 TS 报错
export function u8ToBlob(u8: Uint8Array, mime?: string) {
  const buf = u8.buffer as ArrayBuffer | SharedArrayBuffer;
  let ab: ArrayBuffer;
  if (buf instanceof ArrayBuffer) {
    ab = (u8.byteOffset === 0 && u8.byteLength === buf.byteLength)
      ? buf
      : buf.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
  } else {
    ab = new ArrayBuffer(u8.byteLength);
    new Uint8Array(ab).set(u8);
  }
  return new Blob([ab], { type: mime });
}

export function sniffMime(u8: Uint8Array): string {
  if (u8.length >= 4 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4E && u8[3] === 0x47) return "image/png";
  if (u8.length >= 2 && u8[0] === 0xFF && u8[1] === 0xD8) return "image/jpeg";
  if (u8.length >= 12 && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 &&
      u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50) return "image/webp";
  return "application/octet-stream";
}
