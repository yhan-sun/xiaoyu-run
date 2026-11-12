//! 从小程序缓存提取 openid（Rust 实现，取代原先的 Python 脚本）。
//!
//! 同时被电脑端 GUI（desktop/）和独立取码工具（extractor/）使用。
//!
//! 原理：微信 4.x 把小程序跑在 Chromium 容器里，`/wxUnifyId/checkBinding`
//! 的响应是明文 JSON，直接落在磁盘缓存里。不用解密、不用抓包、不联网。
//!
//! 查找顺序：
//!   1. 已知根目录下的 `radium/web/profiles/*/Cache/Cache_Data`
//!   2. 已知根目录下的 `web/profiles/*/Cache/Cache_Data`
//!   3. 兜底：在家目录浅层扫「存在 web/profiles」的目录（应对数据目录被改到别处）

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_CACHE_FILE: u64 = 64 * 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FoundOpenid {
    pub openid: String,
    pub student_name: Option<String>,
    pub student_no: Option<String>,
    pub unify_id: Option<String>,
    /// 是否来自重邮智慧体育的响应（而非其他小程序）
    pub cqupt: bool,
    /// 命中的缓存文件，便于排查
    pub source: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractOutcome {
    pub found: Vec<FoundOpenid>,
    pub scanned_dirs: usize,
    pub scanned_files: usize,
    /// 因系统权限（macOS 完全磁盘访问）读不了的目录数
    pub denied_dirs: usize,
    /// 给用户看的说明（没找到时尤其重要）
    pub note: String,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
}

/// 各平台微信数据根目录的候选。
fn roots() -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    let Some(h) = home() else {
        return out;
    };

    // macOS：4.x 在沙盒容器的 Documents/app_data 下
    for c in ["com.tencent.xinWeChat2", "com.tencent.xinWeChat"] {
        out.push(
            h.join("Library/Containers")
                .join(c)
                .join("Data/Documents/app_data"),
        );
    }
    out.push(
        h.join("Library/Containers/com.tencent.xinWeChat/Data/Library/Application Support/com.tencent.xinWeChat"),
    );
    out.push(h.join("Library/Application Support/com.tencent.xinWeChat"));

    // Windows
    for var in ["APPDATA", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            let base = PathBuf::from(base);
            out.push(base.join("Tencent/xwechat"));
            out.push(base.join("Tencent/WeChat"));
        }
    }

    // Linux（含 Flatpak / Wine）
    out.push(h.join(".xwechat"));
    out.push(h.join(".local/share/xwechat"));
    out.push(h.join(".config/xwechat"));
    out.push(h.join(".var/app/com.tencent.WeChat/data/xwechat"));
    if let Some(user) = std::env::var_os("USER") {
        let wine = h.join(".wine/drive_c/users").join(user);
        out.push(wine.join("AppData/Roaming/Tencent/xwechat"));
        out.push(wine.join("AppData/Roaming/Tencent/WeChat"));
    }

    out.retain(|p| p.is_dir());
    out
}

/// 从 `<profiles>` 目录收集每个 profile 的 `Cache_Data`。
fn collect_profiles(profiles: &Path, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(profiles) else {
        return;
    };
    for e in rd.flatten() {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        let cache = p.join("Cache/Cache_Data");
        if cache.is_dir() {
            out.push(cache);
        } else if p.join("Cache_Data").is_dir() {
            out.push(p.join("Cache_Data"));
        }
    }
}

fn cache_dirs() -> (Vec<PathBuf>, usize) {
    let mut out: Vec<PathBuf> = Vec::new();
    let mut denied = 0usize;

    for root in roots() {
        // 允许直接指向 Cache_Data
        if root.file_name().map(|n| n == "Cache_Data").unwrap_or(false) {
            out.push(root.clone());
            continue;
        }
        for sub in ["radium/web/profiles", "web/profiles"] {
            let profiles = root.join(sub);
            if profiles.exists() {
                if fs::read_dir(&profiles).is_err() {
                    // macOS 没给「完全磁盘访问」时会在这里失败
                    denied += 1;
                    continue;
                }
                collect_profiles(&profiles, &mut out);
            }
        }
    }

    // 兜底：数据目录被用户改到别处时，浅层扫描家目录找 web/profiles
    if out.is_empty() {
        if let Some(h) = home() {
            let mut stack = vec![(h, 0usize)];
            while let Some((dir, depth)) = stack.pop() {
                if depth > 5 {
                    continue;
                }
                let Ok(rd) = fs::read_dir(&dir) else {
                    continue;
                };
                for e in rd.flatten() {
                    let p = e.path();
                    if !p.is_dir() {
                        continue;
                    }
                    let name = e.file_name();
                    // 命中 <x>/web/profiles 就是微信容器
                    if name == "profiles" {
                        if let Some(parent) = p.parent() {
                            if parent.file_name().map(|n| n == "web").unwrap_or(false) {
                                collect_profiles(&p, &mut out);
                                continue;
                            }
                        }
                    }
                    // 不钻进这些又大又没用的目录
                    let n = name.to_string_lossy();
                    if matches!(
                        n.as_ref(),
                        "Library" | ".git" | "node_modules" | "Applications" | ".Trash" | "target"
                    ) && depth >= 1
                    {
                        // Library 需要进去（微信就在里面），单独放行一层
                        if n == "Library" {
                            stack.push((p, depth + 1));
                        }
                        continue;
                    }
                    stack.push((p, depth + 1));
                }
            }
        }
    }

    out.sort();
    out.dedup();
    (out, denied)
}

