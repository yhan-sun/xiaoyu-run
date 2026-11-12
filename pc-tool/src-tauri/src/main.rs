#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! 小雨run · 电脑端取码工具（独立小窗口）。
//!
//! 只做一件事：点按钮 → 扫描本机微信缓存 → 给出 OpenID 与二维码。
//! 刻意不做启动即扫描：读上千个缓存文件要几百毫秒，开机就卡一下很讨厌。

use serde::Serialize;
use tauri::Manager;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExtractResult {
    found: Vec<wxopenid::FoundOpenid>,
    note: String,
    scanned_dirs: usize,
    scanned_files: usize,
    denied_dirs: usize,
    qr: Option<String>,
}

#[tauri::command]
fn extract_openid() -> ExtractResult {
    let out = wxopenid::extract();
    let qr = out
        .found
        .iter()
        .find(|f| f.cqupt)
        .or_else(|| out.found.first())
        .and_then(|f| wxopenid::qr_svg(&f.openid, 260));

    ExtractResult {
        found: out.found,
        note: out.note,
        scanned_dirs: out.scanned_dirs,
        scanned_files: out.scanned_files,
        denied_dirs: out.denied_dirs,
        qr,
    }
}

#[tauri::command]
fn open_privacy_settings() -> bool {
    if cfg!(target_os = "macos") {
        return std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
            .spawn()
            .is_ok();
    }
    false
}

#[tauri::command]
fn copy_text(text: String) -> bool {
    // 用系统的剪贴板命令，避免为了一个功能引插件
    #[cfg(target_os = "windows")]
    {
        use std::io::Write;
        use std::os::windows::process::CommandExt;
        use std::process::{Command, Stdio};
        if let Ok(mut c) = Command::new("cmd")
            .args(["/c", "clip"])
            .stdin(Stdio::piped())
            .creation_flags(0x0800_0000)
            .spawn()
        {
            if let Some(mut s) = c.stdin.take() {
                let _ = s.write_all(text.as_bytes());
            }
            return c.wait().map(|s| s.success()).unwrap_or(false);
        }
        false
    }
    #[cfg(target_os = "macos")]
    {
        use std::io::Write;
        use std::process::{Command, Stdio};
        if let Ok(mut c) = Command::new("pbcopy").stdin(Stdio::piped()).spawn() {
            if let Some(mut s) = c.stdin.take() {
                let _ = s.write_all(text.as_bytes());
            }
            return c.wait().map(|s| s.success()).unwrap_or(false);
        }
        false
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = text;
        false
    }
}

fn main() {
    tauri::Builder::default()
        // 不在 setup 里抢着显示：等前端首帧画完自己调 show，
        // 否则用户会盯着一段空白窗口，感觉"打开很慢"。

        .invoke_handler(tauri::generate_handler![
            extract_openid,
            open_privacy_settings,
            copy_text
        ])
        .run(tauri::generate_context!())
        .expect("启动取码工具失败");
}
