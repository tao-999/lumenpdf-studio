// src/shared/logger.ts
// —— 超凶但不自咬的日志器 ——
// 修复点：
// 1) 只用“原始 console”写控制台，避免递归
// 2) 重入锁 _inEmit 防止环路
// 3) 安全序列化，错误包含 stack，循环结构不炸
// 4) HMR/重复注入保护（__LOGGER_PATCHED）

type Sink = (line: string) => void;
let sink: Sink | null = null;
export function bindUiSink(s: Sink) { sink = s; }

// 已经打过补丁就别再绑，防止 HMR 重复覆盖
// @ts-ignore
if ((console as any).__LOGGER_PATCHED__ !== true) {
  // 备份“原始 console”到闭包（一定要 bind，不然 this 丢失）
  const raw = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  let _inEmit = false;

  function safeText(a: any): string {
    try {
      if (a instanceof Error) {
        // 错误优先展示 message + stack
        return `${a.name}: ${a.message}\n${a.stack ?? ""}`;
      }
      if (typeof a === "string") return a;
      // JSON 尝试：避免循环
      return JSON.stringify(a, (_k, v) => {
        // 过滤 DOM 节点/函数等
        if (typeof v === "function") return `[Function ${v.name || "anonymous"}]`;
        if (v instanceof Node) return `[Node ${v.nodeName}]`;
        return v;
      }, 2);
    } catch {
      try { return String(a); } catch { return "[Unserializable]"; }
    }
  }

  function emit(kind: "LOG" | "WARN" | "ERROR", ...args: any[]) {
    if (_inEmit) return;           // 防重入
    _inEmit = true;
    try {
      const time = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
      const text = args.map(safeText).join(" ");
      const line = `[${time}] ${kind} ${text}`;

      // 只用“原始 console”输出，绝不调用被代理后的 console
      if (kind === "ERROR") raw.error(line);
      else if (kind === "WARN") raw.warn(line);
      else raw.log(line);

      // 同步到 UI
      sink?.(line);
    } finally {
      _inEmit = false;
    }
  }

  // 代理 console.*：先走原始输出，再镜像到 UI（调用 emit，而 emit 又走原始 console，不会递归）
  console.log = (...a: any[]) => { raw.log(...a); emit("LOG", ...a); };
  console.warn = (...a: any[]) => { raw.warn(...a); emit("WARN", ...a); };
  console.error = (...a: any[]) => { raw.error(...a); emit("ERROR", ...a); };

  if (typeof window !== "undefined") {
    window.addEventListener("error", (e) => {
      emit("ERROR", e.message, e.filename, `${e.lineno}:${e.colno}`, e.error ?? "");
    });
    window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
      emit("ERROR", "UnhandledRejection", e.reason);
    });
  }

  // @ts-ignore
  (console as any).__LOGGER_PATCHED__ = true;

  // 导出便捷函数
  // @ts-ignore
  (window as any).__emitLoggerLine__ = emit; // 调试用，可随时 window.__emitLoggerLine__('LOG','hi')
}

// 导出 API（用 emit 的轻量包装）
export const log  = (...a: any[]) => (window as any).__emitLoggerLine__?.("LOG",  ...a);
export const warn = (...a: any[]) => (window as any).__emitLoggerLine__?.("WARN", ...a);
export const err  = (...a: any[]) => (window as any).__emitLoggerLine__?.("ERROR",...a);
