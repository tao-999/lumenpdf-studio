import { useEffect, useMemo, useState } from "react";

// 页面
import Home from "./pages/Home";
import Merge from "./pages/tools/Merge";
import Split from "./pages/tools/Split";
import Placeholder from "./pages/tools/Placeholder";

// 兜底
import ErrorBoundary from "./shared/ErrorBoundary";
import { openDevtoolsSafe } from "./shared/devtools";

type Route =
  | { name: "home" }
  | { name: "merge" }
  | { name: "split" }
  | { name: "ph" }
  | { name: "convert"; kind: string }
  | { name: "template" }
  | { name: "compress" }
  | { name: "edit" }
  | { name: "watermark" }
  | { name: "rotate" }
  | { name: "sign" };

type RouteSetter = (r: any) => void;

export default function App() {
  const [route, setRoute] = useState<Route>({ name: "home" });

  const go: RouteSetter = (r: any) => {
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

  // 🔥 只加这一段：允许浏览器层的拖拽，不让默认行为吞掉事件
  const allow = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };
  window.addEventListener("dragover", allow);
  window.addEventListener("drop", allow);

  // 你爱留的探针……
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
    window.removeEventListener("dragover", allow);  // ← 记得卸载
    window.removeEventListener("drop", allow);      // ← 记得卸载
  };
}, []);

  const page = useMemo(() => {
    switch (route.name) {
      case "home":   return <Home go={go} />;
      case "merge":  return <Merge back={() => setRoute({ name: "home" })} />;
      case "split":  return <Split back={() => setRoute({ name: "home" })} />;

      case "ph":     return (
        <Placeholder
          title="占位页面"
          note="功能施工中"
          back={() => setRoute({ name: "home" })}
        />
      );

      case "convert":
      case "template":
      case "compress":
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
          >
            <div className="logo" />
            <div className="title">PDF 工具箱</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => setRoute({ name: "home" })}>首页</button>
          </div>
        </header>
        {page}
      </div>
    </ErrorBoundary>
  );
}
