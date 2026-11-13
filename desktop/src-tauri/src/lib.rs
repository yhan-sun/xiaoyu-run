//! 小雨run · Tauri 应用层。
//!
//! 前端只负责呈现，所有网络与轨迹计算都在 Rust 侧完成。

mod api;
mod geo;
mod rng;
mod run;
mod track;

use api::{Api, Resp};
use serde::{Deserialize, Serialize};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager, State};

// ------------------------------------------------------------------ 配置

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    pub openid: String,
    pub pace: String,
    pub dist: String,
    pub noise: f64,
    pub burrs: bool,
    pub seed: i64,
    pub place_code: String,
    pub theme: String,
    pub keep_awake: bool,
    /// 上次拉到的成绩，启动时直接渲染，不必每次点刷新
    #[serde(default)]
    pub last_stats: Option<run::Stats>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            openid: String::new(),
            pace: "5:45".into(),
            dist: "2.0".into(),
            noise: 0.6,
            burrs: true,
            seed: 0,
            place_code: String::new(),
            theme: "system".into(),
            keep_awake: true,
            last_stats: None,
        }
    }
}

#[cfg(test)]
mod config_tests {
    use super::Config;

    #[test]
    fn upgrades_older_configuration_and_preserves_cached_stats() {
        let old = r#"{"openid":"test-id","placeCode":"T1001","lastStats":{"total":1,"validCount":1,"invalidCount":0,"totalKm":2.0,"avgPaceSecKm":345.0,"byPlace":[["test",1]],"rows":[]}}"#;
        let mut config: Config = serde_json::from_str(old).unwrap();
        assert_eq!(config.openid, "test-id");
        assert_eq!(config.place_code, "T1001");
        assert_eq!(config.last_stats.as_ref().unwrap().total, 1);
        assert!(config.keep_awake);
        config.keep_awake = false;
        let saved = serde_json::to_string(&config).unwrap();
        let restored: Config = serde_json::from_str(&saved).unwrap();
        assert!(!restored.keep_awake);
        assert_eq!(restored.last_stats.unwrap().total, 1);
    }
}

fn config_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("无法定位配置目录：{}", e))?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

// ------------------------------------------------------------------ 全局状态

#[derive(Default)]
struct AppState {
    areas: Vec<run::Area>,
    openid: String,
    token: String,
}

/// 运行线程的两个开关：active = 有任务在跑，cancel = 请求取消。
struct Runner {
    cancel: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
}

impl Default for Runner {
    fn default() -> Self {
        Self {
            cancel: Arc::new(AtomicBool::new(false)),
            active: Arc::new(AtomicBool::new(false)),
        }
    }
}

// ------------------------------------------------------------------ 工具

/// 把 "5:45" / "345" / "5'45\"" 解析成秒/公里。
fn parse_pace(s: &str) -> Option<f64> {
    let t = s.trim().replace(['\'', '"', '’', '″'], "");
    if t.is_empty() {
        return None;
    }
    if let Some((m, sec)) = t.split_once(':') {
        let m: f64 = m.trim().parse().ok()?;
        let sec: f64 = sec.trim().parse().ok()?;
        if sec >= 60.0 || m < 0.0 {
            return None;
        }
        return Some(m * 60.0 + sec);
    }
    let v: f64 = t.parse().ok()?;
    Some(v)
}

fn parse_dist(s: &str) -> Option<f64> {
    let v: f64 = s.trim().parse().ok()?;
    if (0.1..=100.0).contains(&v) {
        Some(v)
    } else {
        None
    }
}

// ------------------------------------------------------------------ 命令

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectResult {
    ok: bool,
    message: String,
    token_masked: String,
    rule: Option<run::Rule>,
    areas: Vec<run::Area>,
    logs: Vec<String>,
}

#[tauri::command]
fn load_config(app: tauri::AppHandle) -> Result<Config, String> {
    let p = config_path(&app)?;
    match std::fs::read_to_string(p) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("配置读取失败：{}", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Config::default()),
        Err(e) => Err(format!("配置读取失败：{}", e)),
    }
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: Config) -> Result<(), String> {
    static SAVE_LOCK: Mutex<()> = Mutex::new(());
    let _guard = SAVE_LOCK.lock().map_err(|_| "配置写入锁失败")?;
    let p = config_path(&app)?;
    let s = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    // Write alongside the original so an interrupted write cannot truncate it.
    #[cfg(not(target_os = "windows"))]
    {
        let tmp = p.with_extension("json.tmp");
        std::fs::write(&tmp, s).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
    }
    #[cfg(target_os = "windows")]
    std::fs::write(p, s).map_err(|e| e.to_string())
}

