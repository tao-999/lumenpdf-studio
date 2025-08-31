// 内存仓库：id -> Uint8Array
const blobs = new Map<string, Uint8Array>();

function uuid() {
  // Tauri 环境有 crypto.randomUUID；兜个底
  return (globalThis.crypto?.randomUUID?.() ||
    ("id_" + Date.now().toString(36) + Math.random().toString(36).slice(2)));
}

export type PdfSlot = { id: string; name: string; size: number };

export function putBlob(name: string, bytes: Uint8Array): PdfSlot {
  const id = uuid();
  blobs.set(id, bytes);
  return { id, name, size: bytes.byteLength };
}

export function getBlob(id: string): Uint8Array | undefined {
  return blobs.get(id);
}

export function removeBlob(id: string) {
  blobs.delete(id);
}

export function toInvokePayload(ids: string[], names: string[]) {
  // 把 Uint8Array 转成 number[] 以便 invoke 传输（Serde 接 byte 数组）
  return ids.map((id, i) => {
    const u8 = blobs.get(id);
    if (!u8) throw new Error(`缓存缺失：${id}`);
    // 注意：这里会复制一份内存（IPC需要），大文件合并时没问题，就这一步最慢
    return { name: names[i], data: Array.from(u8) };
  });
}
