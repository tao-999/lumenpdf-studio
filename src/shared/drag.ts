// 纯通用 Pointer Events 拖拽内核（可区分“点击 vs 拖拽”）
// - 不依赖 DOM 结构，不产生 UI，纯事件回调
// - 起点 & 移动点都走 mapPoint，保证坐标系统一
// - 只有“越过阈值”才算拖拽；否则视为点击，触发 onClick
// - 默认不在 pointerdown 阶段 preventDefault / setPointerCapture，避免吞 click

export type DragPoint = { x: number; y: number };

export type DragInfo = {
  start: DragPoint;     // 起点（已过 mapPoint）
  point: DragPoint;     // 当前点（已过 mapPoint）
  delta: DragPoint;     // point - start
  elapsed: number;      // 从按下到当前，ms
  raw: PointerEvent;    // 原始事件
  cancel: () => void;   // 主动取消当前拖拽/点击
};

export type DragEndStatus = "end" | "cancel" | "pointercancel" | "lostcapture";

export type DragOptions = {
  /** 允许的指针类型（默认 mouse/touch/pen 全开） */
  pointerTypes?: Array<"mouse" | "touch" | "pen">;

  /** 触发拖拽的位移阈值（像素，基于映射后坐标）。默认 3 */
  threshold?: number;

  /** 点击判定的最大时长（ms）。默认 300 */
  clickTime?: number;

  /** 点击判定的最大位移（像素，基于映射后坐标）。默认同 threshold */
  clickDistance?: number;

  /** 拖拽开始后是否禁用文本选择。默认 true */
  disableTextSelectOnDrag?: boolean;

  /** 是否在“真正开始拖拽”时才 setPointerCapture。默认 true */
  captureOnStart?: boolean;

  /** 是否在 pointerdown 就 preventDefault。默认 false（保留 click 语义） */
  preventDefaultOnDown?: boolean;

  /** 坐标映射/限制（比如转成容器内局部坐标或吸附网格） */
  mapPoint?: (p: DragPoint, ev: PointerEvent) => DragPoint;

  /** 拖拽真正开始（首次越过阈值） */
  onStart?: (info: DragInfo) => void;

  /** 拖拽中（每次移动） */
  onMove?: (info: DragInfo) => void;

  /** 拖拽结束（仅对“已开始的拖拽”触发） */
  onEnd?: (info: DragInfo, status: DragEndStatus) => void;

  /** 点击结束（未越过阈值且时间/位移在容差内） */
  onClick?: (info: DragInfo) => void;
};

export type DragHandle = {
  attach: (el: HTMLElement) => void;
  cancel: () => void;
  destroy: () => void;
  dragging: () => boolean;  // 是否处于“已开始拖拽”状态
};

