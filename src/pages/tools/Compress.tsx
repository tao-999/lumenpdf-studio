// src/pages/tools/Compress.tsx
import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import type { Event as TauriEvent } from "@tauri-apps/api/event";
import { readFile } from "@tauri-apps/plugin-fs";

import styles from "../../css/merge.module.css";
import { bindUiSink, log, err } from "../../shared/logger";
import { compressPdf, toBytesInput, type BytesInput, type CompressPreset } from "../../shared/api";

type Slot = { name: string; size: number; bytes: Uint8Array };

// ---- 质量 → 预设（兼容后端 API） ----
function mapQualityToPreset(q: number): CompressPreset {
  if (q >= 95) return "lossless";  // ≥95 → 无损
  if (q >= 70) return "small";     // 70–94 → 有损(≈150dpi)
  if (q >= 40) return "smaller";   // 40–69 → 有损(≈72–96dpi)
  return "tiny";                   // 0–39 → 更狠的有损
}
function presetHint(p: CompressPreset): string {
  switch (p) {
    case "lossless": return "无损（qpdf）";
    case "small":    return "有损（≈150dpi）";
    case "smaller":  return "有损（≈72–96dpi）";
    case "tiny":     return "更狠的有损";
  }
  const _exhaustive: never = p; return _exhaustive;
}

// ---- 轻量估算模型：按质量分段线性估算“压缩后体积比例” ----
// 注：只是前端估算，真实结果取决于 PDF 内容结构（文本/图片占比、重复资源等）
function estimateRatioByQuality(q: number): number {
  if (q >= 95) {
    // 无损：约 0.90 → 1.00
    return 0.90 + (q - 95) * (0.10 / 5);
  } else if (q >= 70) {
    // small：约 0.55 → 0.85
    return 0.55 + (q - 70) * ((0.85 - 0.55) / 24);
  } else if (q >= 40) {
    // smaller：约 0.35 → 0.60
    return 0.35 + (q - 40) * ((0.60 - 0.35) / 29);
  } else {
    // tiny：约 0.18 → 0.35
    return 0.18 + q * ((0.35 - 0.18) / 39);
  }
}
function estimateCompressedBytes(originalBytes: number, quality: number): number {
  const r = Math.min(1, Math.max(0.05, estimateRatioByQuality(quality)));
  return Math.max(1, Math.round(originalBytes * r));
}

