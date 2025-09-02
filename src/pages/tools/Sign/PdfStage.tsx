import React, { useEffect, useMemo, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { Stamp } from "./types";
import { renderPageToCanvas } from "./pdf";
// ✅ 引入你的日志工具
import { log, err } from "../../../shared/logger";

type Meta = { wPx: number; hPx: number; scale: number };

function makeBaseKey(idx: number, metas: Meta[]) {
  const m = metas[idx];
  if (!m) return "none";
  return `B:${idx}:${Math.round(m.wPx)}x${Math.round(m.hPx)}@${m.scale}`;
}

function blitTo(dst: HTMLCanvasElement, src: HTMLCanvasElement, W: number, H: number) {
  dst.width = Math.round(W);
  dst.height = Math.round(H);
  dst.style.width = `${W}px`;
  dst.style.height = `${H}px`;
  const ctx = dst.getContext("2d", { alpha: false })!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, dst.width, dst.height);
  ctx.drawImage(src, 0, 0, dst.width, dst.height);
}

const DUR = 260;
const MAX_CACHE = 18;
function pruneCache(cache: Record<string, { cvs: HTMLCanvasElement; key: string }>) {
  const keys = Object.keys(cache);
  if (keys.length <= MAX_CACHE) return;
  const drop = keys.slice(0, keys.length - MAX_CACHE);
  for (const k of drop) {
    try { cache[k].cvs.width = 0; cache[k].cvs.height = 0; } catch {}
    delete cache[k];
  }
}

