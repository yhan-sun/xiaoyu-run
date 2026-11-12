use std::io::{self, Write};

/// 终端里读一个 openid 需要的东西：本机小程序缓存 + 二维码。
use wxopenid::{extract, qr_terminal};

fn line(ch: char, n: usize) -> String {
    ch.to_string().repeat(n)
}

fn main() {
    println!();
    println!("  小雨run · 取码 {}", env!("CARGO_PKG_VERSION"));
    println!("  {}", line('─', 46));
    println!();

    let out = extract();

    if out.found.is_empty() {
        if out.denied_dirs > 0 {
            println!("  ✗ 有 {} 个微信目录没有读取权限", out.denied_dirs);
            println!();
            println!("    macOS：系统设置 → 隐私与安全性 → 完全磁盘访问权限");
            println!("           勾选「小雨run」后重新运行本程序");
            println!();
            println!("    Windows：一般不需要额外授权，确认微信已登录并");
            println!("             打开过「重邮智慧体育」小程序");
        } else {
            println!("  ✗ 没有找到 OpenID");
            println!();
            println!("    1. 确认电脑版微信已登录");
            println!("    2. 在微信里打开一次「重邮智慧体育」小程序");
            println!("       并完成学号绑定");
            println!("    3. 重新运行本程序");
        }
        println!();
        println!("  扫描了 {} 个缓存目录、{} 个文件。", out.scanned_dirs, out.scanned_files);
        pause();
        return;
    }

    // 优先用重邮那条
    let hit = out
        .found
        .iter()
        .find(|f| f.cqupt)
        .unwrap_or(&out.found[0]);

    println!("  ✓ 已找到 OpenID");
    println!();
    println!("    {}", hit.openid);
    println!();

    if !hit.cqupt {
        println!("  ⚠ 这条不是重邮智慧体育的，请确认后使用");
        println!();
    }

    if out.found.len() > 1 {
        println!("  另外还找到 {} 条其他小程序的 openid（已忽略）", out.found.len() - 1);
        println!();
    }

    if let Some(qr) = qr_terminal(&hit.openid) {
        println!("  手机端「小雨run → 指南 → 扫码」对着下面扫码：");
        println!();
        for l in qr.lines() {
            println!("  {}", l);
        }
        println!();
    }

    copy_to_clipboard(&hit.openid);

    println!("  {}", line('─', 46));
    println!("  手机也可以手动输入上面那串 OpenID");
    println!("  只需要填一次，之后会一直保存");
    println!();

    pause();
}

/// 尽力把 openid 放进剪贴板（失败就算了，不打扰用户）。
fn copy_to_clipboard(text: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::process::{Command, Stdio};
        if let Ok(mut child) = Command::new("cmd")
            .args(["/c", "clip"])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
            if child.wait().map(|s| s.success()).unwrap_or(false) {
                println!("  （已复制到剪贴板）");
                println!();
            }
        }
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::{Command, Stdio};
        if let Ok(mut child) = Command::new("pbcopy").stdin(Stdio::piped()).spawn() {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(text.as_bytes());
            }
            if child.wait().map(|s| s.success()).unwrap_or(false) {
                println!("  （已复制到剪贴板）");
                println!();
            }
        }
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let _ = text;
    }
}

/// 双击运行时窗口会立刻消失，停一下。
fn pause() {
    print!("  按回车键退出 ");
    let _ = io::stdout().flush();
    let mut buf = String::new();
    let _ = io::stdin().read_line(&mut buf);
}
