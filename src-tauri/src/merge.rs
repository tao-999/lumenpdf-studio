use tauri::{AppHandle, Manager};
use tauri_plugin_shell::ShellExt;
use serde::Deserialize;
use std::{
  fs,
  path::{Path, PathBuf},
  process::Command,
  time::{SystemTime, UNIX_EPOCH},
};

/// 字节版入参：name 仅用于临时命名；data 是 PDF 原始字节
#[derive(Deserialize, Clone)]
pub struct PdfIn { pub name: String, pub data: Vec<u8> }

/// ✅ 统一输入类型：支持 string[]（路径）或 PdfIn[]（字节）
/// 前端永远 invoke("merge", { inputs, output })
#[derive(Deserialize)]
#[serde(untagged)]
pub enum Inputs {
  Paths(Vec<String>),
  Bytes(Vec<PdfIn>),
}

/// 合并命令（合并≠替换）
/// - 把多个 PDF 的「全部页面」按顺序拼到新文件 `output`
/// - 源文件只读不改；若 output 与任一输入同路径，直接报错拦截
#[tauri::command]
pub async fn merge(app: AppHandle, inputs: Inputs, output: String) -> Result<String, String> {
  ensure_parent_dir(&output)?;

  match inputs {
    Inputs::Paths(paths) => {
      if paths.len() < 2 { return Err("请选择至少两个 PDF（路径版）".into()); }
      assert_output_not_in_inputs(&paths, &output)?;
      let args = build_args_merge_paths(&paths, &output);
      run_qpdf(&app, args).await?;
      println!("[merge] paths -> {}", output);
      Ok(output)
    }
    Inputs::Bytes(items) => {
      if items.len() < 2 { return Err("请选择至少两个 PDF（字节版）".into()); }
      let (work, paths) = write_temp_pdfs(&app, &items)?;
      assert_output_not_in_inputs(&paths, &output)?;
      let args = build_args_merge_paths(&paths, &output);
      let res = run_qpdf(&app, args).await;
      let _ = fs::remove_dir_all(&work);
      match res {
        Ok(_) => { println!("[merge] bytes -> {}", output); Ok(output) }
        Err(e) => Err(e),
      }
    }
  }
}

// ================= 内部实现 =================

fn ensure_parent_dir(output: &str) -> Result<(), String> {
  if let Some(parent) = Path::new(output).parent() {
    fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败：{e}"))?;
  }
  Ok(())
}

/// 防呆：输出不能与任一输入同路径（避免看起来像“替换”）
fn assert_output_not_in_inputs(paths: &[String], output: &str) -> Result<(), String> {
  use std::path::PathBuf;
  let out_pb = PathBuf::from(output);
  let out_can = out_pb.canonicalize().unwrap_or(out_pb.clone());
  for p in paths {
    let ip = PathBuf::from(p);
    let ic = ip.canonicalize().unwrap_or(ip.clone());
    if ic == out_can {
      return Err(format!("输出路径不能与输入文件相同：{}", p));
    }
  }
  Ok(())
}

/// 写入临时 PDF，返回（临时目录, 各文件路径）
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

/// 生成 qpdf 合并参数：
///   qpdf --empty --pages f1 1-z f2 1-z ... -- out.pdf
/// 显式用 1-z，确保“全部页面”兼容不同 qpdf 版本
fn build_args_merge_paths(paths: &[String], output: &str) -> Vec<String> {
  let mut args: Vec<String> = vec!["--empty".into(), "--pages".into()];
  for p in paths {
    args.push(p.clone());
    args.push("1-z".into());
  }
  args.push("--".into());
  args.push(output.to_string());
  args
}

/// 统一调度 qpdf：dev 直启 → 资源 sidecar → 资源直启
async fn run_qpdf(app: &AppHandle, args: Vec<String>) -> Result<(), String> {
  let triple = option_env!("TAURI_ENV_TARGET_TRIPLE").unwrap_or("x86_64-pc-windows-msvc");
  let exe_name = format!("qpdf-{triple}.exe");

  let dev_bin_dir = PathBuf::from("src-tauri").join("binaries");
  let dev_exe = dev_bin_dir.join(&exe_name);

  let res_bin_dir = app
    .path()
    .resolve("binaries", tauri::path::BaseDirectory::Resource)
    .unwrap_or_else(|_| PathBuf::from("src-tauri").join("binaries"));
  let res_exe = res_bin_dir.join(&exe_name);

  // A) dev 直启
  if dev_exe.exists() {
    match run_qpdf_direct(&dev_bin_dir, &dev_exe, &args) {
      Ok(out) if out.status.success() => return Ok(()),
      Ok(out) => eprintln!("[qpdf dev-exe 非0] {}", String::from_utf8_lossy(&out.stderr)),
      Err(e) => eprintln!("[qpdf dev-exe 启动失败] {e}"),
    }
  }

  // B) 资源目录：先 sidecar 再直启
  let res_listing = list_dir(&res_bin_dir);
  if res_exe.exists() {
    // B1) sidecar
    if let Ok(mut cmd) = app.shell().sidecar("binaries/qpdf") {
      let merged_path = format!("{};{}", res_bin_dir.display(), std::env::var("PATH").unwrap_or_default());
      cmd = cmd.args(args.clone()).env("PATH", merged_path).current_dir(&res_bin_dir);
      match cmd.output().await {
        Ok(out) if out.status.success() => return Ok(()),
        Ok(out) => eprintln!("[qpdf sidecar 非0] {}", String::from_utf8_lossy(&out.stderr)),
        Err(e) => eprintln!("[qpdf sidecar 启动失败] {e}"),
      }
    }

    // B2) 直启资源 exe
    match run_qpdf_direct(&res_bin_dir, &res_exe, &args) {
      Ok(out) if out.status.success() => return Ok(()),
      Ok(out) => {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        return Err(format!("qpdf 失败（资源直启，非0）：{stderr}"));
      }
      Err(e) => {
        let dev_listing = list_dir(&dev_bin_dir);
        return Err(format!(
          "qpdf 启动失败（dev/资源都不行）：{e}\n\
           dev_exe: {}\nres_exe: {}\n\
           dev目录包含：{}\nres目录包含：{}",
          dev_exe.display(), res_exe.display(), dev_listing, res_listing
        ));
      }
    }
  } else {
    let dev_listing = list_dir(&dev_bin_dir);
    return Err(format!(
      "找不到资源 exe：{}\n\
       dev目录包含：{}\nres目录包含：{}",
      res_exe.display(), dev_listing, res_listing
    ));
  }
}

fn run_qpdf_direct(bin_dir: &Path, exe: &Path, args: &[String]) -> Result<std::process::Output, String> {
  let env_path = format!("{};{}", bin_dir.display(), std::env::var("PATH").unwrap_or_default());
  Command::new(exe)
    .args(args)
    .current_dir(bin_dir)
    .env("PATH", env_path)
    .output()
    .map_err(|e| format!("直接执行失败：{e}（exe: {}）", exe.display()))
}

fn list_dir(p: &Path) -> String {
  fs::read_dir(p).ok()
    .map(|it| it.filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().to_string()))
         .collect::<Vec<_>>().join(", "))
    .unwrap_or_else(|| "<读取失败>".into())
}

fn sanitize(name: &str) -> String {
  name.chars().map(|c| match c {
    '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
    _ => c
  }).collect()
}
