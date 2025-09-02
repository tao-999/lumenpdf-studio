// pages/tools/Sign/index.tsx
import { useEffect, useRef, useState } from "react";

import styles from "../../../css/sign.module.css";
import { bindUiSink, log, err } from "../../../shared/logger";

import type { Stamp } from "./types";
import { usePdfCore } from "./pdf";
import PdfStage from "./PdfStage";
import SignaturePad from "./SignaturePad";
import { sniffMime, u8ToBlob } from "./utils";
import FileDrop, { DroppedFile } from "../../../shared/FileDrop";
import { signAndExportPdf } from "../../../shared/signApi"; // ✅ 后端签名+保存

/** 🩹 剥掉 BOM/前导垃圾，把 %PDF- 对齐到 0 偏移；并打日志 */
function sanitizePdfHeader(src: Uint8Array): { clean: Uint8Array; offset: number } {
  if (!src || src.byteLength < 8) return { clean: src, offset: -1 };
  const sig = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"
  let idx = -1;
  const limit = Math.min(src.byteLength - sig.length, 4096);
  for (let i = 0; i <= limit; i++) {
    let hit = true;
    for (let j = 0; j < sig.length; j++) {
      if (src[i + j] !== sig[j]) { hit = false; break; }
    }
    if (hit) { idx = i; break; }
  }
  if (idx === 0) return { clean: src, offset: 0 };
  if (idx > 0) {
    const trimmed = src.subarray(idx);
    const head = Array.from(src.subarray(0, Math.min(16, src.length))).map(b => b.toString(16).padStart(2, "0")).join(" ");
    log("🩹 修正 PDF 头部偏移", { offset: idx, head });
    return { clean: trimmed, offset: idx };
  }
  const head = Array.from(src.subarray(0, Math.min(16, src.length))).map(b => b.toString(16).padStart(2, "0")).join(" ");
  err("❗ 未找到 %PDF- 头（前 16 字节）", head);
  return { clean: src, offset: -1 };
}

