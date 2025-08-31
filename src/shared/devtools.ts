// 兼容 v1/v2 的安全打开 DevTools（不会因命名导出在编译期报错）
export async function openDevtoolsSafe() {
  try {
    // v2: @tauri-apps/api/webview
    const modV2 = await import("@tauri-apps/api/webview").catch(() => null as any);
    const getCurrentWebview = modV2?.getCurrentWebview;
    const WebviewWindowV2 = modV2?.WebviewWindow;
    if (typeof getCurrentWebview === "function") {
      const cur = getCurrentWebview();
      if (cur?.openDevtools) { await cur.openDevtools(); return; }
    }
    if (WebviewWindowV2?.getCurrent) {
      const cur = WebviewWindowV2.getCurrent();
      if (cur?.openDevtools) { await cur.openDevtools(); return; }
    }

    // v1: @tauri-apps/api/window
    const modV1 = await import("@tauri-apps/api/window").catch(() => null as any);
    const getCurrentV1 = modV1?.getCurrent;
    const WebviewWindowV1 = modV1?.WebviewWindow;
    if (typeof getCurrentV1 === "function") {
      const cur = getCurrentV1();
      if (cur?.openDevtools) { await cur.openDevtools(); return; }
    }
    if (WebviewWindowV1?.getCurrent) {
      const cur = WebviewWindowV1.getCurrent();
      if (cur?.openDevtools) { await cur.openDevtools(); return; }
    }
  } catch { /* 发行版可能禁用，忽略 */ }
}
