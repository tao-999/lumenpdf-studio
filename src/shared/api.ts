import { invoke } from "@tauri-apps/api/core";

export type BytesInput = { name: string; data: number[] };
export type CompressPreset = "lossless" | "small" | "smaller" | "tiny";

export const toBytesInput = (name: string, u8: Uint8Array): BytesInput => ({
  name,
  data: Array.from(u8),
});

export function mergePdfs(inputs: string[] | BytesInput[], output: string): Promise<string> {
  return invoke<string>("merge", { inputs, output });
}

export function compressPdf(input: string | BytesInput, output: string, preset: CompressPreset): Promise<string> {
  return invoke<string>("compress", { input, output, preset });
}