#[tauri::command]
fn connect(
    state: State<'_, Mutex<AppState>>,
    openid: String,
) -> ConnectResult {
    let mut logs = Vec::new();
    let oid = openid.trim().to_string();
    if oid.is_empty() {
        return ConnectResult {
            ok: false,
            message: "请先填入 OpenID".into(),
            token_masked: String::new(),
            rule: None,
            areas: Vec::new(),
            logs,
        };
    }

    let mut api = Api::new();
    api.reset(&oid);

    // ① 换 token
    let Some(j) = api.check_binding(&oid) else {
        return ConnectResult {
            ok: false,
            message: format!("无法连接服务器：{}", api.last_error),
            token_masked: String::new(),
            rule: None,
            areas: Vec::new(),
            logs: vec!["检查网络 / 校园网是否可达 sport.cqupt.edu.cn".into()],
        };
    };
    let r = Resp::of(Some(&j));
    if !r.ok {
        return ConnectResult {
            ok: false,
            message: format!("换取 token 失败（{} {}）", r.code, r.msg),
            token_masked: String::new(),
            rule: None,
            areas: Vec::new(),
            logs,
        };
    }
    let is_bind = r.data.get("isBind").map(|v| match v {
        serde_json::Value::String(s) => s == "true",
        serde_json::Value::Bool(b) => *b,
        _ => false,
    });
    if !is_bind.unwrap_or(false) {
        return ConnectResult {
            ok: false,
            message: "该 OpenID 未绑定校园跑身份，请先在小程序完成绑定".into(),
            token_masked: String::new(),
            rule: None,
            areas: Vec::new(),
            logs,
        };
    }
    let token = r
        .data
        .get("token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if token.is_empty() {
        return ConnectResult {
            ok: false,
            message: "服务端未返回 token".into(),
            token_masked: String::new(),
            rule: None,
            areas: Vec::new(),
            logs,
        };
    }
    api.token = token.clone();
    logs.push(format!("✓ token = {}", api::mask(&token)));

    // ② 规则
    let rule = run::fetch_rule(&mut api);
    if let Some(ref ru) = rule {
        logs.push(format!(
            "配速区间 {} ~ {}/km，达标 {} m",
            track::fmt_pace(ru.min_pace),
            track::fmt_pace(ru.max_pace),
            ru.race_mile as i64
        ));
    }

    // ③ 场地
    let (areas, area_logs) = run::fetch_areas(&mut api);
    logs.extend(area_logs);

    if let Ok(mut st) = state.lock() {
        st.areas = areas.clone();
        st.openid = oid;
        st.token = token.clone();
    }

    ConnectResult {
        ok: !areas.is_empty(),
        message: if areas.is_empty() {
            "未获取到可打卡场地".into()
        } else {
            format!("已同步 {} 个场地", areas.len())
        },
        token_masked: api::mask(&token),
        rule,
        areas,
        logs,
    }
}


/// 内置示例场地：一条标准 400m 椭圆跑道（弯道半径 36.5m、直道 84.4m）。
/// 未同步真实场地时用它跑预览，让界面一打开就有东西可看。
fn demo_area() -> run::Area {
    let clat = 29.5330_f64;
    let clon = 106.6050_f64;
    let m_lat = 111_320.0;
    let m_lon = 111_320.0 * clat.to_radians().cos();
    let half = 84.4 / 2.0;
    let r = 36.5;
    let steps = 16;
    let mut poly: Vec<(f64, f64)> = Vec::new();

    // 右半圆（-90° → +90°）
    for i in 0..=steps {
        let a = -std::f64::consts::FRAC_PI_2
            + std::f64::consts::PI * (i as f64 / steps as f64);
        let x = half + r * a.cos();
        let y = r * a.sin();
        poly.push((clat + y / m_lat, clon + x / m_lon));
    }
    // 左半圆（+90° → +270°）
    for i in 0..=steps {
        let a = std::f64::consts::FRAC_PI_2
            + std::f64::consts::PI * (i as f64 / steps as f64);
        let x = -half + r * a.cos();
        let y = r * a.sin();
        poly.push((clat + y / m_lat, clon + x / m_lon));
    }

    run::Area {
        place_name: "示例场地".into(),
        place_code: DEMO_CODE.into(),
        fence_vertices: poly.len(),
        ban_count: 0,
        fence: poly,
        excludes: Vec::new(),
    }
}