/// 在字节流里找 openid。
///
/// 两种形态都要认：
///   JSON  `"openid":"oXXXX..."`   （checkBinding 的响应体）
///   query `openid=oXXXX...`       （请求串）
fn scan_openids(buf: &[u8]) -> Vec<String> {
    const KEY: &[u8] = b"openid";
    let mut out: Vec<String> = Vec::new();
    let mut i = 0usize;

    while i + KEY.len() <= buf.len() {
        if &buf[i..i + KEY.len()] != KEY {
            i += 1;
            continue;
        }
        let mut j = i + KEY.len();
        // 跳过 " : = 空白 等分隔符
        while j < buf.len()
            && matches!(
                buf[j],
                b'"' | b'\'' | b':' | b'=' | b' ' | b'\t' | b'\\' | b'/'
            )
        {
            j += 1;
        }
        let start = j;
        while j < buf.len() && (buf[j].is_ascii_alphanumeric() || buf[j] == b'_' || buf[j] == b'-')
        {
            j += 1;
        }
        let len = j - start;
        if (7..=64).contains(&len) {
            if let Ok(s) = std::str::from_utf8(&buf[start..j]) {
                if !out.iter().any(|x| x == s) {
                    out.push(s.to_string());
                }
            }
        }
        i = j.max(i + 1);
    }
    out
}

fn looks_cqupt(buf: &[u8]) -> bool {
    let needles: [&[u8]; 3] = [b"cqupt", b"checkBinding", b"sportRecord"];
    needles
        .iter()
        .any(|n| buf.windows(n.len()).any(|w| w == *n))
}

// 缓存文件包含二进制头，不能将整个文件当 JSON 解析；只解码完整的 JSON 字符串。
fn json_string_values(buf: &[u8], keys: &[&str]) -> Vec<String> {
    let mut values = Vec::new();
    for key in keys {
        let needle = format!("\"{key}\"");
        for (pos, _) in buf
            .windows(needle.len())
            .enumerate()
            .filter(|(_, w)| *w == needle.as_bytes())
        {
            let mut i = pos + needle.len();
            while i < buf.len() && buf[i].is_ascii_whitespace() {
                i += 1;
            }
            if buf.get(i) != Some(&b':') {
                continue;
            }
            i += 1;
            while i < buf.len() && buf[i].is_ascii_whitespace() {
                i += 1;
            }
            if buf.get(i) != Some(&b'"') {
                continue;
            }
            let start = i;
            i += 1;
            let mut escaped = false;
            while i < buf.len() {
                if !escaped && buf[i] == b'"' {
                    if let Ok(value) = serde_json::from_slice::<String>(&buf[start..=i]) {
                        if !value.trim().is_empty() && !values.contains(&value) {
                            values.push(value);
                        }
                    }
                    break;
                }
                if !escaped && buf[i] == b'\\' {
                    escaped = true;
                } else {
                    escaped = false;
                }
                i += 1;
            }
        }
    }
    values
}

#[derive(Default)]
struct Metadata {
    names: Vec<String>,
    student_nos: Vec<String>,
    unify_ids: Vec<String>,
}

impl Metadata {
    fn collect(&mut self, buf: &[u8]) {
        for (target, keys) in [
            (
                &mut self.names,
                &["studentName", "username", "createName"][..],
            ),
            (&mut self.student_nos, &["studentNo"][..]),
            (&mut self.unify_ids, &["unifyId"][..]),
        ] {
            for value in json_string_values(buf, keys) {
                if !target.contains(&value) {
                    target.push(value);
                }
            }
        }
    }

    fn apply_unique(&self, hit: &mut FoundOpenid) {
        fn unique(values: &[String]) -> Option<String> {
            if values.len() == 1 {
                Some(values[0].clone())
            } else {
                None
            }
        }
        hit.student_name = unique(&self.names);
        hit.student_no = unique(&self.student_nos);
        hit.unify_id = unique(&self.unify_ids);
    }
}