export default function Sign({ back }: { back: () => void }) {
  // ===== 日志输出到面板 =====
  const [logUi, setLogUi] = useState("");
  useEffect(() => {
    const append = (line: string) => setLogUi(prev => (prev ? prev + "\n" + line : line));
    bindUiSink(append);
    return () => { bindUiSink(() => {}); };
  }, []);

  // ===== PDF Core =====
  const { pdfBytes, openPdf, numPages, pageMetas, scale, setScale, pdfRef, ready } = usePdfCore();
  const [page, setPage] = useState(0);

  // ✅ 强制重挂 PdfStage 的 key（解决“换文件 UI 仍旧”的问题）
  const [pdfKey, setPdfKey] = useState(0);

  // ===== 状态 =====
  const [pdfName, setPdfName] = useState<string | null>(null);

  const [stampBytes, setStampBytes] = useState<Uint8Array | null>(null);
  const [stampUrl, setStampUrl] = useState<string | null>(null);
  const [stamps, setStamps] = useState<Stamp[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [showPad, setShowPad] = useState(false);
  const [dropOver, setDropOver] = useState(false);

  // 🔥 状态：上传/打开、导出
  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 🔑 关键：只有 openPdf 成功后才持有的“干净 PDF 字节”（用于导出）
  const srcBytesRef = useRef<Uint8Array | null>(null);

  // ===== 底部日志高度（可拖拽） =====
  const [logH, setLogH] = useState(180);
  const resizingRef = useRef(false);
  const onStartResize = (e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    const startY = e.clientY;
    const startH = logH;
    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const dy = startY - ev.clientY;
      const h = Math.max(100, Math.min(Math.round(startH + dy), Math.round(window.innerHeight * 0.6)));
      setLogH(h);
    };
    const onUp = () => {
      resizingRef.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp, { once: true });
  };

  // ===== 缩放（保持落印相对尺寸） =====
  const clamp = (v: number) => Math.max(0.5, Math.min(2, +v.toFixed(2)));
  function zoomTo(next: number) {
    const target = clamp(next);
    if (target === scale) return;
    const k = target / (scale || 1);
    setStamps(old => old.map(s => ({
      ...s,
      x: Math.round(s.x * k),
      y: Math.round(s.y * k),
      w: Math.round(s.w * k),
      h: Math.round(s.h * k),
    })));
    setScale(target);
  }
  const zoomAdd = (d: number) => zoomTo(scale + d);

  // ===== 打开 PDF：严格串行 =====
  const openingRef = useRef<Promise<void> | null>(null);

  async function openPicked(files: DroppedFile[]) {
    const f = files && files[0];
    if (!f) return;

    if (openingRef.current) {
      try { await openingRef.current; } catch {}
    }

    openingRef.current = (async () => {
      setUploading(true);
      const name = f.name || "document.pdf";
      const bytes = f.bytes;
      if (!bytes || bytes.byteLength <= 8) {
        err("读取失败：拿到的是空字节（size=0）");
        setUploading(false);
        srcBytesRef.current = null;
        return;
      }
      const mime = sniffMime(bytes) || f.type || "";
      const isPdf = (mime && mime.includes("pdf")) || /\.pdf$/i.test(name);
      if (!isPdf) {
        err(`请选择 PDF 文件（检测到：${mime || "unknown"} · name=${name})`);
        setUploading(false);
        srcBytesRef.current = null;
        return;
      }

      try {
        // 1) 让 pdf.js 加载显示
        await openPdf(new Uint8Array(bytes));
        // 2) 准备给 pdf-lib 的“干净字节”
        const { clean, offset } = sanitizePdfHeader(new Uint8Array(bytes));
        srcBytesRef.current = clean;
        const peek = new TextDecoder().decode(clean.subarray(0, 5));
        log("📎 PDF header", { peek, offset });
        // 3) UI 状态
        setPdfName(name);
        setStamps([]); setSelectedId(null); setPage(0);
        setPdfKey(k => k + 1); // ✅ 换文档后重挂 PdfStage，清缓存
        log("✅ PDF 已载入", { name, size: bytes.byteLength });
      } catch (e: any) {
        srcBytesRef.current = null;
        err("打开 PDF 失败", e?.message || String(e));
      } finally {
        setUploading(false);
      }
    })();

    try { await openingRef.current; } finally { openingRef.current = null; }
  }

  // ===== 上传签名图（与 PDF 打开严格分离） =====
  async function pickStamp(file: File) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = sniffMime(bytes) || file.type || "image/png";
    if (!mime.startsWith("image/")) {
      err(`请选择图片作为签名素材（当前：${mime || "unknown"}）`);
      return;
    }
    setStampBytes(bytes);
    const u = URL.createObjectURL(file);
    if (stampUrl) URL.revokeObjectURL(stampUrl);
    setStampUrl(u);
    log("✅ 签名图已载入", { name: file.name, size: bytes.byteLength, mime });
  }

  // ===== 在页面上落印 =====
  function onAddStampAt(pageIndex: number, xCss: number, yCss: number) {
    if (!stampBytes || !stampUrl) { err("请先上传/手写签名"); return; }
    const meta = pageMetas[pageIndex];
    const w = Math.round(meta.wPx * 0.25);
    const h = Math.round(w * 0.25);
    const x = Math.max(0, Math.min(meta.wPx - w, Math.round(xCss)));
    const y = Math.max(0, Math.min(meta.hPx - h, Math.round(yCss)));
    const s: Stamp = {
      id: "s" + Math.random().toString(36).slice(2),
      pageIndex, x, y, w, h, bytes: stampBytes, url: stampUrl,
    };
    setStamps(prev => [...prev, s]);
    setSelectedId(s.id);
    log("[drop] add stamp (top-left anchor)", s);
  }

  function onPatchStamp(id: string, patch: Partial<Stamp>) {
    setStamps(prev => prev.map(s => (s.id === id ? { ...s, ...patch } : s)));
  }
  function onRemoveStamp(id: string) {
    setStamps(prev => prev.filter(s => s.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  // ===== 导出（前端合成 -> 后端保存） =====
  async function exportStamped() {
    if (!ready) { err("PDF 未就绪"); return; }
    if (!srcBytesRef.current && !pdfBytes) { err("源 PDF 丢失"); return; }
    if (stamps.length === 0) { err("还没有放置任何签名/印章"); return; }

    setExporting(true);
    try {
      const base = srcBytesRef.current ?? pdfBytes!;
      const { clean } = sanitizePdfHeader(base);
      // 自检
      if (!(clean[0] === 0x25 && clean[1] === 0x50 && clean[2] === 0x44 && clean[3] === 0x46)) {
        throw new Error("前端源字节不是有效 PDF（缺少 %PDF- 头）");
      }

      const { PDFDocument } = await import("pdf-lib");
      const doc = await PDFDocument.load(clean, { updateMetadata: false, ignoreEncryption: false });

      for (const s of stamps) {
        const pageObj = doc.getPage(s.pageIndex);
        const { scale: sc, hPx } = pageMetas[s.pageIndex];
        const xPt = s.x / sc;
        const yPt = (hPx - (s.y + s.h)) / sc;
        const wPt = s.w / sc;
        const hPt = s.h / sc;
        const isPng = s.bytes.length >= 4 && s.bytes[0] === 0x89 && s.bytes[1] === 0x50;
        const img = isPng ? await doc.embedPng(s.bytes) : await doc.embedJpg(s.bytes);
        pageObj.drawImage(img, { x: xPt, y: yPt, width: wPt, height: hPt, opacity: 1 });
      }

      const outBytes = new Uint8Array(await doc.save({
        updateFieldAppearances: false,
        useObjectStreams: false, // 兼容更多阅读器
      }));

      if (!(outBytes[0] === 0x25 && outBytes[1] === 0x50 && outBytes[2] === 0x44 && outBytes[3] === 0x46)) {
        throw new Error("合成结果不是 PDF（开头不是 %PDF-）");
      }
      if (outBytes.length <= 8) {
        throw new Error("合成结果为空或过短");
      }

      const suggested = (pdfName || "document.pdf").replace(/\.pdf$/i, ".signed.pdf");

      const resp = await signAndExportPdf({
        bytes: outBytes,
        suggestedName: suggested,
        targetPath: null,   // 传入固定路径就不弹窗
        overwrite: false,
      });

      log("✅ 已保存", resp);
    } catch (e: any) {
      err("❌ 导出失败", e?.message || String(e));
    } finally {
      setExporting(false);
    }
  }

  // ===== 幽灵拖拽预览（签名） =====
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [ghost, setGhost] = useState<{ show: boolean; x: number; y: number }>({ show: false, x: 0, y: 0 });
  function beginGhostDrag(e: React.MouseEvent) {
    if (!stampUrl) return;
    e.preventDefault();
    (document.body as any).style.userSelect = "none";
    setGhost({ show: true, x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", onGhostMove);
    window.addEventListener("mouseup", onGhostUp, { once: true });
  }
  function onGhostMove(ev: MouseEvent) { setGhost(prev => ({ ...prev, x: ev.clientX, y: ev.clientY })); }
  function onGhostUp(ev: MouseEvent) {
    (document.body as any).style.userSelect = "";
    window.removeEventListener("mousemove", onGhostMove);
    setGhost(prev => ({ ...prev, show: false }));
    const stage = stageRef.current; if (!stage) return;
    const overlay = stage.querySelector('[data-stamp-overlay-root="1"]') as HTMLElement | null;
    const rect = (overlay || stage).getBoundingClientRect();
    const x = ev.clientX - rect.left; const y = ev.clientY - rect.top;
    if (x >= 0 && y >= 0 && x < rect.width && y < rect.height) onAddStampAt(page, x, y);
  }

  // ===== 快捷键 =====
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ready) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.getAttribute("contenteditable") === "true")) return;
      if (e.key === "ArrowLeft") { e.preventDefault(); setPage(p => Math.max(0, p - 1)); }
      else if (e.key === "ArrowRight") { e.preventDefault(); setPage(p => Math.min(numPages - 1, p + 1)); }
      else if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomAdd(+0.25); }
      else if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomAdd(-0.25); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ready, numPages, scale]);

  // ===== 布局参数（把日志固定到底部） =====
  const SIDE_W = 300, SIDE_W_COLLAPSED = 48, GAP = 16, TOP = 56;
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);

  return (
    <div
      className={styles.edgeLayout}
      style={{
        // @ts-ignore
        "--side": `${SIDE_W}px`,
        "--side-collapsed": `${SIDE_W_COLLAPSED}px`,
        "--gap": `${GAP}px`,
        "--topbar": `${TOP}px`,
        "--leftW": leftCollapsed ? `${SIDE_W_COLLAPSED}px` : `${SIDE_W}px`,
        "--rightW": rightCollapsed ? `${SIDE_W_COLLAPSED}px` : `${SIDE_W}px`,
        "--logH": `${logH}px`,
      } as React.CSSProperties}
    >
      {/* 顶部条 */}
      <div className={styles.edgeTopbar}>
        <div className={styles.back} onClick={back} role="button" tabIndex={0}>← 返回</div>
        <div className={styles.title}>签署 PDF</div>
      </div>

      {/* 左侧固定栏 */}
      <aside className={[styles.edgeLeft, leftCollapsed ? styles.collapsed : ""].join(" ")}>
        <button className={styles.collapseBtn} onClick={() => setLeftCollapsed(v => !v)} title={leftCollapsed ? "展开" : "折叠"}>≡</button>

        {/* 👇 包容器 + 忙碌遮罩 */}
        <div style={{ position: "relative" }}>
          <FileDrop
            accept={/\.pdf$/i}
            pickAccept="application/pdf,.pdf"
            multiple={false}
            onFiles={openPicked}
            onDragState={setDropOver}
            className={[styles.dropzone, dropOver ? styles.dragover : ""].join(" ")}
          >
            <div style={{ fontSize: 28, marginBottom: 8 }}>🖇️</div>
            <div className={styles.dzTitle}>{pdfBytes ? "重新选择 PDF" : "拖拽 PDF 到这里"}</div>
            <div className={styles.dzSub}>或点击选择文件</div>
          </FileDrop>

          {uploading && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(0,0,0,.45)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                borderRadius: 8,
                pointerEvents: "auto",
                cursor: "wait",
              }}
            >
              <div
                style={{
                  width: 18, height: 18,
                  borderRadius: "50%",
                  border: "2px solid rgba(255,255,255,.35)",
                  borderTopColor: "#fff",
                  animation: "fd-spin 1s linear infinite",
                }}
              />
              <span style={{ color: "#fff", fontSize: 14, opacity: .95 }}>正在载入 PDF…</span>
              <style>{`@keyframes fd-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
            </div>
          )}
        </div>

        {pdfName && (
          <div className={styles.fileName} title={pdfName}>
            📄 {pdfName}
          </div>
        )}

        <div className={styles.panel}>
          <div className={styles.kv}>
            <span>状态</span>
            <span>{pdfBytes ? `已载入：${numPages} 页 · 当前：${page+1}/${numPages}` : "未载入 PDF"}</span>
          </div>
          <div className={styles.row}>
            <button className="btn" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={!ready || page <= 0}>← 上一页</button>
            <button className="btn" onClick={() => setPage(p => Math.min(numPages - 1, p + 1))} disabled={!ready || page >= numPages - 1}>下一页 →</button>
          </div>
        </div>
      </aside>

      {/* 右侧固定栏 */}
      <aside className={[styles.edgeRight, rightCollapsed ? styles.collapsed : ""].join(" ")}>
        <button className={styles.collapseBtn} onClick={() => setRightCollapsed(v => !v)} title={rightCollapsed ? "展开" : "折叠"}>≡</button>

        <div className={styles.panel}>
          <div className={styles.kv}><span>签名素材</span><span>{stampUrl ? "已就绪" : "未上传"}</span></div>
          <div className={styles.thumbBox}>
            {stampUrl ? (
              <img
                src={stampUrl}
                draggable={false}
                onMouseDown={beginGhostDrag}
                className={styles.stampThumb}
                title="按住并拖到 PDF 页面即可落印"
              />
            ) : (
              <div className={styles.placeholder}>（尚未上传或书写签名）</div>
            )}
          </div>
          <div className={styles.row}>
            <label className="btn">
              上传签名图
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const fs = e.target.files;
                  if (fs && fs[0]) pickStamp(fs[0]);   // 只处理图片
                  (e.target as HTMLInputElement).value = "";
                }}
              />
            </label>
            {/* 手写签名始终可用 */}
            <button className="btn" onClick={() => setShowPad(true)}>✍️ 手写签名</button>
          </div>
          <div className={styles.row}>
            <button
              className="btn primary"
              onClick={exportStamped}
              disabled={exporting || !ready || !srcBytesRef.current || stamps.length === 0}
              style={{ flex: 1 }}
              title={exporting ? "正在导出…" : (!ready ? "PDF 未就绪" : (!srcBytesRef.current ? "源字节缺失" : "导出带签名 PDF"))}
            >
              {exporting ? "导出中…" : "导出带签名 PDF"}
            </button>
          </div>
        </div>

      </aside>

      {/* 中间舞台 */}
      <main className={styles.edgeCenter}>
        {numPages > 0 && (
          <PdfStage
            key={pdfKey}                 // ✅ 换文档时强制重挂，清空内部缓存
            stageRef={stageRef}
            pdfRef={pdfRef}
            numPages={numPages}
            pageMetas={pageMetas}
            page={page}
            stamps={stamps}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            onPatchStamp={onPatchStamp}
            onRemoveStamp={onRemoveStamp}
          />
        )}
      </main>

      {/* 底部固定日志 Dock */}
      <div className={styles.logDock}>
        <div className={styles.logResizer} onMouseDown={onStartResize} title="拖拽调整高度" />
        <div className={styles.logHead}>
          <div>调试日志</div>
          <div className={styles.logBtns}>
            <button onClick={() => setLogUi("")} className="btn">清空</button>
          </div>
        </div>
        <div className={styles.logBody}>
          <pre className={styles.log}>{logUi || "日志输出…"}</pre>
        </div>
      </div>

      {/* 幽灵预览 */}
      {ghost.show && stampUrl && (
        <div className={styles.ghost} style={{ left: ghost.x + 8, top: ghost.y + 8 }}>
          <img src={stampUrl} style={{ width: 160, height: 40, objectFit: "contain", background: "#fff", borderRadius: 4, padding: 4 }} />
        </div>
      )}

      {/* 手写签名面板 */}
      {showPad && (
        <SignaturePad
          onDone={async (png) => {
            setStampBytes(png);
            const u = URL.createObjectURL(u8ToBlob(png, "image/png"));
            if (stampUrl) URL.revokeObjectURL(stampUrl);
            setStampUrl(u);
            setShowPad(false);
          }}
          onClose={() => setShowPad(false)}
        />
      )}
    </div>
  );
}