const DEMO_CODE: &str = "__demo__";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PreviewResult {
    ok: bool,
    message: String,
    fence: Vec<[f64; 2]>,
    points: Vec<[f64; 2]>,
    pace_sec_km: f64,
    window_lo: f64,
    window_hi: f64,
    in_window: bool,
    count: usize,
    adjusted: bool,
    distance_m: f64,
    track_note: String,
    track_lanes: Vec<Vec<[f64; 2]>>,
}

/// 实时预览：改配速/距离/毛刺时立刻重算轨迹形状。
#[tauri::command]
fn preview(
    state: State<'_, Mutex<AppState>>,
    place_code: String,
    pace: String,
    dist: String,
    noise: f64,
    burrs: bool,
    seed: i64,
) -> PreviewResult {
    let empty = || PreviewResult {
        ok: false,
        message: String::new(),
        fence: vec![],
        points: vec![],
        pace_sec_km: 0.0,
        window_lo: 0.0,
        window_hi: 0.0,
        in_window: false,
        count: 0,
        adjusted: false,
        distance_m: 0.0,
        track_note: String::new(),
        track_lanes: Vec::new(),
    };

    let Some(pace_sec) = parse_pace(&pace) else {
        return PreviewResult {
            message: "配速格式无效".into(),
            ..empty()
        };
    };
    let Some(km) = parse_dist(&dist) else {
        return PreviewResult {
            message: "距离格式无效".into(),
            ..empty()
        };
    };

    let st = match state.lock() {
        Ok(s) => s,
        Err(_) => return empty(),
    };
    let area = match st.areas.iter().find(|a| a.place_code == place_code) {
        Some(a) => a.clone(),
        None => demo_area(),
    };

    let target = km * 1000.0;
    match track::generate_for_place(
        &area.place_code,
        &area.fence,
        &area.excludes,
        pace_sec,
        target,
        noise,
        seed,
        track::DEFAULT_PACE_TOLERANCE_SEC,
        burrs,
    ) {
        Ok(res) => {
            // 抽稀到 ~600 点，够画形状又不卡前端
            let step = (res.points.len() / 600).max(1);
            let pts: Vec<[f64; 2]> = res
                .points
                .iter()
                .step_by(step)
                .map(|p| [p.lat, p.lon])
                .collect();
            PreviewResult {
                ok: true,
                message: format!(
                    "{} 点 · 实测 {}",
                    res.points.len(),
                    track::fmt_pace(res.pace_sec_km)
                ),
                fence: area.fence.iter().map(|(a, b)| [*a, *b]).collect(),
                points: pts,
                pace_sec_km: res.pace_sec_km,
                window_lo: res.window_lo,
                window_hi: res.window_hi,
                in_window: res.in_window(),
                count: res.points.len(),
                adjusted: res.adjusted,
                distance_m: track::distance_of(&res.points),
                track_note: if res.inferred_standard_track {
                    if area.place_code == "T1001" {
                        "标准跑道，位置参考公开地图估计".into()
                    } else {
                        "标准 400m 跑道估计，非实测线".into()
                    }
                } else {
                    String::new()
                },
                track_lanes: res.track_lanes.iter()
                    .map(|lane| lane.iter().map(|&(lat, lon)| [lat, lon]).collect())
                    .collect(),
            }
        }
        Err(e) => PreviewResult {
            message: e,
            ..empty()
        },
    }
}


// ------------------------------------------------------------------ 防休眠

/// 打卡期间阻止系统空闲休眠。
///
/// macOS 上等价于 `caffeinate -i`：只在应用存活期间生效，进程退出自动解除。
/// 用子进程而不是私有 API，是因为 macOS 不提供「省电白名单」这种系统级开关，
/// 正确做法就是持有休眠断言。App Nap 另外由 Info.plist 的 NSAppSleepDisabled 关闭。
struct SleepGuard {
    child: Option<Child>,
}

impl SleepGuard {
    fn acquire() -> Self {
        let pid = std::process::id().to_string();
        let child = Command::new("/usr/bin/caffeinate")
            .args(["-i", "-w", &pid])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .ok();
        Self { child }
    }

    fn ok(&self) -> bool {
        self.child.is_some()
    }
}

