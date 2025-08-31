mod ops {
    pub mod merge;
    pub mod split;
}

#[tauri::command]
fn ping() -> String { "pong".into() }

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init()) // 前端 open/save 用
        .invoke_handler(tauri::generate_handler![
            ping,
            ops::merge::merge_pdfs,
            ops::split::split_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri app");
}
