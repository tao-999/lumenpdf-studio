/// <reference types="node" />

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

// 用 loadEnv 取 TAURI_DEV_HOST，避免奇怪的类型告警
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const host = env.TAURI_DEV_HOST || false;

  return {
    plugins: [
      react(),
      // 把 pdfjs 的 cmaps / fonts 复制到 /pdfjs/（dev+build 都生效）
      viteStaticCopy({
        targets: [
          { src: "node_modules/pdfjs-dist/cmaps",          dest: "pdfjs" },
          { src: "node_modules/pdfjs-dist/standard_fonts", dest: "pdfjs" },
        ],
      }),
    ],

    // 强制只用一份 React，干掉重复实例导致的 Hook 报错/白屏
    resolve: {
      dedupe: ["react", "react-dom"],
    },

    // 避免 pdfjs 被预打包导致 worker/cmaps 路径错乱
    optimizeDeps: { exclude: ["pdfjs-dist"] },

    // —— Tauri 原有配置 —— //
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host,
      hmr: host
        ? { protocol: "ws", host, port: 1421 }
        : undefined,
      watch: { ignored: ["**/src-tauri/**"] },
    },
  };
});