impl Drop for SleepGuard {
    fn drop(&mut self) {
        if let Some(mut c) = self.child.take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PowerStatus {
    /// macos / android / other
    platform: String,
    /// /usr/bin/caffeinate 是否可用
    caffeinate: bool,
    /// 系统休眠设定（分钟），None = 从不休眠
    sleep_minutes: Option<i64>,
    /// 是否电池供电
    on_battery: bool,
    /// 是否有打卡正在阻止休眠
    running_awake: bool,
}

/// 读取当前电源与休眠设定，供设置页展示。
#[tauri::command]
fn power_status(app: tauri::AppHandle) -> PowerStatus {
    let platform = if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "android") {
        "android"
    } else {
        "other"
    }
    .to_string();
    let caffeinate = cfg!(target_os = "macos") && std::path::Path::new("/usr/bin/caffeinate").exists();

    let mut sleep_minutes = None;
    let mut on_battery = false;

    if let Ok(out) = Command::new("/usr/bin/pmset").arg("-g").output() {
        let text = String::from_utf8_lossy(&out.stdout);
        for line in text.lines() {
            let t = line.trim_start();
            let mut it = t.split_whitespace();
            if it.next() == Some("sleep") {
                if let Some(v) = it.next().and_then(|v| v.parse::<i64>().ok()) {
                    sleep_minutes = if v <= 0 { None } else { Some(v) };
                }
            }
        }
    }

    if let Ok(out) = Command::new("/usr/bin/pmset").arg("-g").arg("batt").output() {
        let text = String::from_utf8_lossy(&out.stdout);
        on_battery = text.contains("Battery Power");
    }

    let running_awake = app
        .try_state::<Runner>()
        .map(|r| r.active.load(Ordering::SeqCst))
        .unwrap_or(false);

    PowerStatus {
        platform,
        caffeinate,
        sleep_minutes,
        on_battery,
        running_awake,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunRequest {
    openid: String,
    place_code: String,
    pace: String,
    dist: String,
    noise: f64,
    burrs: bool,
    seed: i64,
    #[serde(default = "default_true")]
    keep_awake: bool,
}

fn default_true() -> bool {
    true
}

#[tauri::command]
fn start_run(
    app: tauri::AppHandle,
    state: State<'_, Mutex<AppState>>,
    req: RunRequest,
) -> Result<bool, String> {
    let mut st = state.lock().map_err(|_| "状态锁失败")?;

    // 只取 Arc 出来就释放 State 借用，后面才能把 app move 进线程
    let (cancel_for_thread, _active_for_thread) = {
        let runner = app.try_state::<Runner>().ok_or("运行状态未初始化")?;
        if runner.active.load(Ordering::SeqCst) {
            return Err("已有打卡在进行中".into());
        }
        (runner.cancel.clone(), runner.active.clone())
    };

    let Some(area) = st.areas.iter().find(|a| a.place_code == req.place_code).cloned() else {
        return Err("场地未同步".into());
    };
    let pace_sec = parse_pace(&req.pace).ok_or("配速格式无效")?;
    let km = parse_dist(&req.dist).ok_or("距离格式无效")?;
    st.openid = req.openid.trim().to_string();
    cancel_for_thread.store(false, Ordering::SeqCst);
    _active_for_thread.store(true, Ordering::SeqCst);
    drop(st);

    let oid = req.openid.trim().to_string();

    std::thread::spawn(move || {
        let mut api = Api::new();
        api.reset(&oid);

        // 整个打卡期间持有休眠断言，线程退出时随之释放
        let guard = if req.keep_awake && cfg!(target_os = "macos") {
            SleepGuard::acquire()
        } else {
            SleepGuard { child: None }
        };

        let emitter = app.clone();
        let log = move |m: String| {
            let _ = emitter.emit("run-log", m);
        };
        let emitter2 = app.clone();
        let on_state = move |s: run::RunState| {
            let _ = emitter2.emit("run-state", &s);
        };

        // 换 token
        if let Some(j) = api.check_binding(&oid) {
            let r = Resp::of(Some(&j));
            let ok = r.data.get("isBind").map(|v| match v {
                serde_json::Value::String(s) => s == "true",
                serde_json::Value::Bool(b) => *b,
                _ => false,
            });
            if r.ok && ok.unwrap_or(false) {
                if let Some(t) = r.data.get("token").and_then(|v| v.as_str()) {
                    api.token = t.to_string();
                    log(format!("✓ token = {}", api::mask(t)));
                }
            }
        }

        if req.keep_awake && cfg!(target_os = "macos") {
            if guard.ok() {
                log("已阻止系统空闲休眠（caffeinate）".into());
            } else {
                log("⚠ 无法阻止系统休眠，长跑可能被中断".into());
            }
        }

        run::run(
            &mut api,
            &area,
            pace_sec,
            km * 1000.0,
            req.noise,
            req.seed,
            track::DEFAULT_PACE_TOLERANCE_SEC,
            req.burrs,
            &cancel_for_thread,
            &on_state,
            &log,
        );

        if let Some(r) = app.try_state::<Runner>() {
            r.active.store(false, Ordering::SeqCst);
        }
    });

    Ok(true)
}

#[tauri::command]
fn cancel_run(app: tauri::AppHandle) -> bool {
    if let Some(r) = app.try_state::<Runner>() {
        r.cancel.store(true, Ordering::SeqCst);
    }
    true
}

#[tauri::command]
fn get_stats(openid: String) -> Result<run::Stats, String> {
    let mut api = Api::new();
    api.reset(&openid);
    let Some(j) = api.check_binding(&openid) else {
        return Err(format!("无法连接服务器：{}", api.last_error));
    };
    let r = Resp::of(Some(&j));
    let ok = r.data.get("isBind").map(|v| match v {
        serde_json::Value::String(s) => s == "true",
        serde_json::Value::Bool(b) => *b,
        _ => false,
    });
    if !r.ok || !ok.unwrap_or(false) {
        return Err("OpenID 未绑定校园跑身份".into());
    }
    let token = r
        .data
        .get("token")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    api.token = token;
    run::fetch_stats(&mut api).ok_or_else(|| "拉取成绩失败".to_string())
}


/// 启动自检：前端把真实布局度量回传，写入临时文件。
/// 用途是「没有截图权限时也能验证界面确实渲染了」，顺带留一份启动健康记录。
#[tauri::command]
fn ui_probe(info: serde_json::Value) -> bool {
    let path = std::env::temp_dir().join("xiaoyu-ui-probe.json");
    let body = serde_json::to_string_pretty(&info).unwrap_or_default();
    std::fs::write(path, body).is_ok()
}


/// 从手机外部私有目录读取电脑推进来的 openid。
///
/// 微信把小程序数据存放在应用私有目录，未 root 无法读取；
/// 所以手机端无法自行提取。这里提供一条**零手工**的传递通道：
/// 电脑上提取后 `adb push` 一个文件，App 启动时读取并删除。
#[tauri::command]
fn take_imported_openid() -> Option<String> {
    const FILES: [&str; 2] = [
        "/storage/emulated/0/Android/data/com.xiaoyu.run/files/import_openid.txt",
        "/sdcard/Android/data/com.xiaoyu.run/files/import_openid.txt",
    ];
    for p in FILES {
        if let Ok(raw) = std::fs::read_to_string(p) {
            let _ = std::fs::remove_file(p);
            let v = raw.trim().to_string();
            if !v.is_empty() {
                return Some(v);
            }
        }
    }
    None
}


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

/// 扫描本机微信缓存，提取 openid，并给出该 openid 的二维码。
#[tauri::command]
fn extract_openid() -> ExtractResult {
    let out = wxopenid::extract();
    let qr = out
        .found
        .iter()
        .find(|f| f.cqupt)
        .or_else(|| out.found.first())
        .and_then(|f| wxopenid::qr_svg(&f.openid, 300));
    ExtractResult {
        found: out.found,
        note: out.note,
        scanned_dirs: out.scanned_dirs,
        scanned_files: out.scanned_files,
        denied_dirs: out.denied_dirs,
        qr,
    }
}

/// 为任意文本生成二维码（手机扫码导入用）。
#[tauri::command]
fn make_qr(text: String, size: u32) -> Option<String> {
    wxopenid::qr_svg(&text, size.clamp(120, 1024))
}


/// 打开 macOS「完全磁盘访问权限」设置页。
/// 读别的应用沙箱容器必须授予该权限，否则缓存目录一律 EPERM。
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
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Tauri 2 的移动端入口：Android/iOS 靠这个宏生成 JNI 符号，
/// 缺了它 lib*.so 会在 Gradle 的符号校验阶段直接失败。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // 扫码插件只存在于移动端（crate 内部 #![cfg(mobile)]），桌面端不能注册。
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let builder = builder.plugin(tauri_plugin_barcode_scanner::init());

    builder
        .manage(Mutex::new(AppState::default()))
        .manage(Runner::default())
        .invoke_handler(tauri::generate_handler![
            load_config,
            save_config,
            connect,
            preview,
            start_run,
            cancel_run,
            get_stats,
            power_status,
            take_imported_openid,
            extract_openid,
            make_qr,
            open_privacy_settings,
            ui_probe,
            app_version
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
