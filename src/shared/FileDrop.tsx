import React, { useEffect, useRef, useState } from "react";
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import type { Event as TauriEvent } from "@tauri-apps/api/event";
import { bindDrag } from "./drag";

export type DroppedFile = {
  name: string;
  type: string;
  bytes: Uint8Array;
};

type Props = {
  /** 允许的文件名规则（例：/\.pdf$/i 或 /\.(png|jpe?g|webp)$/i） */
  accept?: RegExp;
  /** 原生 input accept 字符串（例："application/pdf,.pdf"） */
  pickAccept?: string;
  multiple?: boolean;
  onFiles: (files: DroppedFile[]) => void | Promise<void>;
  onDragState?: (over: boolean) => void; // 外部高亮用
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;

  /** 🔥 新增：忙碌态（显示 Loading、屏蔽交互） */
  busy?: boolean;
  /** 忙碌时展示的文字 */
  busyText?: string;
};

/** 统一文件选择 + 拖拽（浏览器 FileList + Tauri 路径） */
export default function FileDrop({
  accept,
  pickAccept,
  multiple = false,
  onFiles,
  onDragState,
  className,
  style,
  children,
  busy = false,
  busyText = "正在载入…",
}: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);

  // 让闭包里拿到最新 busy
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);

  // ====== 1) bindDrag：点击打开文件选择器 ======
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const drag = bindDrag({
      threshold: 3,
      clickTime: 300,
      clickDistance: 3,
      onClick: () => {
        if (busyRef.current) return;      // ⛔ 忙碌时不响应点击
        inputRef.current?.click();
      },
    });
    drag.attach(el);
    return () => drag.destroy();
  }, []);

  // ====== 2) 浏览器 DOM 拖拽 ======
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const onDragOver = (e: DragEvent) => {
      if (busyRef.current) return;        // ⛔ 忙碌时完全忽略
      e.preventDefault();
      setOver(true);
      onDragState?.(true);
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e: DragEvent) => {
      if (busyRef.current) return;
      e.preventDefault();
      setOver(false);
      onDragState?.(false);
    };
    const onDrop = async (e: DragEvent) => {
      if (busyRef.current) return;
      e.preventDefault();
      setOver(false);
      onDragState?.(false);
      const dt = e.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0) return;

      const picked: DroppedFile[] = [];
      for (const f of Array.from(dt.files)) {
        if (accept && !accept.test(f.name)) continue;
        const buf = new Uint8Array(await f.arrayBuffer());
        picked.push({ name: f.name, type: f.type || "", bytes: buf });
        if (!multiple) break;
      }
      if (picked.length) await onFiles(picked);
    };

    el.addEventListener("dragover", onDragOver);
    el.addEventListener("dragleave", onDragLeave);
    el.addEventListener("drop", onDrop);
    return () => {
      el.removeEventListener("dragover", onDragOver);
      el.removeEventListener("dragleave", onDragLeave);
      el.removeEventListener("drop", onDrop);
    };
  }, [accept, multiple, onFiles, onDragState]);

  // ====== 3) Tauri WebView 拖拽：系统级路径 -> 读字节 ======
  useEffect(() => {
    let un: undefined | (() => void);

    // 动态加载 readFile（浏览器里不会加载）
    let readFile: ((p: string) => Promise<Uint8Array>) | null = null;
    const ensureFs = async () => {
      if (readFile) return readFile;
      try {
        const m = await import("@tauri-apps/plugin-fs");
        readFile = m.readFile;
      } catch {
        readFile = null;
      }
      return readFile;
    };

    (async () => {
      try {
        un = await getCurrentWebview().onDragDropEvent(async (event: TauriEvent<DragDropEvent>) => {
          if (busyRef.current) return;     // ⛔ 忙碌时忽略所有 webview 事件

          const t = event.payload.type;
          if (t === "enter" || t === "over") {
            setOver(true); onDragState?.(true);
          } else if (t === "leave") {
            setOver(false); onDragState?.(false);
          } else if (t === "drop") {
            setOver(false); onDragState?.(false);
            const paths = (event.payload as any).paths as string[] | undefined;
            if (!paths || !paths.length) return;
            const rf = await ensureFs();
            if (!rf) return;

            const picked: DroppedFile[] = [];
            for (const p of paths) {
              const name = p.split(/[\\/]/).pop() || p;
              if (accept && !accept.test(name)) continue;
              try {
                const bytes = await rf(p);
                picked.push({ name, type: "", bytes });
                if (!multiple) break;
              } catch {}
            }
            if (picked.length) await onFiles(picked);
          }
        });
      } catch {}
    })();

    return () => { try { un?.(); } catch {} };
  }, [accept, multiple, onFiles, onDragState]);

  // ====== 4) input 选择 ======
  const onInputChange: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    if (busyRef.current) return;           // ⛔ 忙碌时忽略
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const picked: DroppedFile[] = [];
    for (const f of Array.from(files)) {
      if (accept && !accept.test(f.name)) continue;
      const buf = new Uint8Array(await f.arrayBuffer());
      picked.push({ name: f.name, type: f.type || "", bytes: buf });
      if (!multiple) break;
    }
    if (picked.length) await onFiles(picked);
    (e.target as HTMLInputElement).value = "";
  };

  // ====== Busy 覆盖层（自带菊花） ======
  const overlay =
    busy ? (
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
        <span style={{ color: "#fff", fontSize: 14, opacity: .95 }}>{busyText}</span>
        {/* 内联 keyframes */}
        <style>{`
          @keyframes fd-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        `}</style>
      </div>
    ) : null;

  return (
    <div
      ref={rootRef}
      className={className}
      style={{
        position: "relative",                   // 为 overlay 定位
        cursor: busy ? "wait" : "pointer",
        userSelect: "none",
        ...(style || {}),
      }}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (!busy && (e.key === "Enter" || e.key === " ")) inputRef.current?.click(); }}
      aria-label="上传或拖拽文件"
      aria-live="polite"
      aria-busy={busy ? true : undefined}
      aria-disabled={busy ? true : undefined}
      data-over={over ? "1" : "0"}
      data-busy={busy ? "1" : "0"}
    >
      <input
        ref={inputRef}
        type="file"
        hidden
        multiple={multiple}
        accept={pickAccept}
        onChange={onInputChange}
        disabled={busy}
      />
      {children}
      {overlay}
    </div>
  );
}
