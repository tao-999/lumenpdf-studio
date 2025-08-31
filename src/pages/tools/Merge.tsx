// src/pages/merge/Merge.tsx
import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import type { Event as TauriEvent } from "@tauri-apps/api/event";

import styles from "../../css/merge.module.css";
import { bindUiSink, log, err } from "../../shared/logger";
import { putBlob, removeBlob, toInvokePayload, type PdfSlot } from "../../shared/pdfStore";
import { mergePdfs } from "../../shared/api"; // ✅ 统一口令：只用 merge

type Path = string;

export default function Merge({ back }: { back: () => void }) {
  const [items, setItems] = useState<PdfSlot[]>([]); // 只存 meta；真正字节在 pdfStore
  const [logUi, setLogUi] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [nudge, setNudge] = useState<"none" | "invalid">("none");
  const dzRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // —— 排序拖拽状态 —— //
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<"before" | "after" | null>(null);

  useEffect(() => {
    bindUiSink((line) => setLogUi((l) => (l ? l + "\n" + line : line)));
  }, []);

  // 把 FileList 读成 Uint8Array，递增加入
  async function addFilesFromFileList(list: FileList | null) {
    if (!list || !list.length) return;
    const files = Array.from(list).filter(f => /\.pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!files.length) { err("请选择/拖入 PDF 文件"); return; }
    const metas: PdfSlot[] = [];
    for (const f of files) {
      const buf = new Uint8Array(await f.arrayBuffer());
      const slot = putBlob(f.name, buf);
      metas.push(slot);
    }
    setItems(prev => {
      // 去重：按 name+size 粗略去重（可换哈希更严）
      const seen = new Set(prev.map(p => p.name + "@" + p.size));
      const next = prev.slice();
      for (const m of metas) {
        const key = m.name + "@" + m.size;
        if (!seen.has(key)) { next.push(m); seen.add(key); }
      }
      return next;
    });
    log("add(binary)", metas.map(m => `${m.name} (${m.size}B)`));
  }

  // Tauri v2 文件拖拽事件：用于视觉反馈；真正的“读字节”走 DOM onDrop
  useEffect(() => {
    let un: undefined | (() => void);
    (async () => {
      try {
        un = await getCurrentWebview().onDragDropEvent((event: TauriEvent<DragDropEvent>) => {
          const t = event.payload.type;
          if (t === "enter" || t === "over") setDragOver(true);
          else if (t === "leave") setDragOver(false);
          else if (t === "drop") setDragOver(false);
        });
      } catch (e) { err("onDragDropEvent 监听失败", e); }
    })();
    return () => { try { un?.(); } catch {} };
  }, []);

  // DOM 真实 onDrop：从 DataTransfer.files 读 File 对象 ⇒ ArrayBuffer
  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    addFilesFromFileList(e.dataTransfer?.files ?? null);
  }
  function onDragOver(e: React.DragEvent)  { e.preventDefault(); setDragOver(true); }
  function onDragLeave(e: React.DragEvent) { e.preventDefault(); setDragOver(false); }

  function onPickClick() { inputRef.current?.click(); }
  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    addFilesFromFileList(e.target.files);
    // 清空 value 以便连续选择同一文件也能触发 change
    e.currentTarget.value = "";
  }

  // 单项删除
  function removeOne(id: string) {
    setItems(prev => prev.filter(x => x.id !== id));
    // 从 blob 仓库移除
    try { removeBlob(id); } catch {}
  }

  // 抖动提醒
  function pokeDropzone() {
    try {
      dzRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setNudge("invalid");
      setTimeout(() => setNudge("none"), 420);
    } catch {}
  }

  // ========= 列表内拖拽排序（HTML5 DnD） ========= //
  function move<T>(arr: T[], from: number, to: number): T[] {
    const next = arr.slice();
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    return next;
  }

  function onItemDragStart(i: number, e: React.DragEvent) {
    setDragIdx(i);
    // 仅用于标识内部拖拽，避免被外层 dropzone 误判
    e.dataTransfer.setData("text/plain", String(i));
    e.dataTransfer.effectAllowed = "move";
  }

  function onItemDragOver(i: number, e: React.DragEvent<HTMLLIElement>) {
    // 允许放置
    e.preventDefault();
    e.stopPropagation();
    // 计算指示线位置（项的上半/下半）
    const rect = (e.currentTarget as HTMLLIElement).getBoundingClientRect();
    const y = e.clientY - rect.top;
    const pos: "before" | "after" = y < rect.height / 2 ? "before" : "after";
    setHoverIdx(i);
    setHoverPos(pos);
  }

  function onItemDragLeave(_i: number, _e: React.DragEvent) {
    // 不立即清空，避免闪烁；在 drop / dragend 时统一清
  }

  function onItemDrop(i: number, e: React.DragEvent<HTMLLIElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (dragIdx == null) return;

    // 计算最终目标插入位：目标项之前/之后
    const pos = hoverPos ?? "after";
    let to = i + (pos === "after" ? 1 : 0);

    // 如果原位置在目标前且往后插，删除后索引会左移一位，修正一下
    if (dragIdx < to) to -= 1;

    if (to !== dragIdx) {
      setItems(prev => {
        const next = move(prev, dragIdx, Math.max(0, Math.min(prev.length - 1, to)));
        log("reorder", { from: dragIdx, to, names: next.map(x => x.name) });
        return next;
      });
    }

    // 清状态
    setDragIdx(null);
    setHoverIdx(null);
    setHoverPos(null);
  }

  function onItemDragEnd() {
    setDragIdx(null);
    setHoverIdx(null);
    setHoverPos(null);
  }

  async function doMerge() {
    if (items.length === 0) { err("还没有添加任何 PDF。先拖拽或选择添加。"); pokeDropzone(); return; }
    if (items.length === 1) { err("至少选择两个 PDF 才能合并。"); pokeDropzone(); return; }

    const out = await save({ defaultPath: "merged.pdf" });
    if (!out) return;

    try {
      // 从内存仓库取出 bytes，构造 IPC 载荷（BytesInput[]）
      const ids = items.map(i => i.id);
      const names = items.map(i => i.name);
      const payload = toInvokePayload(ids, names); // => [{ name, data:number[] }, ...]

      log("[merge] start", { count: payload.length, out, order: names });
      // ✅ 统一调用：merge（后端用 #[serde(untagged)] 自动识别字节/路径）
      const res = await mergePdfs(payload as any, out as string);
      log("✅ 合并完成：", res);
    } catch (e: any) {
      err("❌ 合并失败：", e?.message || e);
    }
  }

  return (
    <>
      <div className="breadcrumbs">
        <a onClick={back} style={{ cursor: "pointer" }}>← 返回</a>
      </div>
      <div className="h1">合并 PDF</div>

      <div
        ref={dzRef}
        className={[
          styles.dropzone,
          dragOver ? styles.dragover : "",
          nudge === "invalid" ? styles.invalid : "",
        ].join(" ")}
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

      <ol className={styles.fileList} aria-live="polite">
        {items.length === 0 ? (
          <li className={styles.fileEmpty}>未选择文件…</li>
        ) : (
          items.map((it, i) => (
            <li
              key={it.id}
              className={[
                styles.fileItem,
                (dragIdx === i) ? styles.dragging : "",
                (hoverIdx === i && hoverPos === "before") ? styles.dropBefore : "",
                (hoverIdx === i && hoverPos === "after") ? styles.dropAfter : "",
              ].join(" ")}
              title={`${it.name} (${it.size} bytes)`}
              draggable
              onDragStart={(e) => onItemDragStart(i, e)}
              onDragOver={(e) => onItemDragOver(i, e)}
              onDragLeave={(e) => onItemDragLeave(i, e)}
              onDrop={(e) => onItemDrop(i, e)}
              onDragEnd={onItemDragEnd}
            >
              <span className={styles.index} aria-hidden>{i + 1}</span>
              <span className={styles.fileName}>{it.name}</span>
              <span className={styles.grip} title="拖拽以重新排序" aria-label="拖拽以重新排序">⋮⋮</span>
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

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden style={{ opacity: 0.9 }}>
      <path fill="currentColor" d="M19 15v4H5v-4H3v6h18v-6h-2zM11 3v10.17l-3.59-3.58L6 11l6 6 6-6-1.41-1.41L13 13.17V3h-2z"/>
    </svg>
  );
}
