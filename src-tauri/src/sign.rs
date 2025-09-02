// src-tauri/src/sign.rs
use std::{
  fs,
  io::Write,
  path::{Path, PathBuf},
  time::Instant,
};

use base64::{engine::general_purpose, Engine as _};
use memchr::memmem;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter};       // v2: emit 需要 Emitter
use tauri_plugin_dialog::DialogExt;    // v2: 从 AppHandle 拿对话框
use tokio::sync::Mutex;

// 并发互斥（防重复导出）
static EXPORT_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

const PROGRESS_EVT: &str = "sign:progress";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignAndExportPayload {
  /// 前端传来的 PDF（已合成落章）的 base64
  pub pdf_bytes_b64: String,
  /// 保存对话框的默认文件名（可选）
  pub suggested_name: Option<String>,
  /// 若前端已指定保存路径，后端不再弹窗
  pub target_path: Option<String>,
  /// 允许覆盖
  pub overwrite: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignExportOk {
  pub path: String,
  pub bytes_written: usize,
  pub sha256: String,
  pub took_ms: u128,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignErrorDto {
  pub ok: bool,
  pub code: SignErrorCode,
  pub message: String,
}

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SignErrorCode {
  ECancelled,
  EInvalidPdf,
  EInvalidArg,
  EExists,
  EPermission,
  EIo,
  EUnknown,
}

type SignResult<T> = Result<T, SignErrorDto>;

#[derive(Debug, Serialize)]
#[serde(tag = "phase", rename_all = "lowercase")]
enum Progress<'a> {
  Prepare,
  Write,
  Done { path: &'a str, sha256: &'a str },
  Error { code: SignErrorCode, message: &'a str },
}

fn emit_progress(app: &AppHandle, payload: &Progress) {
  let _ = app.emit(PROGRESS_EVT, payload);
}
fn emit_error(app: &AppHandle, code: SignErrorCode, msg: &str) {
  let _ = app.emit(PROGRESS_EVT, &Progress::Error { code, message: msg });
}

#[tauri::command]
pub async fn sign_and_export_pdf(app: AppHandle, payload: SignAndExportPayload) -> SignResult<SignExportOk> {
  let _guard = EXPORT_LOCK.lock().await;

  let t0 = Instant::now();
  emit_progress(&app, &Progress::Prepare);

  // 1) 解码 + 校验
  let overwrite = payload.overwrite.unwrap_or(false);
  let bytes = match decode_b64(&payload.pdf_bytes_b64) {
    Ok(b) => b,
    Err(e) => {
      emit_error(&app, SignErrorCode::EInvalidArg, "base64 解码失败");
      return Err(err(SignErrorCode::EInvalidArg, format!("base64 解码失败: {e}")));
    }
  };
  if let Err(m) = validate_pdf(&bytes) {
    emit_error(&app, SignErrorCode::EInvalidPdf, &m);
    return Err(err(SignErrorCode::EInvalidPdf, m));
  }

  // 2) 解析输出路径（优先 target_path，否则弹 Save）
  let out_path = match resolve_output_path(&app, payload.target_path.as_deref(), payload.suggested_name.as_deref()).await {
    Ok(p) => p,
    Err(e) => {
      emit_error(&app, e.code, &e.message);
      return Err(e);
    }
  };
  if out_path.as_os_str().is_empty() {
    emit_error(&app, SignErrorCode::ECancelled, "用户取消保存对话框");
    return Err(err(SignErrorCode::ECancelled, "用户取消保存对话框"));
  }
  if !overwrite && out_path.exists() {
    emit_error(&app, SignErrorCode::EExists, "目标已存在，且未允许覆盖");
    return Err(err(SignErrorCode::EExists, "目标已存在，且未允许覆盖"));
  }

  // 3) 原子写入
  emit_progress(&app, &Progress::Write);
  let sha = hex_sha256(&bytes);
  let written = match atomic_write_all(&out_path, &bytes, overwrite) {
    Ok(n) => n,
    Err(e) => {
      emit_error(&app, e.code, &e.message);
      return Err(e);
    }
  };

  emit_progress(&app, &Progress::Done { path: out_path.to_string_lossy().as_ref(), sha256: &sha });

  Ok(SignExportOk {
    path: out_path.to_string_lossy().into_owned(),
    bytes_written: written,
    sha256: sha,
    took_ms: t0.elapsed().as_millis(),
  })
}

// ---------- 工具 ----------

async fn resolve_output_path(app: &AppHandle, target: Option<&str>, suggested: Option<&str>) -> SignResult<PathBuf> {
  if let Some(p) = target { return Ok(PathBuf::from(p)); }

  // v2 正确用法：从 app.dialog().file() 弹 Save（保持异步 oneshot 结构）
  let file_name = suggested.unwrap_or("signed.pdf").to_string();
  let (tx, rx) = tokio::sync::oneshot::channel::<Option<PathBuf>>();
  let app_cloned = app.clone();
  tauri::async_runtime::spawn(async move {
    app_cloned
      .dialog()
      .file()
      .add_filter("PDF", &["pdf"])
      .set_title("保存已签名 PDF")
      .set_file_name(&file_name)
      .save_file(move |opt| {
        // opt: Option<FilePath>；用 into_path() 拿 PathBuf
        let _ = tx.send(opt.and_then(|fp| fp.into_path().ok()));
      });
  });

  match rx.await {
    Ok(Some(p)) => Ok(p),
    Ok(None)    => Ok(PathBuf::new()),
    Err(_)      => Err(err(SignErrorCode::EUnknown, "保存对话框失败")),
  }
}

fn decode_b64(s: &str) -> Result<Vec<u8>, base64::DecodeError> {
  general_purpose::STANDARD.decode(s.as_bytes())
}

fn validate_pdf(bytes: &[u8]) -> Result<(), String> {
  if bytes.len() < 8 { return Err("PDF 太短".into()); }
  let head_ok = bytes.starts_with(b"%PDF-");
  let tail_slice_start = bytes.len().saturating_sub(4096);
  let tail_ok = memmem::find(&bytes[tail_slice_start..], b"%%EOF").is_some();
  if !head_ok || !tail_ok {
    return Err("不是有效 PDF（缺少头/尾标记）".into());
  }
  Ok(())
}

fn hex_sha256(data: &[u8]) -> String {
  let mut h = Sha256::new();
  h.update(data);
  let d = h.finalize();
  d.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 在目标目录创建临时文件 → 写入 + fsync → 覆盖/重命名到目标
fn atomic_write_all(path: &Path, data: &[u8], overwrite: bool) -> SignResult<usize> {
  let dir = path.parent().ok_or_else(|| err(SignErrorCode::EInvalidArg, "输出路径无父目录"))?;
  if !dir.exists() {
    return Err(err(SignErrorCode::EPermission, "输出目录不存在或无权限"));
  }
  if !overwrite && path.exists() {
    return Err(err(SignErrorCode::EExists, "目标已存在，且未允许覆盖"));
  }

  let mut tmp = tempfile::NamedTempFile::new_in(dir)
    .map_err(|e| map_io("创建临时文件失败", e))?;
  tmp.as_file_mut()
    .write_all(data)
    .and_then(|_| tmp.as_file_mut().flush())
    .and_then(|_| tmp.as_file_mut().sync_all())
    .map_err(|e| map_io("写入失败", e))?;

  if overwrite && path.exists() {
    fs::remove_file(path).map_err(|e| map_io("删除旧文件失败", e))?;
  }
  match tmp.persist(path) {
    Ok(_) => Ok(data.len()),
    Err(e) => Err(map_io("原子重命名失败", e.error)),
  }
}

fn err(code: SignErrorCode, message: impl Into<String>) -> SignErrorDto {
  SignErrorDto { ok: false, code, message: message.into() }
}
fn map_io(ctx: &str, e: std::io::Error) -> SignErrorDto {
  use std::io::ErrorKind::*;
  match e.kind() {
    PermissionDenied => err(SignErrorCode::EPermission, format!("{ctx}: 权限不足")),
    NotFound         => err(SignErrorCode::EPermission, format!("{ctx}: 目录不存在")),
    AlreadyExists    => err(SignErrorCode::EExists, format!("{ctx}: 已存在")),
    _                => err(SignErrorCode::EIo, format!("{ctx}: {e}")),
  }
}
