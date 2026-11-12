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
        }
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
fn load_config(app: tauri::AppHandle) -> Config {
    let Ok(p) = config_path(&app) else {
        return Config::default();
    };
    std::fs::read_to_string(p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, config: Config) -> Result<(), String> {
    let p = config_path(&app)?;
    let s = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
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
    match track::generate(
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
            }
        }
        Err(e) => PreviewResult {
            message: e,
            ..empty()
        },
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
}

#[tauri::command]
fn start_run(
    app: tauri::AppHandle,
    state: State<'_, Mutex<AppState>>,
    req: RunRequest,
) -> Result<(), String> {
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
    drop(st);

    cancel_for_thread.store(false, Ordering::SeqCst);
    _active_for_thread.store(true, Ordering::SeqCst);

    let oid = req.openid.trim().to_string();

    std::thread::spawn(move || {
        let mut api = Api::new();
        api.reset(&oid);

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

    Ok(())
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

#[tauri::command]
fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

pub fn run() {
    tauri::Builder::default()
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
            ui_probe,
            app_version
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
