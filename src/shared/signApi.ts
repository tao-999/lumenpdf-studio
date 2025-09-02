// src/shared/signApi.ts
import { invoke } from "@tauri-apps/api/core";

export type SignExportResp = {
  path: string;
  bytesWritten: number; // ✅ 对齐后端 camelCase
  sha256: string;
  tookMs: number;
};

function u8ToB64(u8: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000; // 32KB
  for (let i = 0; i < u8.length; i += CHUNK) {
    const sub = u8.subarray(i, i + CHUNK);
    // 使用 apply + Array.from 避免参数过多
    binary += String.fromCharCode.apply(null, Array.from(sub) as any);
  }
  return btoa(binary);
}

export async function signAndExportPdf(params: {
  bytes: Uint8Array;
  suggestedName?: string;
  targetPath?: string | null;
  overwrite?: boolean;
}) {
  const pdfBytesB64 = u8ToB64(params.bytes);

  // ⚠️ Tauri v2：参数名必须匹配 Rust 函数签名里的 `payload`
  const resp = await invoke<SignExportResp>("sign_and_export_pdf", {
    payload: {
      pdfBytesB64,
      suggestedName: params.suggestedName ?? "signed.pdf",
      targetPath: params.targetPath ?? null,
      overwrite: !!params.overwrite,
    }
  });

  return resp;
}
