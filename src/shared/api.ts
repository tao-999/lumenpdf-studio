import { invoke } from "@tauri-apps/api/core";

/** 新的字节版输入：name 仅用于临时文件命名，data 是 PDF 的字节数组 */
export type BytesInput = { name: string; data: number[] };

/** 小工具：把 Uint8Array 变成可传给 invoke 的 BytesInput */
export const toBytesInput = (name: string, u8: Uint8Array): BytesInput => ({
  name,
  data: Array.from(u8),
});

/**
 * ✅ 统一的合并 API：
 * - 传 string[] 走路径版
 * - 传 BytesInput[] 走字节版
 * - 后端只有一个命令：merge
 */
export function mergePdfs(inputs: string[], output: string): Promise<string>;
export function mergePdfs(inputs: BytesInput[], output: string): Promise<string>;
export function mergePdfs(inputs: any[], output: string): Promise<string> {
  return invoke<string>("merge", { inputs, output });
}

/**
 * 拆分 PDF（路径版）
 * - ranges: [ [a,b], ... ] 兼容写法会被规范化为 ["a" 或 "a-b"]
 * - 后端命令：split_pdf
 */
export const splitPdf = (
  input: string,
  ranges: Array<[number, number]>,
  outDir: string
) => {
  const norm = ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`));
  return invoke<string[]>("split_pdf", { input, ranges: norm, outDir });
};