export function bindDrag(opts: DragOptions = {}): DragHandle {
  const pointerTypes = new Set(opts.pointerTypes ?? ["mouse", "touch", "pen"]);
  const threshold = Math.max(0, opts.threshold ?? 3);
  const clickTime = Math.max(0, opts.clickTime ?? 300);
  const clickDistance = Math.max(0, opts.clickDistance ?? threshold);
  const disableSelOnDrag = opts.disableTextSelectOnDrag ?? true;
  const captureOnStart = opts.captureOnStart ?? true;
  const preventDown = opts.preventDefaultOnDown ?? false;

  let attachedEl: HTMLElement | null = null;
  let pointerId = -1;
  let t0 = 0;

  // 统一坐标系：起点、移动点都走 mapPoint
  let started = false; // 是否已判定为“拖拽”
  let pressing = false; // 是否按下中（包含点击或即将成为拖拽）
  let start: DragPoint = { x: 0, y: 0 };

  let savedUserSelect = "";

  const map = (p: DragPoint, ev: PointerEvent) => (opts.mapPoint ? opts.mapPoint(p, ev) : p);
  const sub = (a: DragPoint, b: DragPoint): DragPoint => ({ x: a.x - b.x, y: a.y - b.y });
  const dist2 = (d: DragPoint) => d.x * d.x + d.y * yClamp(d).y * yClamp(d).y; // 保守：避免 NaN
  function yClamp(d: DragPoint) { return { x: isFinite(d.x) ? d.x : 0, y: isFinite(d.y) ? d.y : 0 }; }

  function setUserSelectNone() {
    if (!disableSelOnDrag) return;
    const el = document.documentElement as HTMLElement;
    savedUserSelect = el.style.userSelect || "";
    el.style.userSelect = "none";
  }
  function restoreUserSelect() {
    if (!disableSelOnDrag) return;
    (document.documentElement as HTMLElement).style.userSelect = savedUserSelect;
  }

  function cleanupListeners() {
    window.removeEventListener("pointermove", onMove as any, { capture: true } as any);
    window.removeEventListener("pointerup", onUp as any, { capture: true } as any);
    window.removeEventListener("pointercancel", onCancel as any, { capture: true } as any);
    window.removeEventListener("lostpointercapture", onLost as any, { capture: true } as any);
  }

  function cancelInternal(status: DragEndStatus = "cancel", raw?: PointerEvent) {
    if (!pressing) return;
    if (attachedEl && pointerId !== -1 && (started && captureOnStart)) {
      try { attachedEl.releasePointerCapture(pointerId); } catch {}
    }
    cleanupListeners();
    restoreUserSelect();

    // 已经开始拖拽才调用 onEnd；点击/未开始不调用 onEnd
    if (started && opts.onEnd && raw) {
      const now = performance.now();
      const point = map({ x: raw.clientX, y: raw.clientY }, raw);
      const delta = sub(point, start);
      opts.onEnd({ start, point, delta, elapsed: now - t0, raw, cancel: () => cancelInternal("cancel", raw) }, status);
    }

    pressing = false;
    started = false;
    pointerId = -1;
  }

  function onDown(e: PointerEvent) {
    // 左键/允许的指针类型
    if (e.button !== 0 || !pointerTypes.has(e.pointerType as any)) return;

    attachedEl = e.currentTarget as HTMLElement;
    pointerId = e.pointerId;
    pressing = true;
    started = false;
    t0 = performance.now();
    start = map({ x: e.clientX, y: e.clientY }, e);

    if (preventDown) e.preventDefault();

    // 仅注册监听；不立即 capture，不禁用选择
    window.addEventListener("pointermove", onMove as any, { capture: true, passive: false });
    window.addEventListener("pointerup", onUp as any, { capture: true, passive: false });
    window.addEventListener("pointercancel", onCancel as any, { capture: true, passive: false });
    window.addEventListener("lostpointercapture", onLost as any, { capture: true, passive: false });
  }

  function onMove(e: PointerEvent) {
    if (!pressing || e.pointerId !== pointerId) return;

    const point = map({ x: e.clientX, y: e.clientY }, e);
    const delta = sub(point, start);
    const now = performance.now();

    if (!started) {
      // 是否越过阈值 → 认定为拖拽
      const d2 = delta.x * delta.x + delta.y * delta.y;
      if (d2 >= threshold * threshold) {
        started = true;

        if (captureOnStart) {
          try { attachedEl?.setPointerCapture(pointerId); } catch {}
        }
        setUserSelectNone();
        // 进入拖拽后，阻止滚动/选择
        e.preventDefault();

        opts.onStart?.({ start, point, delta, elapsed: now - t0, raw: e, cancel: () => cancelInternal("cancel", e) });
      } else {
        // 尚未开始拖拽，保持点击可能性；不 preventDefault
        return;
      }
    }

    // 已在拖拽
    opts.onMove?.({ start, point, delta, elapsed: now - t0, raw: e, cancel: () => cancelInternal("cancel", e) });
    e.preventDefault();
  }

  function onUp(e: PointerEvent) {
    if (!pressing || e.pointerId !== pointerId) return;

    const point = map({ x: e.clientX, y: e.clientY }, e);
    const delta = sub(point, start);
    const elapsed = performance.now() - t0;

    if (started) {
      // 结束拖拽
      cancelInternal("end", e);
    } else {
      // 视为点击：位移/时间都在容差内
      const d2 = delta.x * delta.x + delta.y * delta.y;
      if (d2 <= clickDistance * clickDistance && elapsed <= clickTime) {
        // 派发 onClick
        opts.onClick?.({ start, point, delta, elapsed, raw: e, cancel: () => cancelInternal("cancel", e) });
      }
      // 无论是否 onClick，最后清理状态
      cleanupListeners();
      pressing = false;
      pointerId = -1;
    }
  }

  function onCancel(e: PointerEvent) {
    if (!pressing || e.pointerId !== pointerId) return;
    if (started) cancelInternal("pointercancel", e);
    else cancelInternal("cancel", e);
  }

  function onLost(e: PointerEvent) {
    // 某些内核丢 capture；仅在已开始拖拽时可视为取消
    if (started) cancelInternal("lostcapture", e as any);
    else cancelInternal("cancel", e as any);
  }

  function attach(el: HTMLElement) {
    el.addEventListener("pointerdown", onDown as any, { passive: false });
  }

  function cancel() {
    cancelInternal("cancel");
  }

  function destroy() {
    attachedEl?.removeEventListener("pointerdown", onDown as any);
    cancelInternal("cancel");
  }

  return { attach, cancel, destroy, dragging: () => started };
}
