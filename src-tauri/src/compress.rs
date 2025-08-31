//! Compress PDF — prefer Ghostscript (lossy) & fallback qpdf (lossless).
//! Layout: binaries/ghostscript/{bin,lib,Resource[,fonts]}  +  binaries/qpdf/bin
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
pub enum InputOne {
  Path(String),
  Bytes(PdfIn),
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum CompressPreset { Lossless, Small, Smaller, Tiny }

#[tauri::command]
pub async fn compress(app: AppHandle, input: InputOne, output: String, preset: CompressPreset) -> Result<String, String> {
  ensure_parent_dir(&output)?;
  match input {
    InputOne::Path(p) => { assert_output_not_same(&p, &output)?; run_path(&app, &p, &output, &preset).await?; Ok(output) }
    InputOne::Bytes(pdf) => {
      let (work, in_path) = write_temp_pdf(&app, &pdf)?;
      assert_output_not_same(&in_path, &output)?;
      let res = run_path(&app, &in_path, &output, &preset).await;
      let _ = fs::remove_dir_all(&work);
      res.map(|_| output)
    }
  }
}

async fn run_path(app: &AppHandle, input: &str, output: &str, preset: &CompressPreset) -> Result<(), String> {
  match preset {
    CompressPreset::Lossless => qpdf_lossless(app, input, output).await,
    _ => match gs_lossy(app, input, output, preset).await {
      Ok(()) => Ok(()),
      Err(e) => { eprintln!("[compress] Ghostscript 失败/缺失：{e}；回退 qpdf 无损"); qpdf_lossless(app, input, output).await }
    }
  }
}

fn ensure_parent_dir(output: &str) -> Result<(), String> {
  if let Some(parent) = Path::new(output).parent() {
    fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败：{e}"))?;
  }
  Ok(())
}

fn assert_output_not_same(input: &str, output: &str) -> Result<(), String> {
  let ic = PathBuf::from(input).canonicalize().unwrap_or_else(|_| PathBuf::from(input));
  let oc = PathBuf::from(output).canonicalize().unwrap_or_else(|_| PathBuf::from(output));
  if ic == oc { return Err(format!("输出路径不能与输入文件相同：{}", input)); }
  Ok(())
}

fn write_temp_pdf(app: &AppHandle, p: &PdfIn) -> Result<(PathBuf, String), String> {
  let mut work = std::env::temp_dir();
  work.push(app.config().identifier.replace('.', "_"));
  let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
  work.push(format!("compress_{ts}"));
  fs::create_dir_all(&work).map_err(|e| format!("创建临时目录失败：{e}"))?;
  let mut path = work.clone();
  path.push(sanitize(&p.name));
  fs::write(&path, &p.data).map_err(|e| format!("写入临时文件失败：{e}"))?;
  Ok((work, path.to_string_lossy().to_string()))
}

// ---------- Ghostscript（有损，根目录优先，版本目录兼容） ----------
async fn gs_lossy(app: &AppHandle, input: &str, output: &str, preset: &CompressPreset) -> Result<(), String> {
  let (bin_dir, exe, envs) = find_gs(app).ok_or_else(|| "未找到 Ghostscript：请把 bin/lib/Resource 放到 binaries/ghostscript/".to_string())?;
  verify_gs(&bin_dir, &exe, &envs)?; // 防呆校验

  let mut args: Vec<String> = vec![
    "-sDEVICE=pdfwrite".into(),
    "-dCompatibilityLevel=1.4".into(),
    "-dDetectDuplicateImages=true".into(),
    "-dEncodeColorImages=true".into(),
    "-dEncodeGrayImages=true".into(),
    "-dEncodeMonoImages=true".into(),
    "-dDownsampleColorImages=true".into(),
    "-dDownsampleGrayImages=true".into(),
    "-dDownsampleMonoImages=true".into(),
    "-dColorImageDownsampleType=/Bicubic".into(),
    "-dGrayImageDownsampleType=/Bicubic".into(),
    "-dMonoImageDownsampleType=/Subsample".into(),
    "-dNOPAUSE".into(), "-dQUIET".into(), "-dBATCH".into(),
    format!("-sOutputFile={}", output),
  ];
  match preset {
    CompressPreset::Small   => { args.push("-dPDFSETTINGS=/ebook".into());  args.push("-dColorImageResolution=150".into()); args.push("-dGrayImageResolution=150".into()); args.push("-dMonoImageResolution=150".into()); }
    CompressPreset::Smaller => { args.push("-dPDFSETTINGS=/screen".into()); args.push("-dColorImageResolution=96".into());  args.push("-dGrayImageResolution=96".into());  args.push("-dMonoImageResolution=96".into());  }
    CompressPreset::Tiny    => { args.push("-dPDFSETTINGS=/screen".into()); args.push("-dColorImageResolution=72".into());  args.push("-dGrayImageResolution=72".into());  args.push("-dMonoImageResolution=72".into());  }
    CompressPreset::Lossless => unreachable!(),
  }
  args.push(input.into());

  let out = run_with_env(&bin_dir, &exe, &args, &envs)?;
  if out.status.success() { Ok(()) } else {
    Err(String::from_utf8_lossy(&out.stderr).to_string())
  }
}

fn find_gs(app: &AppHandle) -> Option<(PathBuf, PathBuf, Vec<(&'static str, String)>)> {
  // 根：binaries/ghostscript/
  let dev_root = PathBuf::from("src-tauri").join("binaries").join("ghostscript");
  let res_root = app.path().resolve("binaries/ghostscript", tauri::path::BaseDirectory::Resource).ok();

  for root in [Some(dev_root), res_root].into_iter().flatten() {
    // ① 无版本目录（你现在的布局）
    let bin = root.join("bin");
    let exe = bin.join("gswin64c.exe");
    if exe.exists() {
      let lib = root.join("lib");
      let resource = root.join("Resource");
      let fonts = root.join("fonts");
      if lib.is_dir() && resource.is_dir() {
        let mut envs = vec![("GS_LIB", format!("{};{}", lib.display(), resource.display()))];
        if fonts.is_dir() { envs.push(("GS_FONTPATH", fonts.display().to_string())); }
        return Some((bin, exe, envs));
      }
    }

    // ② 兼容：若有人放了版本目录，自动扫描
    if let Ok(iter) = fs::read_dir(&root) {
      for ent in iter.flatten() {
        let vdir = ent.path();
        if !vdir.is_dir() { continue; }
        let bin = vdir.join("bin");
        let exe = bin.join("gswin64c.exe");
        if exe.exists() {
          let lib = vdir.join("lib");
          let resource = vdir.join("Resource");
          let fonts = vdir.join("fonts");
          if lib.is_dir() && resource.is_dir() {
            let mut envs = vec![("GS_LIB", format!("{};{}", lib.display(), resource.display()))];
            if fonts.is_dir() { envs.push(("GS_FONTPATH", fonts.display().to_string())); }
            return Some((bin, exe, envs));
          }
        }
      }
    }
  }
  None
}

// ---------- qpdf（无损回退） ----------
async fn qpdf_lossless(app: &AppHandle, input: &str, output: &str) -> Result<(), String> {
  let (bin_dir, exe) = find_qpdf(app).ok_or_else(|| "未找到 qpdf：请把 qpdf/bin/qpdf.exe 放到 binaries 目录树".to_string())?;
  verify_qpdf(&exe, &bin_dir)?;
  let args = vec![
    "--object-streams=generate".into(),
    "--stream-data=compress".into(),
    "--recompress-flate".into(),
    "--compress-strings=y".into(),
    "--linearize".into(),
    input.into(),
    output.into(),
  ];
  let out = run_with_env(&bin_dir, &exe, &args, &[])?;
  if out.status.success() { Ok(()) } else {
    Err(format!("qpdf 失败：{}", String::from_utf8_lossy(&out.stderr)))
  }
}

// ---------- 共用工具 ----------
fn find_qpdf(app: &AppHandle) -> Option<(PathBuf, PathBuf)> {
  let dev_root = PathBuf::from("src-tauri").join("binaries");
  let res_root = app.path().resolve("binaries", tauri::path::BaseDirectory::Resource).ok();

  for root in [Some(dev_root), res_root].into_iter().flatten() {
    let direct = [
      root.join("qpdf").join("bin").join("qpdf.exe"),
      root.join("qpdf").join("qpdf.exe"),
      root.join("qpdf.exe"),
    ];
    for p in direct {
      if p.exists() { return Some((p.parent()?.to_path_buf(), p)); }
    }
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

fn verify_gs(bin_dir: &Path, exe: &Path, envs: &[(&str, String)]) -> Result<(), String> {
  let out = run_with_env(bin_dir, exe, &vec!["-v".into()], envs)?;
  if !out.status.success() {
    return Err(format!("Ghostscript 启动失败：{}", String::from_utf8_lossy(&out.stderr)));
  }
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