fn associate_profile_metadata(hits: &mut [FoundOpenid], metadata: &Metadata) {
    if hits.iter().filter(|hit| hit.cqupt).count() == 1 {
        if let Some(hit) = hits.iter_mut().find(|hit| hit.cqupt) {
            metadata.apply_unique(hit);
        }
    }
}

pub fn extract() -> ExtractOutcome {
    let (dirs, denied_dirs) = cache_dirs();
    let scanned_dirs = dirs.len();
    let mut scanned_files = 0usize;
    let mut found: Vec<FoundOpenid> = Vec::new();

    for d in &dirs {
        let Ok(rd) = fs::read_dir(d) else { continue };
        let mut metadata = Metadata::default();
        let mut profile_hits: Vec<FoundOpenid> = Vec::new();
        for e in rd.flatten() {
            let p = e.path();
            let Ok(meta) = e.metadata() else { continue };
            if !meta.is_file() || meta.len() > MAX_CACHE_FILE {
                continue;
            }
            scanned_files += 1;
            let Ok(buf) = fs::read(&p) else { continue };
            let cqupt = looks_cqupt(&buf);
            if cqupt {
                metadata.collect(&buf);
            }
            if !buf.windows(6).any(|w| w == b"openid") {
                continue;
            }
            let src = p
                .parent()
                .and_then(|x| x.parent())
                .map(|x| x.display().to_string())
                .unwrap_or_else(|| p.display().to_string());
            for openid in scan_openids(&buf) {
                if let Some(hit) = profile_hits.iter_mut().find(|f| f.openid == openid) {
                    hit.cqupt |= cqupt;
                } else {
                    profile_hits.push(FoundOpenid {
                        openid,
                        student_name: None,
                        student_no: None,
                        unify_id: None,
                        cqupt,
                        source: src.clone(),
                    });
                }
            }
        }
        // 仅当 profile 中只有一个已确认的重邮 OpenID 时关联资料，避免多账号串号。
        associate_profile_metadata(&mut profile_hits, &metadata);
        for hit in profile_hits {
            if let Some(existing) = found.iter_mut().find(|f| f.openid == hit.openid) {
                if hit.cqupt && !existing.cqupt {
                    *existing = hit;
                }
            } else {
                found.push(hit);
            }
        }
    }

    // 重邮的排前面
    found.sort_by(|a, b| b.cqupt.cmp(&a.cqupt));

    let note = if found.is_empty() {
        if denied_dirs > 0 {
            format!(
                "{denied_dirs} 个微信目录没有读取权限。macOS 需要在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」里勾选小雨run，然后再点一次扫描。"
            )
        } else if scanned_dirs == 0 {
            "没找到微信缓存目录。请确认电脑版微信已安装，并至少打开过一次「重邮智慧体育」小程序。"
                .into()
        } else {
            format!(
                "扫描了 {scanned_dirs} 个缓存目录、{scanned_files} 个文件，没有找到 openid。请在电脑微信里打开一次「重邮智慧体育」小程序并完成绑定后再试。"
            )
        }
    } else {
        format!(
            "扫描 {scanned_dirs} 个缓存目录、{scanned_files} 个文件，找到 {} 个身份。",
            found.len()
        )
    };

    ExtractOutcome {
        found,
        scanned_dirs,
        scanned_files,
        denied_dirs,
        note,
    }
}

