// src/App.tsx
import { useEffect, useMemo, useState } from "react";

// 页面
import Home from "./pages/Home";
import Merge from "./pages/tools/Merge";
import Compress from "./pages/tools/Compress";
import Placeholder from "./pages/tools/Placeholder";

// 兜底
import ErrorBoundary from "./shared/ErrorBoundary";
import { openDevtoolsSafe } from "./shared/devtools";

type Route =
  | { name: "home" }
  | { name: "merge" }
  | { name: "ph" }
  | { name: "convert"; kind?: string }
  | { name: "template" }
  | { name: "compress" }
  | { name: "edit" }
  | { name: "watermark" }
  | { name: "rotate" }
  | { name: "sign" };

type RouteSetter = (r: Route | string) => void;

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "home" });

  const go: RouteSetter = (r: Route | string) => {
    const next: Route = typeof r === "string" ? ({ name: r } as Route) : (r as Route);
    setRoute(next);
    console.log("route ->", next);
  };

  useEffect(() => {
    openDevtoolsSafe();

    const onErr = (e: ErrorEvent) => console.error("window.error:", e.message, e.error);
    const onRej = (e: PromiseRejectionEvent) => console.error("unhandledrejection:", e.reason);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);

    // ✅ 仅在外部“文件”拖入时拦截 dragover；内部 DnD 一律放行；不拦 drop
    const INTERNAL_DND_TYPE = "application/x-lumenpdf-index";
    const allowFilesOnly = (e: DragEvent) => {
      // 已被更内层处理过：放行
      if ((e as any).defaultPrevented) return;

      // 正在内部排序：放行
      if ((document.body as any).dataset?.sorting === "1") return;

      // 在内部排序区域：放行
      const path = (e.composedPath?.() || []) as Element[];
      const isInternalArea = path.some((el) => (el as HTMLElement)?.dataset?.dndInternal === "true");
      if (isInternalArea) return;

      const dt = e.dataTransfer;
      if (!dt) return;

      const types = Array.from(dt.types || []);
      const items = dt.items ? Array.from(dt.items) as DataTransferItem[] : [];

      // ⛳ 内部拖拽“通行证”：命中直接放行
      if (types.includes(INTERNAL_DND_TYPE)) return;

      // 更稳：优先 items 判断是否为文件
      const hasFiles = items.some(i => i.kind === "file") || types.includes("Files");
      if (!hasFiles) return;

      // 仅在 dragover 上允许外部文件投递（真正的 drop 交给目标元素处理）
      e.preventDefault();
      dt.dropEffect = "copy";
    };

    window.addEventListener("dragover", allowFilesOnly, { capture: true });
    // ❌ 不要拦 window 的 drop，否则子元素拿不到 files

    // 探针
    (async () => {
      try {
        const isTauri = typeof window !== "undefined" && "__TAURI__" in window;
        console.log("[probe] isTauri =", isTauri);
        const { getVersion, getTauriVersion } = await import("@tauri-apps/api/app");
        console.log("[probe] app version =", await getVersion?.());
        console.log("[probe] tauri core =", await getTauriVersion?.());
      } catch (e) {
        console.error("[probe] app/tauri version read failed:", e);
      }
    })();

    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
      window.removeEventListener("dragover", allowFilesOnly, { capture: true } as any);
    };
  }, []);

  const page = useMemo(() => {
    switch (route.name) {
      case "home":     return <Home go={go} />;
      case "merge":    return <Merge back={() => setRoute({ name: "home" })} />;
      case "compress": return <Compress back={() => setRoute({ name: "home" })} />;
      case "ph":
        return (
          <Placeholder
            title="占位页面"
            note="功能施工中"
            back={() => setRoute({ name: "home" })}
          />
        );
      case "convert":
      case "template":
      case "edit":
      case "watermark":
      case "rotate":
      case "sign":
        return (
          <div style={{ padding: 16 }}>
            <div className="h1">功能建设中</div>
            <p style={{ opacity: 0.8, marginTop: 8 }}>
              路由：<code>{JSON.stringify(route)}</code>
            </p>
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setRoute({ name: "home" })}>
                ← 返回首页
              </button>
            </div>
          </div>
        );
      default:
        return (
          <div style={{ padding: 16 }}>
            <div className="h1">未找到页面</div>
            <p style={{ opacity: 0.8, marginTop: 8 }}>
              未知路由：<code>{JSON.stringify(route)}</code>
            </p>
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setRoute({ name: "home" })}>
                ← 返回首页
              </button>
            </div>
          </div>
        );
    }
  }, [route]);

  return (
    <ErrorBoundary>
      <div className="container">
        <header className="header">
          <div
            className="brand"
            onClick={() => setRoute({ name: "home" })}
            style={{ cursor: "pointer" }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setRoute({ name: "home" }); }}
          >
            <div className="logo" />
            <div className="title">PDF 工具箱</div>
          </div>
          {/* 右上角按钮全部移除 */}
        </header>
        {page}
      </div>
    </ErrorBoundary>
  );
}
