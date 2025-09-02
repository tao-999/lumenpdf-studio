// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod merge;
mod compress;
mod sign; // ✅ 新增：签名导出模块（含 #[tauri::command] sign_and_export_pdf）

fn main() {
  tauri::Builder::default()
    // 用于保存输出文件的对话框
    .plugin(tauri_plugin_dialog::init())
    // 文件系统插件（前端 readFile/writeFile 依赖）
    .plugin(tauri_plugin_fs::init())
    // 暴露给前端调用的命令
    .invoke_handler(tauri::generate_handler![
      merge::merge,
      compress::compress,
      sign::sign_and_export_pdf, // ✅ 注册签名导出命令
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
