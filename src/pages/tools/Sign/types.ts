export type PdfPageMeta = { wPx: number; hPx: number; scale: number };

export type Stamp = {
  id: string;
  pageIndex: number;
  // 坐标系：渲染后的 CSS 像素
  x: number; y: number; w: number; h: number;
  bytes: Uint8Array;
  url: string;
};