/// 生成二维码（SVG 路径拼接，不引渲染依赖）。
///
/// 返回 (svg, 模块数)。深色模块走 `<path>`，同行的连续模块合并成一条，
/// 33x33 的码最终只有几十条子路径。
pub fn qr_svg(data: &str, size_px: u32) -> Option<String> {
    let code = qrcode::QrCode::new(data.as_bytes()).ok()?;
    let width = code.width();
    let colors = code.to_colors();

    let mut d = String::new();
    for y in 0..width {
        let mut x = 0;
        while x < width {
            if colors[y * width + x] != qrcode::Color::Dark {
                x += 1;
                continue;
            }
            let start = x;
            while x < width && colors[y * width + x] == qrcode::Color::Dark {
                x += 1;
            }
            d.push_str(&format!("M{start} {y}h{}v1h-{}z", x - start, x - start));
        }
    }

    let view_width = width + 8;
    Some(format!(
        r##"<svg xmlns="http://www.w3.org/2000/svg" width="{size_px}" height="{size_px}" viewBox="-4 -4 {view_width} {view_width}" shape-rendering="crispEdges"><rect x="-4" y="-4" width="{view_width}" height="{view_width}" fill="#fff"/><path d="{d}" fill="#000"/></svg>"##
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_json_and_query_forms() {
        let buf =
            br#"{"code":"10200","data":{"openid":"oABC123456789012345678901234","isBind":"true"}}"#;
        let ids = scan_openids(buf);
        assert_eq!(ids, vec!["oABC123456789012345678901234".to_string()]);

        let q = b"GET /x?openid=oZZZ_9999999999999999999999999&y=1";
        let ids2 = scan_openids(q);
        assert_eq!(ids2, vec!["oZZZ_9999999999999999999999999".to_string()]);
    }

    #[test]
    fn ignores_short_or_empty() {
        assert!(scan_openids(b"\"openid\":\"\"").is_empty());
        assert!(scan_openids(b"\"openid\":\"abc\"").is_empty());
    }

    #[test]
    fn associates_unique_profile_metadata_without_guessing() {
        let mut metadata = Metadata::default();
        metadata.collect(b"binary\x00cqupt {\"studentName\":\"\\u5c0f\\u96e8\",\"studentNo\":\"20230001\",\"unifyId\":\"1234567\"}");
        let hit = |openid: &str, cqupt| FoundOpenid {
            openid: openid.into(),
            student_name: None,
            student_no: None,
            unify_id: None,
            cqupt,
            source: String::new(),
        };
        let mut hits = vec![hit("o1234567", true), hit("o7654321", false)];
        associate_profile_metadata(&mut hits, &metadata);
        assert_eq!(hits[0].student_name.as_deref(), Some("小雨"));
        assert_eq!(hits[0].student_no.as_deref(), Some("20230001"));
        assert_eq!(hits[0].unify_id.as_deref(), Some("1234567"));
        assert!(hits[1].student_name.is_none());

        let mut ambiguous = vec![hit("o1234567", true), hit("o7654321", true)];
        associate_profile_metadata(&mut ambiguous, &metadata);
        assert!(ambiguous.iter().all(|item| item.student_no.is_none()));
        metadata.collect(br#"{"studentNo":"20230002"}"#);
        let mut conflicting = vec![hit("o1234567", true)];
        associate_profile_metadata(&mut conflicting, &metadata);
        assert!(conflicting[0].student_no.is_none());
    }

    #[test]
    fn detects_cqupt_context() {
        assert!(looks_cqupt(b"https://sport.cqupt.edu.cn/new_wxapp"));
        assert!(looks_cqupt(b"/sportRecord/sport/start2"));
        assert!(!looks_cqupt(b"some other json"));
    }

    /// 本机真实扫描（CI 上没有微信缓存，所以默认忽略）
    #[test]
    #[ignore]
    fn local_scan_smoke() {
        let out = extract();
        println!(
            "目录 {} / 文件 {} / 命中 {}",
            out.scanned_dirs,
            out.scanned_files,
            out.found.len()
        );
        println!("无权限目录 {}", out.denied_dirs);
        for f in out.found.iter().take(5) {
            let m = if f.openid.len() > 8 {
                format!("{}****{}", &f.openid[..4], &f.openid[f.openid.len() - 4..])
            } else {
                "***".to_string()
            };
            println!("  {m}  cqupt={}  src={}", f.cqupt, f.source);
        }
        println!("note: {}", out.note);
    }

    #[test]
    fn qr_svg_is_wellformed() {
        let svg = qr_svg("oABC123456789012345678901234", 280).unwrap();
        assert!(svg.starts_with("<svg"));
        assert!(svg.ends_with("</svg>"));
        assert!(svg.contains("<path d=\"M"));
    }
}

/// 终端里可直接扫的二维码（用全角块拼）。
///
/// 每个模块两个字符宽，四周留 2 模块静区 —— 命令行窗口里也能被手机扫到。
pub fn qr_terminal(data: &str) -> Option<String> {
    let code = qrcode::QrCode::new(data.as_bytes()).ok()?;
    let w = code.width();
    let colors = code.to_colors();
    let border = 2usize;
    let total = w + border * 2;

    let mut out = String::new();
    for y in 0..total {
        for x in 0..total {
            let dark = y >= border
                && y < border + w
                && x >= border
                && x < border + w
                && colors[(y - border) * w + (x - border)] == qrcode::Color::Dark;
            out.push_str(if dark { "██" } else { "  " });
        }
        out.push('\n');
    }
    Some(out)
}

#[cfg(test)]
mod qr_tests {
    use super::*;

    #[test]
    fn terminal_qr_has_expected_width() {
        let s = qr_terminal("oABC123456789012345678901234").unwrap();
        let lines: Vec<&str> = s.lines().collect();
        assert!(lines.len() > 20);
        // 每行宽度一致（全角块，按字符数算）
        let n = lines[0].chars().count();
        assert!(lines.iter().all(|l| l.chars().count() == n));
    }
}
