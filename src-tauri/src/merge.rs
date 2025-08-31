//! Merge PDFs — qpdf direct exec (support subdir layout, linearized)
use tauri::{AppHandle, Manager};
use serde::Deserialize;
use std::{
  fs, ffi::OsStr,
  path::{Path, PathBuf},
  process::Command,
  time::{SystemTime, UNIX_EPOCH},
};

#[derive(Deserialize, Clone)]
pub struct PdfIn { pub name: String, pub data: Vec<u8> }

#[derive(Deserialize)]
#[serde(untagged)]
pub enum Inputs {
  Paths(Vec<String>),
  Bytes(Vec<PdfIn>),
}

#[tauri::command]
pub async fn merge(app: AppHandle, inputs: Inputs, output: String) -> Result<String, String> {
  ensure_parent_dir(&output)?;
  match inputs {
    Inputs::Paths(paths) => {
      if paths.len() < 2 { return Err("请选择至少两个 PDF（路径版）".into()); }
      assert_output_not_in_inputs(&paths, &output)?;
      let args = build_args_merge_paths(&paths, &output);
      run_qpdf(&app, &args).await?;
      Ok(output)
    }
    Inputs::Bytes(items) => {
      if items.len() < 2 { return Err("请选择至少两个 PDF（字节版）".into()); }
      let (work, paths) = write_temp_pdfs(&app, &items)?;
      assert_output_not_in_inputs(&paths, &output)?;
      let args = build_args_merge_paths(&paths, &output);
      let res = run_qpdf(&app, &args).await;
      let _ = fs::remove_dir_all(&work);
      res.map(|_| output)
    }
  }
}

fn ensure_parent_dir(output: &str) -> Result<(), String> {
  if let Some(parent) = Path::new(output).parent() {
    fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败：{e}"))?;
  }
  Ok(())
}

fn assert_output_not_in_inputs(inputs: &[String], output: &str) -> Result<(), String> {
  let out_can = PathBuf::from(output).canonicalize().unwrap_or_else(|_| PathBuf::from(output));
  for p in inputs {
    let ic = PathBuf::from(p).canonicalize().unwrap_or_else(|_| PathBuf::from(p));
    if ic == out_can { return Err(format!("输出路径不能与输入文件相同：{}", p)); }
  }
  Ok(())
}

fn write_temp_pdfs(app: &AppHandle, inputs: &[PdfIn]) -> Result<(PathBuf, Vec<String>), String> {
  let mut work = std::env::temp_dir();
  work.push(app.config().identifier.replace('.', "_"));
  let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
  work.push(format!("merge_{ts}"));
  fs::create_dir_all(&work).map_err(|e| format!("创建临时目录失败：{e}"))?;

  let mut in_paths = Vec::<String>::with_capacity(inputs.len());
  for (i, p) in inputs.iter().enumerate() {
    let mut path = work.clone();
    path.push(format!("{:03}_{}", i, sanitize(&p.name)));
    fs::write(&path, &p.data).map_err(|e| format!("写入临时文件失败：{e}"))?;
    in_paths.push(path.to_string_lossy().to_string());
  }
  Ok((work, in_paths))
}

fn build_args_merge_paths(paths: &[String], output: &str) -> Vec<String> {
  // qpdf --linearize --empty --pages f1 1-z f2 1-z -- out.pdf
  let mut args = vec!["--linearize".into(), "--empty".into(), "--pages".into()];
  for p in paths {
    args.push(p.clone());
    args.push("1-z".into());
  }
  args.push("--".into());
  args.push(output.to_string());
  args
}

// ---------- qpdf finder + runner ----------
async fn run_qpdf(app: &AppHandle, args: &[String]) -> Result<(), String> {
  let (bin_dir, exe) = find_qpdf(app).ok_or_else(|| "未找到 qpdf，可执行应位于 binaries/qpdf/bin/qpdf.exe 或其子目录".to_string())?;
  verify_qpdf(&exe, &bin_dir)?; // 防止误放安装器
  let out = run_with_env(&bin_dir, &exe, args, &[])?;
  if out.status.success() { Ok(()) } else {
    Err(format!("qpdf 执行失败：{}", String::from_utf8_lossy(&out.stderr)))
  }
}

fn find_qpdf(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
  let dev_root = PathBuf::from("src-tauri").join("binaries");
  let res_root = app.path().resolve("binaries", tauri::path::BaseDirectory::Resource).ok();

  for root in [Some(dev_root), res_root].into_iter().flatten() {
    // 常见位置
    let direct = [
      root.join("qpdf").join("bin").join("qpdf.exe"),
      root.join("qpdf").join("qpdf.exe"),
      root.join("qpdf.exe"),
    ];
    for p in direct {
      if p.exists() { return Some((p.parent()?.to_path_buf(), p)); }
    }
    // 扫描子目录（例如 qpdf-12.2.0\bin\qpdf.exe）
    if let Ok(iter) = fs::read_dir(&root) {
      for ent in iter.flatten() {
        let p = ent.path();
        if p.is_dir() && p.file_name().and_then(OsStr::to_str).unwrap_or("").to_lowercase().contains("qpdf") {
          let cand = p.join("bin").join("qpdf.exe");
          if cand.exists() { return Some((cand.parent()?.to_path_buf(), cand)); }
        }
      }
    }
  }
  None
}

fn verify_qpdf(exe: &Path, bin_dir: &Path) -> Result<(), String> {
  let out = Command::new(exe).arg("--version").current_dir(bin_dir).output()
    .map_err(|e| format!("qpdf 校验失败：{e}（exe: {}）", exe.display()))?;
  if !out.status.success() { return Err(format!("qpdf --version 非0：{}", String::from_utf8_lossy(&out.stderr))); }
  let s = String::from_utf8_lossy(&out.stdout).to_ascii_lowercase();
  if !s.contains("qpdf") { return Err(format!("检测到的不是 qpdf CLI（stdout: {}）", s.trim())); }
  Ok(())
}

fn run_with_env(bin_dir: &Path, exe: &Path, args: &[String], extra_env: &[(&str, String)]) -> Result<std::process::Output, String> {
  let env_path = format!("{};{}", bin_dir.display(), std::env::var("PATH").unwrap_or_default());
  let mut cmd = Command::new(exe);
  cmd.args(args).current_dir(bin_dir).env("PATH", env_path);
  for (k, v) in extra_env { cmd.env(k, v); }
  cmd.output().map_err(|e| format!("执行失败：{e}（exe: {}）", exe.display()))
}

fn sanitize(name: &str) -> String {
  name.chars().map(|c| match c { '/'|'\\'|':'|'*'|'?'|'"'|'<'|'>'|'|' => '_', _ => c }).collect()
}
