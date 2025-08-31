// src-tauri/src/main.rs
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod merge;
mod compress;

fn main() {
  tauri::Builder::default()
    // 用于保存输出文件的对话框
    .plugin(tauri_plugin_dialog::init())
    // ✅ 新增：文件系统插件（前端 readBinaryFile() 依赖它）
    .plugin(tauri_plugin_fs::init())
    // 你暴露给前端调用的命令
    .invoke_handler(tauri::generate_handler![
      merge::merge,
      compress::compress,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
