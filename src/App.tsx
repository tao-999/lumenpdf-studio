// src/App.tsx
import { useEffect, useMemo, useState } from "react";

// 页面
import Home from "./pages/Home";
import Merge from "./pages/tools/Merge";
import Compress from "./pages/tools/Compress";
import Placeholder from "./pages/tools/Placeholder";
import Sign from "./pages/tools/Sign";

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

    // 🧹 去掉全局 dragover 限制，避免干扰业务内的拖拽（签名拖入 PDF 等）
    // 统一由各业务组件（如 Sign 的 dropzone / PdfStage）自行处理 dragenter/over/drop

    // 探针（可留）
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
      // ❌ 不再移除 dragover，因为我们没有在 window 上注册它了
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
        return <Sign back={() => setRoute({ name: "home" })} />;
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
