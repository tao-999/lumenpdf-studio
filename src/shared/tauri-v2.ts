// src/shared/tauri-v2.ts
import { getCurrentWebview, type DragDropEvent } from "@tauri-apps/api/webview";
import type { Event as TauriEvent, UnlistenFn } from "@tauri-apps/api/event";

/** v2 拖拽事件（回调参数是 Event<DragDropEvent>，从 event.payload 取值） */
export async function onDragDrop(
  cb: (ev: TauriEvent<DragDropEvent>) => void
): Promise<UnlistenFn> {
  return getCurrentWebview().onDragDropEvent(cb);
}

/** DevTools：v2 JS 侧没有 openDevtools()，这里留空避免误用 */
export async function openDevtoolsSafe(): Promise<void> {
  // 打开面板请用快捷键（Windows/Linux: Ctrl+Shift+I，macOS: Cmd+Option+I）
  // 或在 tauri 配置启用 devtools；如需代码打开，走 Rust 端 window.open_devtools()（非 Windows）
}
