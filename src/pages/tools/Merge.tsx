// src/pages/tools/Merge.tsx
import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import type { Event as TauriEvent } from "@tauri-apps/api/event";
import { readFile } from "@tauri-apps/plugin-fs";

import styles from "../../css/merge.module.css";
import { bindUiSink, log, err } from "../../shared/logger";
import { putBlob, removeBlob, toInvokePayload, type PdfSlot } from "../../shared/pdfStore";
import { mergePdfs } from "../../shared/api";

const INTERNAL_DND_TYPE = "application/x-lumenpdf-index";

export default function Merge({ back }: { back: () => void }) {
  const [items, setItems] = useState<PdfSlot[]>([]);
  const [logUi, setLogUi] = useState("");
  const [dragOver, setDragOver] = useState(false);     // 仅用于“外部文件拖入”高亮
  const [nudge, setNudge] = useState<"none" | "invalid">("none");
  const dzRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // —— 排序状态：用 state 触发重渲染 + ref 提供给原生/全局监听 —— //
  const [isSorting, setIsSorting] = useState(false);
  const sortingRef = useRef(false);
  const setSorting = (v: boolean) => {
    sortingRef.current = v;
    setIsSorting(v);
    if (v) { (document.body as any).dataset.sorting = "1"; }
    else { delete (document.body as any).dataset.sorting; }
  };

  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<"before" | "after" | null>(null);

  useEffect(() => {
    bindUiSink((line) => setLogUi((l) => (l ? l + "\n" + line : line)));
  }, []);

  // ========== 文件导入（两路：原生路径 / 浏览器 FileList） ========== //
  async function addFilesFromFileList(list: FileList | null) {
    if (!list || !list.length) return;
    const files = Array.from(list).filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!files.length) { err("请选择/拖入 PDF 文件"); return; }
    await addMany(files.map(f => ({ name: f.name, read: () => f.arrayBuffer().then(b => new Uint8Array(b)) })));
  }

  async function addFilesFromPaths(paths: string[]) {
    const pdfs = paths.filter(p => /\.pdf$/i.test(p));
    if (!pdfs.length) { err("拖入的不是 PDF 文件"); return; }
    await addMany(pdfs.map(p => ({ name: basename(p), read: () => readFile(p) })));
  }

  async function addMany(entries: Array<{ name: string; read: () => Promise<Uint8Array> }>) {
    const metas: PdfSlot[] = [];
    for (const e of entries) {
      try {
        const buf = await e.read();
        const slot = putBlob(e.name, buf);
        metas.push(slot);
      } catch (e) {
        err("读取文件失败", e);
      }
    }
    setItems(prev => {
      const seen = new Set(prev.map(p => p.name + "@" + p.size));
      const next = prev.slice();
      for (const m of metas) {
        const key = m.name + "@" + m.size;
        if (!seen.has(key)) { next.push(m); seen.add(key); }
      }
      return next;
    });
    log("add", metas.map(m => `${m.name} (${m.size}B)`));
  }

  // ===== Webview 原生拖拽事件：仅处理“外部文件拖入” =====
  useEffect(() => {
    let un: undefined | (() => void);
    (async () => {
      try {
        un = await getCurrentWebview().onDragDropEvent(async (event: TauriEvent<DragDropEvent>) => {
          // 内部排序：忽略所有 webview 拖拽反馈
          if (sortingRef.current) return;

          const t = event.payload.type;
          if (t === "enter" || t === "over") {
            setDragOver(true);
          } else if (t === "leave") {
            setDragOver(false);
          } else if (t === "drop") {
            setDragOver(false);
            const paths = (event.payload as any).paths as string[] | undefined;
            if (paths?.length) await addFilesFromPaths(paths);
          }
        });
      } catch (e) { err("onDragDropEvent 监听失败", e); }
    })();
    return () => { try { un?.(); } catch {} };
  }, []);

  // ===== 浏览器 fallback：仅在外部文件拖入时处理 =====
  function isFileDrag(e: React.DragEvent) {
    // 内部排序期间，一律当作非文件
    if (sortingRef.current) return false;
    const dt = e.dataTransfer;
    if (!dt) return false;
    // 更稳的判断：types 或 items 任意一个包含 file 都算外部文件
    const types = Array.from(dt.types || []);
    const items = dt.items ? Array.from(dt.items) as DataTransferItem[] : [];
    const hasFiles = types.includes("Files") || items.some(i => i.kind === "file");
    return hasFiles;
  }
  function onDrop(e: React.DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault(); e.stopPropagation();
    setDragOver(false);
    addFilesFromFileList(e.dataTransfer?.files ?? null);
  }
  function onDragOver(e: React.DragEvent)  {
    if (!isFileDrag(e)) return;
    e.preventDefault(); e.stopPropagation();
    setDragOver(true);
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  }
  function onDragLeave(e: React.DragEvent) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setDragOver(false);
  }

  function onPickClick() { inputRef.current?.click(); }
  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFilesFromFileList(e.target.files);
    e.currentTarget.value = "";
  }

  // ========= 列表内拖拽排序（整行拖拽 + 容器捕获兜底） ========= //
  // pointerdown 先标记“内部排序”，避免上传区高亮
  function onListPointerDownCapture(e: React.PointerEvent<HTMLOListElement>) {
    const el = (e.target as HTMLElement)?.closest?.("li[data-dnd-item='true']");
    if (el) setSorting(true);
  }

  // ⛳ 关键新增：捕获阶段就写入内部 MIME，避免被全局当作外部文件
  function onListDragStartCapture(e: React.DragEvent<HTMLOListElement>) {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.("li[data-dnd-item='true']")) {
      try { e.dataTransfer?.setData(INTERNAL_DND_TYPE, "1"); } catch {}
    }
  }

  useEffect(() => {
    const up = () => setSorting(false);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("dragend", up, true);
    return () => {
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("dragend", up, true);
    };
  }, []);

  function move<T>(arr: T[], from: number, to: number): T[] {
    const next = arr.slice();
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    return next;
  }

  function isInternalDrag(e: React.DragEvent | DragEvent) {
    const dt = e.dataTransfer;
    if (!dt) return false;
    const types = Array.from(dt.types || []);
    // 先查内部 MIME
    if (types.includes(INTERNAL_DND_TYPE)) return true;
    // 兜底：状态位还在，但 MIME 丢了
    if (sortingRef.current) return true;
    return false;
  }

  function calcIndexFromY(clientY: number) {
    const list = listRef.current;
    if (!list) return items.length;
    const rows = Array.from(list.querySelectorAll("li[data-dnd-item='true']")) as HTMLLIElement[];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      const mid = r.top + r.height / 2;
      if (clientY < mid) return i;
    }
    return rows.length;
  }

  // 容器兜底：只要是内部拖拽就阻止默认，避免🚫
  function onListDragEnterCapture(e: React.DragEvent<HTMLOListElement>) {
    if (!isInternalDrag(e)) return;
    e.preventDefault(); e.stopPropagation();
  }
  function onListDragOverCapture(e: React.DragEvent<HTMLOListElement>) {
    if (!isInternalDrag(e)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  }
  function onListDrop(e: React.DragEvent<HTMLOListElement>) {
    if (!isInternalDrag(e) || dragIdx == null) return;
    e.preventDefault(); e.stopPropagation();
    let to = calcIndexFromY(e.clientY);
    if (dragIdx < to) to -= 1;
    if (to !== dragIdx) {
      setItems(prev => {
        const next = move(prev, dragIdx, Math.max(0, Math.min(prev.length - 1, to)));
        log("reorder(container)", { from: dragIdx, to, names: next.map(x => x.name) });
        return next;
      });
    }
    setDragIdx(null); setHoverIdx(null); setHoverPos(null);
    setSorting(false);
  }

  function onItemDragStart(i: number, e: React.DragEvent<HTMLLIElement>) {
    setSorting(true);
    setDragIdx(i);
    e.dataTransfer.setData(INTERNAL_DND_TYPE, String(i));
    e.dataTransfer.setData("text/plain", String(i)); // 兼容
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setDragImage(e.currentTarget as Element, 12, 12); } catch {}
  }

  function onItemDragEnter(i: number, e: React.DragEvent<HTMLLIElement>) {
    if (!isInternalDrag(e)) return;
    e.preventDefault(); e.stopPropagation();
    setHoverIdx(i);
  }

  function onItemDragOver(i: number, e: React.DragEvent<HTMLLIElement>) {
    if (!isInternalDrag(e)) return;
    e.preventDefault(); e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";

    const rect = (e.currentTarget as HTMLLIElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const pos: "before" | "after" = y < rect.height / 2 ? "before" : "after";
    if (hoverIdx !== i || hoverPos !== pos) {
      setHoverIdx(i);
      setHoverPos(pos);
    }
  }

  function onItemDrop(i: number, e: React.DragEvent<HTMLLIElement>) {
    if (!isInternalDrag(e) || dragIdx == null) return;
    e.preventDefault(); e.stopPropagation();

    const pos = hoverPos ?? "after";
    let to = i + (pos === "after" ? 1 : 0);
    if (dragIdx < to) to -= 1;

    if (to !== dragIdx) {
      setItems(prev => {
        const next = move(prev, dragIdx, Math.max(0, Math.min(prev.length - 1, to)));
        log("reorder(item)", { from: dragIdx, to, names: next.map(x => x.name) });
        return next;
      });
    }
    setDragIdx(null); setHoverIdx(null); setHoverPos(null);
    setSorting(false);
  }

  function onItemDragEnd(e?: React.DragEvent) {
    if (e && isInternalDrag(e)) { e.preventDefault(); e.stopPropagation(); }
    setDragIdx(null); setHoverIdx(null); setHoverPos(null);
    setSorting(false);
  }

  // ========= 合并 ========= //
  async function doMerge() {
    if (items.length === 0) { err("还没有添加任何 PDF。先拖拽或选择添加。"); pokeDropzone(); return; }
    if (items.length === 1) { err("至少选择两个 PDF 才能合并。"); pokeDropzone(); return; }

    const out = await save({ defaultPath: "merged.pdf" });
    if (!out) return;

    try {
      const ids = items.map(i => i.id);
      const names = items.map(i => i.name);
      const payload = toInvokePayload(ids, names);
      log("[merge] start", { count: payload.length, out, order: names });
      const res = await mergePdfs(payload as any, out as string);
      log("✅ 合并完成：", res);
    } catch (e: any) {
      err("❌ 合并失败：", e?.message || e);
    }
  }

  // —— 其他杂项 —— //
  function removeOne(id: string) {
    setItems(prev => prev.filter(x => x.id !== id));
    try { removeBlob(id); } catch {}
  }
  function pokeDropzone() {
    try {
      dzRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setNudge("invalid");
      setTimeout(() => setNudge("none"), 420);
    } catch {}
  }

  return (
    <>
      <div className="breadcrumbs">
        <a onClick={back} style={{ cursor: "pointer" }}>← 返回</a>
      </div>
      <div className="h1">合并 PDF</div>

      {/* 内部排序时禁用 dropzone 指针事件，避免它抢事件导致🚫和高亮 */}
      <div
        ref={dzRef}
        className={[
          styles.dropzone,
          dragOver ? styles.dragover : "",
          nudge === "invalid" ? styles.invalid : "",
        ].join(" ")}
        style={{ pointerEvents: isSorting ? ("none" as const) : ("auto" as const) }}
        onClick={onPickClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        role="button"
        aria-label="上传或拖拽 PDF"
        aria-live="polite"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPickClick(); }}
      >
        <UploadIcon />
        <div className={styles.dzTitle}>拖拽 PDF 到这里</div>
        <div className={styles.dzSub}>或点击选择文件（支持多选，递增添加）</div>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          multiple
          hidden
          onChange={onInputChange}
        />
      </div>

      <div className="toolbar" style={{ gap: 8, justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ opacity: .8 }}>已选择：{items.length} 个</div>
        <button className="btn primary" onClick={doMerge} disabled={items.length < 2}>
          开始合并（{items.length}）
        </button>
      </div>

      {/* 列表容器：标记内部区域 + 捕获阶段兜底 + pointerdown 预标记 */}
      <ol
        ref={listRef}
        className={styles.fileList}
        data-dnd-internal="true"
        aria-live="polite"
        onPointerDownCapture={onListPointerDownCapture}
        onDragStartCapture={onListDragStartCapture}
        onDragEnterCapture={onListDragEnterCapture}
        onDragOverCapture={onListDragOverCapture}
        onDrop={onListDrop}
      >
        {items.length === 0 ? (
          <li className={styles.fileEmpty}>未选择文件…</li>
        ) : (
          items.map((it, i) => (
            <li
              key={it.id}
              data-dnd-item="true"
              className={[
                styles.fileItem,
                (dragIdx === i) ? styles.dragging : "",
                (hoverIdx === i && hoverPos === "before") ? styles.dropBefore : "",
                (hoverIdx === i && hoverPos === "after") ? styles.dropAfter : "",
              ].join(" ")}
              title={`${it.name} (${it.size} bytes)`}
              draggable
              onDragStart={(e) => onItemDragStart(i, e)}
              onDragEnter={(e) => onItemDragEnter(i, e)}
              onDragOver={(e) => onItemDragOver(i, e)}
              onDrop={(e) => onItemDrop(i, e)}
              onDragEnd={onItemDragEnd}
            >
              <span className={styles.index} aria-hidden>{i + 1}</span>
              <span className={styles.fileName}>{it.name}</span>
              <button
                className={styles.removeBtn}
                onClick={(e) => { e.stopPropagation(); removeOne(it.id); }}
                aria-label={`移除 ${it.name}`}
                title="移除这个文件"
              >×</button>
            </li>
          ))
        )}
      </ol>

      <hr className="sep" />
      <pre className="log" style={{ whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto" }}>
        {logUi || "日志输出…"}
      </pre>
    </>
  );
}

function basename(p: string) {
  return p.replace(/\\+/g, "/").split("/").pop() || "unnamed.pdf";
}
function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden style={{ opacity: 0.9 }}>
      <path fill="currentColor" d="M19 15v4H5v-4H3v6h18v-6h-2zM11 3v10.17l-3.59-3.58L6 11l6 6 6-6-1.41-1.41L13 13.17V3h-2z"/>
    </svg>
  );
}
