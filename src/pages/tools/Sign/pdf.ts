// pages/tools/Sign/pdf.ts
import { useEffect, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import { PdfPageMeta, Stamp } from "./types";
import { sniffMime, u8ToBlob } from "./utils";

/* ===================== Worker 配置：让 pdf.js 自己管生命周期 ===================== */
try {
  // 优先 ESM worker
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc =
    new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
} catch {
  // 兜底非 ESM
  (pdfjsLib as any).GlobalWorkerOptions.workerSrc =
    new URL("pdfjs-dist/build/pdf.worker.min.js", import.meta.url).toString();
}

// 这些放到 /public/pdfjs/ 下（必须以 / 结尾）
(pdfjsLib as any).GlobalWorkerOptions.cMapUrl = "/pdfjs/cmaps/";
(pdfjsLib as any).GlobalWorkerOptions.standardFontDataUrl = "/pdfjs/standard_fonts/";
(pdfjsLib as any).GlobalWorkerOptions.cMapPacked = true;

/* ===================== 渲染并发护栏（按“目标画布”而不是“页索引”） ===================== */
// 关键：白屏根因是“同一页不同画布并发”，所以要以 outCanvas 为 key
const canvasRenderSeq = new WeakMap<HTMLCanvasElement, number>();

/* ===================== Core Hook ===================== */
export function usePdfCore() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageMetas, setPageMetas] = useState<PdfPageMeta[]>([]);
  const [scale, setScale] = useState(1.0);
  const [ready, setReady] = useState(false);

  const pdfRef = useRef<any | null>(null);
  const loadingTaskRef = useRef<any | null>(null);

  const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => r()));

  const destroy = async () => {
    setReady(false);

    // 先摘引用，再销毁，避免新任务读到旧对象
    const task = loadingTaskRef.current;
    const pdf = pdfRef.current;
    loadingTaskRef.current = null;
    pdfRef.current = null;

    try { await task?.destroy?.(); } catch {}
    try { await pdf?.cleanup?.(); } catch {}

    // 给 worker 真正退出的时隙，避免“正在销毁”与新建打架
    await nextFrame();
  };

  // 只用 data（二进制）加载
  const openPdf = async (bytes: Uint8Array) => {
    await destroy();

    const task = pdfjsLib.getDocument({
      data: bytes,
      isEvalSupported: false,           // Tauri/CSP 更稳
      cMapUrl: "/pdfjs/cmaps/",
      cMapPacked: true,
      standardFontDataUrl: "/pdfjs/standard_fonts/",
      disableAutoFetch: true,
      disableFontFace: false,
    });
    loadingTaskRef.current = task;

    try {
      const pdf = await task.promise;

      // 如果等待期间被新任务取代，直接放弃（视作取消）
      if (loadingTaskRef.current !== task) {
        try { await pdf.cleanup?.(); } catch {}
        return;
      }

      pdfRef.current = pdf;
      setNumPages(pdf.numPages);

      // 生成首批页面 meta（使用当前 scale）
      const metas: PdfPageMeta[] = [];
      for (let i = 1; i <= pdf.numPages; i++) {
        const pg = await pdf.getPage(i);
        const vp = pg.getViewport({ scale });
        metas.push({ wPx: vp.width, hPx: vp.height, scale });
      }
      setPageMetas(metas);

      // ✅ 成功后再提交字节
      setPdfBytes(bytes);
      setReady(true);
    } catch (e: any) {
      const msg = e?.message || String(e || "");
      // 吞掉 worker 生命周期过渡报错
      if (msg.includes("PDFWorker.create") || msg.includes("worker is being destroyed") || msg.includes("Transport destroyed")) {
        return;
      }
      setReady(false);
      throw e;
    }
  };

  // 缩放：线性更新尺寸（避免重算页对象），外层负责重渲
  useEffect(() => {
    if (!pageMetas.length) return;
    setPageMetas(prev => {
      const s0 = prev[0].scale || 1;
      if (s0 === scale) return prev;
      const k = scale / s0;
      return prev.map(m => ({ wPx: m.wPx * k, hPx: m.hPx * k, scale }));
    });
  }, [scale, pageMetas.length]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pdfBytes, openPdf, destroy, numPages, pageMetas, scale, setScale, pdfRef, ready };
}

/* ===================== 渲染到指定画布 ===================== */
async function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = url;
  });
  const img = new Image();
  img.src = url;
  return img; // 调用方绘制后再 revoke
}

export async function renderPageToCanvas(
  pdfRef: React.MutableRefObject<any | null> | any,
  pageMetas: PdfPageMeta[],
  i: number,
  outCanvas: HTMLCanvasElement,
  stamps: Stamp[]
) {
  const pdf = (pdfRef?.current ?? pdfRef) as any;
  if (!pdf || i < 0 || i >= (pdf.numPages || 0)) return;

  // ✅ 以“目标画布”为并发单位，避免同页不同画布互相打断提交阶段
  const nextSeq = (canvasRenderSeq.get(outCanvas) || 0) + 1;
  canvasRenderSeq.set(outCanvas, nextSeq);

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const pg = await pdf.getPage(i + 1);
  const meta = pageMetas[i]; if (!meta) return;

  const vpCss = pg.getViewport({ scale: meta.scale });
  const cssW = Math.round(vpCss.width);
  const cssH = Math.round(vpCss.height);
  const pxW  = Math.round(vpCss.width * dpr);
  const pxH  = Math.round(vpCss.height * dpr);

  // 用临时画布渲染，再一次性 blit 到 outCanvas，避免闪烁
  const tmp = document.createElement("canvas");
  tmp.width = pxW;
  tmp.height = pxH;
  const tctx = tmp.getContext("2d", { alpha: false });
  if (!tctx) return;

  tctx.fillStyle = "#fff";
  tctx.fillRect(0, 0, pxW, pxH);

  await (pg as any).render({
    canvasContext: tctx as unknown as CanvasRenderingContext2D,
    viewport: vpCss,
    transform: [dpr, 0, 0, dpr, 0, 0],
    background: "#fff",
    intent: "display",
  }).promise;

  // 贴印章（如果传入了）
  for (const s of stamps) {
    if (s.pageIndex !== i) continue;
    const blob = u8ToBlob(s.bytes, sniffMime(s.bytes));
    try {
      const bmp = await createImageBitmap(blob);
      tctx.drawImage(
        bmp,
        Math.round(s.x * dpr),
        Math.round(s.y * dpr),
        Math.round(s.w * dpr),
        Math.round(s.h * dpr)
      );
      bmp.close();
    } catch {
      const img = await blobToImage(blob);
      tctx.drawImage(
        img,
        Math.round(s.x * dpr),
        Math.round(s.y * dpr),
        Math.round(s.w * dpr),
        Math.round(s.h * dpr)
      );
      URL.revokeObjectURL(img.src);
    }
  }

  // 🧠 只在“这个 outCanvas 仍是最新任务”时提交
  if ((canvasRenderSeq.get(outCanvas) || 0) !== nextSeq) return;

  outCanvas.width = pxW;
  outCanvas.height = pxH;
  outCanvas.style.width = cssW + "px";
  outCanvas.style.height = cssH + "px";

  const octx = outCanvas.getContext("2d", { alpha: false });
  if (!octx) return;

  octx.imageSmoothingEnabled = true;
  octx.imageSmoothingQuality = "high";
  octx.fillStyle = "#fff";
  octx.fillRect(0, 0, pxW, pxH);
  octx.drawImage(tmp, 0, 0);
}
