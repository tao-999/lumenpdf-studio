// src-tauri/src/split.rs
use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

#[tauri::command]
pub async fn split_pdf(
    app: AppHandle,
    input: String,
    ranges: Vec<String>, // 例如 ["1-3", "8", "10-12"]
    out_dir: String,
) -> Result<Vec<String>, String> {
    if ranges.is_empty() {
        return Err("请提供至少一个页范围".into());
    }

    let mut outputs = Vec::new();
    for (i, r) in ranges.iter().enumerate() {
        // out 文件名：split_01_1-3.pdf
        let safe = r.replace(',', "_").replace(' ', "");
        let out_path = format!("{}/split_{:02}_{}.pdf", out_dir, i + 1, safe);

        // qpdf input.pdf --pages input.pdf 1-3 -- out.pdf
        let args = vec![
            input.clone(),
            "--pages".into(),
            input.clone(),
            r.clone(),
            "--".into(),
            out_path.clone(),
        ];

        let output = app
            .shell()
            .command("qpdf")
            .args(args)
            .output()
            .await
            .map_err(|e| format!("无法执行 qpdf：{e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).to_string();
            return Err(format!("qpdf 拆分失败（{}）：{stderr}", r));
        }

        outputs.push(out_path);
    }

    Ok(outputs)
}