export default function Compress({ back }: { back: () => void }) {
  const [file, setFile] = useState<Slot | null>(null);
  const [quality, setQuality] = useState<number>(80); // 默认较稳：体积降+观感好
  const [dragOver, setDragOver] = useState(false);
  const [logUi, setLogUi] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bindUiSink((line) => setLogUi((l) => (l ? l + "\n" + line : line)));
  }, []);

  // —— WebView 原生拖拽：高亮 + 从 paths 读取字节 —— //
  useEffect(() => {
    let un: undefined | (() => void);
    (async () => {
      try {
        un = await getCurrentWebview().onDragDropEvent(async (event: TauriEvent<DragDropEvent>) => {
          const t = event.payload.type;
          if (t === "enter" || t === "over") setDragOver(true);
          else if (t === "leave") setDragOver(false);
          else if (t === "drop") {
            setDragOver(false);
            const paths = (event.payload as any).paths as string[] | undefined;
            if (paths?.length) {
              try { await addFromPaths(paths); }
              catch (e) { err("读取拖入文件失败", e); }
            }
          }
        });
      } catch (e) { err("onDragDropEvent 监听失败", e); }
    })();
    return () => { try { un?.(); } catch {} };
  }, []);

  // —— DOM 通道：FileList（浏览器/部分环境可用） —— //
  function isPdfName(name: string) { return /\.pdf$/i.test(name); }

  async function addFromFileList(list: FileList | null) {
    if (!list || !list.length) return;
    const f = Array.from(list).find(f => isPdfName(f.name) || f.type === "application/pdf");
    if (!f) { err("请选择 PDF 文件"); return; }
    const buf = new Uint8Array(await f.arrayBuffer());
    setFile({ name: f.name, size: buf.byteLength, bytes: buf });
    log("add(filelist)", `${f.name} (${buf.byteLength} B)`);
  }
  async function addFromPaths(paths: string[]) {
    const p = paths.find(isPdfName);
    if (!p) { err("拖入的不是 PDF 文件"); return; }
    const bytes = await readFile(p); // 读取为 Uint8Array，不改源文件
    const name = basename(p);
    setFile({ name, size: bytes.byteLength, bytes });
    log("add(path)", `${name} (${bytes.byteLength} B)`);
  }

  // —— 选择框 —— //
  function onPick() { inputRef.current?.click(); }
  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFromFileList(e.target.files);
    e.currentTarget.value = "";
  }

  // —— Dropzone（DOM FileList 通道） —— //
  function onDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false);
    addFromFileList(e.dataTransfer?.files ?? null);
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault(); setDragOver(true);
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }
  function onDragLeave(e: React.DragEvent) { e.preventDefault(); setDragOver(false); }

  async function doCompress() {
    if (!file) { err("先选择一个 PDF 再压缩"); return; }
    const out = await save({ defaultPath: withSuffix(file.name, ".compressed.pdf") });
    if (!out) return;

    const preset = mapQualityToPreset(quality);
    try {
      const payload: BytesInput = toBytesInput(file.name, file.bytes);
      log("[compress] start", { name: file.name, size: file.size, quality, preset, out });
      const res = await compressPdf(payload as any, out as string, preset);
      log("✅ 压缩完成：", res);
    } catch (e: any) {
      err("❌ 压缩失败：", e?.message || e);
    }
  }

  const currentPreset = mapQualityToPreset(quality);
  const hint = presetHint(currentPreset);
  const estimatedStr = file ? formatBytes(estimateCompressedBytes(file.size, quality)) : "—";

  return (
    <div style={{ padding: 16 }}>
      <div className="breadcrumbs">
        <a onClick={back} style={{ cursor: "pointer" }}>← 返回</a>
      </div>
      <div className="h1">压缩 PDF</div>

      {/* —— 上传区 —— */}
      <div
        className={[
          styles.dropzone,
          dragOver ? styles.dragover : "",
        ].join(" ")}
        onClick={onPick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        role="button"
        aria-label="上传或拖拽 PDF"
        aria-live="polite"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPick(); }}
      >
        <div style={{ fontSize: 28, marginBottom: 8 }}>📦</div>
        <div className={styles.dzTitle}>拖拽 PDF 到这里</div>
        <div className={styles.dzSub}>或点击选择文件</div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          hidden
          onChange={onInputChange}
        />
      </div>

      {/* —— 文件信息单独一行（允许换行，不挤控件） —— */}
      <div
        style={{
          marginTop: 10,
          marginBottom: 8,
          opacity: .85,
          lineHeight: 1.4,
          wordBreak: "break-all",
        }}
        title={file ? file.name : undefined}
      >
        {file ? <>已选择：<strong>{file.name}</strong>（{formatBytes(file.size)}）</> : "未选择文件"}
      </div>

      {/* —— 第二行：标签+短滑杆 | 右侧信息（固定宽） | 按钮（短） —— */}
      <div
        className="toolbar"
        style={{
          display: "grid",
          gridTemplateColumns: "auto 200px fit-content(128px)", // 中列固定200px用于两行信息
          alignItems: "center",
          columnGap: 12,
          rowGap: 8,
        }}
      >
        {/* 标签 + 短滑杆 */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label htmlFor="q" style={{ whiteSpace: "nowrap" }}>压缩质量：</label>
          <input
            id="q"
            type="range"
            min={0}
            max={100}
            step={1}
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
            // 固定舒适宽度，不累手
            style={{ width: "clamp(180px, 30vw, 320px)" }}
            list="q-marks"
            aria-label="压缩质量"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={quality}
          />
          <datalist id="q-marks">
            <option value="0" label="最小" />
            <option value="25" />
            <option value="50" label="均衡" />
            <option value="75" />
            <option value="100" label="最高" />
          </datalist>
        </div>

        {/* 右侧信息（固定列，不挤滑杆）：第一行质量提示，第二行预计体积 */}
        <div
          style={{
            width: 200,
            textAlign: "right",
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          <div style={{ fontSize: 12, opacity: .85 }}>{quality}% · {hint}</div>
          <div style={{ fontSize: 12, opacity: .75 }}>
            预计：{estimatedStr}
            {file ? <span style={{ opacity: .6 }}>（±20%）</span> : null}
          </div>
        </div>

        {/* 按钮（短，不拉伸） */}
        <button
          className="btn primary"
          onClick={doCompress}
          disabled={!file}
          style={{
            justifySelf: "end",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            height: 36,
            padding: "0 14px",
            width: "auto",
            minWidth: "unset",
            whiteSpace: "nowrap",
          }}
        >
          开始压缩
        </button>
      </div>

      <hr className="sep" />
      <pre className="log" style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>
        {logUi || "日志输出…"}
      </pre>
    </div>
  );
}

function basename(p: string) {
  return p.replace(/\\+/g, "/").split("/").pop() || "unnamed.pdf";
}
function withSuffix(name: string, suffix: string) {
  return name.toLowerCase().endsWith(".pdf") ? name.replace(/\.pdf$/i, suffix) : (name + suffix);
}
function formatBytes(n: number) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(2) + " MB";
}