export default function PdfStage({
  stageRef,
  pdfRef,
  numPages,
  pageMetas,
  page,
  stamps,
  selectedId,
  setSelectedId,
  onPatchStamp,
  onRemoveStamp,
}: {
  stageRef?: React.MutableRefObject<HTMLDivElement | null>;
  pdfRef: MutableRefObject<any | null> | any;
  numPages: number;
  pageMetas: Meta[];
  page: number;
  stamps: Stamp[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  onPatchStamp: (id: string, patch: Partial<Stamp>) => void;
  onRemoveStamp: (id: string) => void;
}) {
  const ready = useMemo(() => numPages > 0 && pageMetas.length === numPages, [numPages, pageMetas]);

  const cacheRef = useRef<Record<string, { cvs: HTMLCanvasElement; key: string }>>({});
  const taskRef = useRef<Record<string, Promise<void>>>({});

  const pdfAlive = () => {
    const pdf = (pdfRef?.current ?? pdfRef) as any;
    return !!pdf && typeof pdf.getPage === "function" && typeof pdf.numPages === "number";
  };

  async function ensureBase(idx: number): Promise<HTMLCanvasElement | null> {
    if (!ready || !pdfAlive()) return null;
    if (idx < 0 || idx >= numPages) return null;
    const key = makeBaseKey(idx, pageMetas);
    if (key === "none") return null;

    const hit = cacheRef.current[key];
    if (hit && hit.key === key) return hit.cvs;

    const tkey = `p${idx}:${key}`;
    if (!taskRef.current[tkey]) {
      taskRef.current[tkey] = (async () => {
        const cvs = hit?.cvs || document.createElement("canvas");
        await renderPageToCanvas(pdfRef, pageMetas, idx, cvs, []); // 只渲 PDF
        cacheRef.current[key] = { cvs, key };
        pruneCache(cacheRef.current);
      })().finally(() => { delete taskRef.current[tkey]; });
    }
    await taskRef.current[tkey];
    return cacheRef.current[key]?.cvs ?? null;
  }

  const [frontIdx, setFrontIdx] = useState(page);
  useEffect(() => { setFrontIdx(page); }, []);

  const [anim, setAnim] = useState<{ to: number; dir: 1 | -1 } | null>(null);
  const sizeIdx = anim ? anim.to : frontIdx;
  const { W, H } = useMemo(() => {
    const m = pageMetas[sizeIdx] || { wPx: 600, hPx: 800, scale: 1 };
    return { W: m.wPx, H: m.hPx };
  }, [sizeIdx, pageMetas]);

  const frontCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const backCanvasRef  = useRef<HTMLCanvasElement | null>(null);
  const overlayRef     = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ready || !pdfAlive()) return;
    let stop = false;
    (async () => {
      const base = await ensureBase(frontIdx);
      if (!stop && base && frontCanvasRef.current) blitTo(frontCanvasRef.current, base, W, H);
    })();
    return () => { stop = true; };
  }, [ready, frontIdx, W, H, pageMetas]);

  useEffect(() => {
    const backEl = backCanvasRef.current;
    const overlay = overlayRef.current;
    if (!backEl || !overlay) return;

    backEl.style.transition = "none";
    backEl.width  = Math.round(W);
    backEl.height = Math.round(H);
    backEl.style.width  = `${W}px`;
    backEl.style.height = `${H}px`;
    const bctx = backEl.getContext("2d", { alpha: false });
    if (bctx) { bctx.fillStyle = "#fff"; bctx.fillRect(0, 0, backEl.width, backEl.height); }
    backEl.style.transform = "translateX(100%)";

    overlay.style.transition = "none";
    overlay.style.transform  = "translateX(0%)";
  }, [W, H]);

  useEffect(() => {
    if (!ready || !pdfAlive()) return;
    const around = [frontIdx - 1, frontIdx + 1, page].filter(i => i >= 0 && i < numPages);
    around.forEach(i => { void ensureBase(i); });
  }, [ready, frontIdx, page, pageMetas, numPages]);

  const prevWantedRef = useRef(page);
  useEffect(() => {
    if (!ready || !pdfAlive()) return;

    const from = frontIdx, to = page;
    if (to === from || to === prevWantedRef.current) { prevWantedRef.current = page; return; }
    prevWantedRef.current = page;

    let cancelled = false;
    (async () => {
      const backBase = await ensureBase(to);
      if (cancelled || !backBase) return;

      if (frontCanvasRef.current) {
        const curBase = await ensureBase(from);
        if (curBase) blitTo(frontCanvasRef.current, curBase, W, H);
      }

      const dir: 1 | -1 = to > from ? 1 : -1;
      if (backCanvasRef.current) blitTo(backCanvasRef.current, backBase, W, H);

      const frontEl = frontCanvasRef.current!;
      const backEl  = backCanvasRef.current!;
      const overlay = overlayRef.current!;
      const baseTransition = `transform ${DUR}ms ease-out`;

      frontEl.style.transition = "none";
      backEl .style.transition = "none";
      overlay.style.transition = "none";
      frontEl.style.transform = `translateX(0%)`;
      backEl .style.transform = `translateX(${dir * 100}%)`;
      overlay.style.transform = `translateX(0%)`;

      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);

      frontEl.style.transition = baseTransition;
      backEl .style.transition = baseTransition;
      overlay.style.transition = baseTransition;

      frontEl.style.transform = `translateX(${-dir * 100}%)`;
      backEl .style.transform = `translateX(0%)`;
      overlay.style.transform = `translateX(${-dir * 100}%)`;

      setAnim({ to, dir });

      const timer = setTimeout(async () => {
        if (cancelled) return;
        blitTo(frontEl, backEl, W, H);
        setFrontIdx(to);
        setAnim(null);

        frontEl.style.transition = "none";
        backEl .style.transition = "none";
        overlay.style.transition = "none";
        frontEl.style.transform = `translateX(0%)`;
        backEl .style.transform = `translateX(100%)`;
        overlay.style.transform = `translateX(0%)`;

        const newBase = await ensureBase(to);
        if (newBase) blitTo(frontEl, newBase, W, H);
      }, DUR + 50);
      return () => clearTimeout(timer);
    })();

    return () => { cancelled = true; };
  }, [ready, page, W, H, frontIdx, pageMetas, numPages]);

  const stageStyle: React.CSSProperties = {
    position: "relative",
    width: W, height: H,
    margin: "12px 0",
    borderRadius: 6,
    overflow: "hidden",
    background: "#111",
    outline: "1px solid rgba(255,255,255,.06)",
    contain: "layout paint size",
    touchAction: "none",
  };
  const canvasCommon: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    willChange: "transform",
    transition: "none",
    transform: "translateX(0%) translateZ(0)",
    background: "#fff",
  };

  return (
    <div style={{ display: "flex", justifyContent: "center" }}>
      <div ref={stageRef ?? undefined} style={stageStyle}>
        <canvas ref={frontCanvasRef} style={{ ...canvasCommon, zIndex: 2 }} />
        <canvas ref={backCanvasRef}  style={{ ...canvasCommon, zIndex: 3, transform: "translateX(100%) translateZ(0)" }} />

        <div
          ref={overlayRef}
          data-stamp-overlay-root="1"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 4,
            willChange: "transform",
            transition: "none",
            transform: "translateX(0%) translateZ(0)",
            touchAction: "none",
            overflow: "visible",
          }}
          onPointerDown={(e) => { if (e.currentTarget === e.target) setSelectedId(null); }}
        >
          {stamps.filter(s => s.pageIndex === frontIdx).map(s => (
            <StampItem
              key={s.id}
              s={s}
              selected={selectedId === s.id}
              setSelectedId={setSelectedId}
              onPatch={onPatchStamp}
              onRemove={onRemoveStamp}
              overlayRef={overlayRef}
              W={W} H={H}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 单个签名：拖拽 translate3d 预览；缩放写 width/height；未选中隐藏控件 */
function StampItem({
  s, selected, setSelectedId, onPatch, onRemove, overlayRef, W, H
}: {
  s: Stamp;
  selected: boolean;
  setSelectedId: (id: string | null) => void;
  onPatch: (id: string, patch: Partial<Stamp>) => void;
  onRemove: (id: string) => void;
  overlayRef: React.MutableRefObject<HTMLDivElement | null>;
  W: number; H: number;
}) {
  const rootRef   = useRef<HTMLDivElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const delRef    = useRef<HTMLButtonElement | null>(null);

  const sRef = useRef(s);
  useEffect(() => { sRef.current = s; });

  const moveRef = useRef({ dx: 0, dy: 0 });
  const rafRef  = useRef<number | null>(null);
  const resizingRef = useRef(false);

  const applyTranslate = (el: HTMLElement) => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const { dx, dy } = moveRef.current;
    rafRef.current = requestAnimationFrame(() => {
      el.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    });
  };
  const resetTranslate = (el: HTMLElement) => {
    moveRef.current = { dx: 0, dy: 0 };
    el.style.transform = "translate3d(0,0,0)";
    el.style.willChange = "";
  };

  // 拖拽
  useEffect(() => {
    const el = rootRef.current, overlay = overlayRef.current, handle = handleRef.current;
    if (!el || !overlay) return;

    let startX = 0, startY = 0;
    let baseX  = 0, baseY  = 0;

    const onDown = (ev: PointerEvent) => {
      // 日志：记录是否点到控件
      const onCtrl = !!(ev.target as HTMLElement)?.closest?.('[data-stamp-ctrl="1"]');
      log("[stamp][down]", { id: sRef.current.id, onCtrl });

      if (onCtrl) return;                // 点在控件上：不进入拖拽
      if (ev.button !== 0) return;
      if (resizingRef.current) return;

      setSelectedId(sRef.current.id);

      const r = overlay.getBoundingClientRect();
      startX = ev.clientX - r.left;
      startY = ev.clientY - r.top;
      baseX  = sRef.current.x;
      baseY  = sRef.current.y;

      el.style.willChange = "transform";
      try { el.setPointerCapture(ev.pointerId); } catch {}
      ev.preventDefault();

      const onMove = (e: PointerEvent) => {
        const rr = overlay.getBoundingClientRect();
        const cx = e.clientX - rr.left;
        const cy = e.clientY - rr.top;
        const cur = sRef.current;

        const nx = Math.max(0, Math.min(W - cur.w, baseX + (cx - startX)));
        const ny = Math.max(0, Math.min(H - cur.h, baseY + (cy - startY)));

        moveRef.current.dx = nx - cur.x;
        moveRef.current.dy = ny - cur.y;
        applyTranslate(el);
        e.preventDefault();
      };

      const onUp = (e: PointerEvent) => {
        try { el.releasePointerCapture(e.pointerId); } catch {}
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);

        const cur = sRef.current;
        const nx = Math.max(0, Math.min(W - cur.w, cur.x + moveRef.current.dx));
        const ny = Math.max(0, Math.min(H - cur.h, cur.y + moveRef.current.dy));
        resetTranslate(el);
        if (nx !== cur.x || ny !== cur.y) onPatch(cur.id, { x: nx, y: ny });
      };

      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
    };

    el.addEventListener("pointerdown", onDown, { passive: false });
    return () => {
      el.removeEventListener("pointerdown", onDown as any);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [overlayRef, W, H, onPatch, setSelectedId]);

  // 缩放
  useEffect(() => {
    const el = rootRef.current, handle = handleRef.current, overlay = overlayRef.current;
    if (!el || !handle || !overlay) return;

    const R = 0.25;
    let startW = 0;
    let startX = 0;
    let lastW = sRef.current.w, lastH = sRef.current.h;

    const onDown = (ev: PointerEvent) => {
      ev.stopPropagation();
      if (ev.button !== 0) return;

      setSelectedId(sRef.current.id);
      resizingRef.current = true;

      const cur = sRef.current;
      startW = cur.w;
      const r = overlay.getBoundingClientRect();
      startX = ev.clientX - r.left;

      moveRef.current = { dx: 0, dy: 0 };
      el.style.transform = "translate3d(0,0,0)";
      el.style.willChange = "width, height";

      try { handle.setPointerCapture(ev.pointerId); } catch {}
      ev.preventDefault();

      const onMove = (e: PointerEvent) => {
        e.stopPropagation();

        const rr = overlay.getBoundingClientRect();
        const cx = e.clientX - rr.left;

        const cur2 = sRef.current;
        let w = Math.max(24, startW + (cx - startX));
        const maxWByRight  = W - cur2.x;
        const maxWByBottom = (H - cur2.y) * (1 / R);
        w = Math.min(w, maxWByRight, maxWByBottom);
        const h = Math.round(w * R);

        lastW = w; lastH = h;

        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(() => {
          el.style.width  = `${w}px`;
          el.style.height = `${h}px`;
        });

        e.preventDefault();
      };

      const onUp = (e: PointerEvent) => {
        e.stopPropagation();
        try { handle.releasePointerCapture(e.pointerId); } catch {}
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);

        el.style.willChange = "";
        resizingRef.current = false;

        const cur = sRef.current;
        if (lastW !== cur.w || lastH !== cur.h) onPatch(cur.id, { w: lastW, h: lastH });
      };

      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
    };

    handle.addEventListener("pointerdown", onDown, { passive: false });
    return () => handle.removeEventListener("pointerdown", onDown as any);
  }, [overlayRef, W, H, onPatch, setSelectedId]);

  // ✅ 删除按钮：原生捕获阶段拦截 + 原生 click 直接删除 + 日志
  useEffect(() => {
    const btn = delRef.current;
    if (!btn) return;

    const stopCapture = (ev: Event) => {
      log("[del][capture]", { type: ev.type, id: sRef.current.id });
      ev.stopPropagation();        // 阻断到根节点的 pointerdown（你那边的拖拽）
      // 不要 preventDefault：让 click 正常派发
    };
    const onNativeClick = (ev: Event) => {
      log("[del][native-click]", { id: sRef.current.id });
      ev.stopPropagation();
      try {
        onRemove(sRef.current.id);
        log("[del][removed]", { id: sRef.current.id });
      } catch (e: any) {
        err("[del][error]", e?.message || String(e));
      }
    };

    btn.addEventListener("pointerdown", stopCapture, { capture: true });
    btn.addEventListener("mousedown",  stopCapture, { capture: true });
    btn.addEventListener("click",      onNativeClick); // 冒泡阶段即可

    return () => {
      btn.removeEventListener("pointerdown", stopCapture, { capture: true } as any);
      btn.removeEventListener("mousedown",  stopCapture, { capture: true } as any);
      btn.removeEventListener("click",      onNativeClick);
    };
  }, [onRemove]);

  return (
    <div
      ref={rootRef}
      style={{
        position: "absolute",
        left: s.x, top: s.y,
        width: s.w, height: s.h,
        transform: "translate3d(0,0,0)",
        transformOrigin: "top left",

        overflow: "visible",
        contain: "layout",
        zIndex: selected ? 1000 : 1,

        border: selected ? "1px solid #4da3ff" : "1px solid transparent",
        boxShadow: selected ? "0 0 0 2px rgba(77,163,255,.25)" : "none",
        cursor: "move",
        userSelect: "none",
        touchAction: "none",
      }}
      title="点击选中；拖动移动；右下角拖动缩放；右上角×删除"
    >
      <img
        src={s.url}
        draggable={false}
        decoding="async"
        style={{ width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none", display: "block", zIndex: 1 }}
        alt=""
      />

      {/* 删除：中心对右上角顶点 */}
      {selected && (
        <button
          ref={delRef}
          type="button"
          data-stamp-ctrl="1"
          title="删除此签名"
          style={{
            position: "absolute",
            top: 0, right: 0,
            width: 20, height: 20,
            transform: "translate(50%,-50%)",
            borderRadius: 10,
            border: "none",
            background: "#ff4d4f",
            color: "#fff",
            fontSize: 12,
            lineHeight: "20px",
            padding: 0,
            cursor: "pointer",
            boxShadow: "0 0 0 2px rgba(0,0,0,.2)",
            zIndex: 1002,
            pointerEvents: "auto",
          }}
        >×</button>
      )}

      {/* 缩放：中心对右下角顶点 */}
      {selected && (
        <div
          ref={handleRef}
          data-stamp-ctrl="1"
          style={{
            position: "absolute",
            right: 0, bottom: 0,
            width: 16, height: 16,
            transform: "translate(50%,50%)",
            background: "#4da3ff",
            borderRadius: 4,
            cursor: "nwse-resize",
            boxShadow: "0 0 0 2px rgba(0,0,0,.25)",
            touchAction: "none",
            pointerEvents: "auto",
            zIndex: 1001,
          }}
        />
      )}
    </div>
  );
}
