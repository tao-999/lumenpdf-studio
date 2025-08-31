import { invoke } from "@tauri-apps/api/core";

export const mergePdfs = (inputs: string[], output: string) =>
  invoke<string>("merge_pdfs", { inputs, output });

export const splitPdf = (
  input: string,
  ranges: Array<[number, number]>,
  outDir: string
) => invoke<string[]>("split_pdf", { input, ranges, outDir });

export const ping = () => invoke<string>("ping");
