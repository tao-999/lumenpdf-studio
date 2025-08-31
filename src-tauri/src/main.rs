#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod merge; // 👈 独立模块

fn main() {
  tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_dialog::init())
    // 只注册一个命令：merge::merge
    .invoke_handler(tauri::generate_handler![
      merge::merge
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
