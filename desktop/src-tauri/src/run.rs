//! 打卡流程编排：token → 规则 → 区域 → start2 → 分批上传 → end
//!
//! 上传节拍用「本批末点的 secOffset」对齐单调时钟，而不是固定 sleep：
//! 服务端按 collectTime 跨度算时长，多睡的部分会全部记进配速里。

use crate::api::{Api, Resp, POINT_BATCH};
use crate::geo;
use crate::track::{self, Poly, TrackPoint};
use chrono::Local;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// 一个可跑步的场地。
#[derive(Clone, Debug, Serialize)]
pub struct Area {
    pub place_name: String,
    pub place_code: String,
    #[serde(skip)]
    pub fence: Poly,
    #[serde(skip)]
    pub excludes: Vec<Poly>,
    pub fence_vertices: usize,
    pub ban_count: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct Rule {
    /// 秒/公里
    pub min_pace: f64,
    pub max_pace: f64,
    pub race_mile: f64,
}

impl Rule {
    pub fn suggest(&self) -> f64 {
        (self.min_pace + self.max_pace) / 2.0
    }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunState {
    pub phase: String,
    pub points_done: usize,
    pub points_total: usize,
    pub meters_done: f64,
    pub meters_total: f64,
    pub elapsed_sec: i64,
    pub eta_sec: i64,
    pub pace_sec_km: f64,
    pub pace_lo: f64,
    pub pace_hi: f64,
    pub batches_done: usize,
    pub batches_total: usize,
    pub server_mileage: f64,
    pub server_seconds: i64,
    pub finished: bool,
    pub failed: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatRow {
    pub place: String,
    pub km: f64,
    pub sec: i64,
    pub duration: String,
    pub valid: bool,
    pub reason: String,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub total: usize,
    pub valid_count: usize,
    pub invalid_count: usize,
    pub total_km: f64,
    pub avg_pace_sec_km: f64,
    pub by_place: Vec<(String, usize)>,
    pub rows: Vec<StatRow>,
}

pub fn fmt_duration(sec: i64) -> String {
    if sec < 0 {
        return "--:--".into();
    }
    format!("{:02}:{:02}", sec / 60, sec % 60)
}

fn as_str(v: &serde_json::Value, key: &str) -> String {
    match v.get(key) {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Number(n)) => n.to_string(),
        Some(serde_json::Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    }
}

// ------------------------------------------------------------------ 拉取

/// 规则。注意服务端的 minPace/maxPace 单位是「分钟/公里」。
pub fn fetch_rule(api: &mut Api) -> Option<Rule> {
    let j = api.get_rule()?;
    let r = Resp::of(Some(&j));
    if !r.ok {
        return None;
    }
    let min = as_str(&r.data, "minPace").parse::<f64>().unwrap_or(0.0);
    let max = as_str(&r.data, "maxPace").parse::<f64>().unwrap_or(0.0);
    let mile = as_str(&r.data, "raceMile")
        .parse::<f64>()
        .unwrap_or(2000.0);
    Some(Rule {
        min_pace: min * 60.0,
        max_pace: max * 60.0,
        race_mile: mile,
    })
}

/// 场地 + 电子围栏。与 /place/getPlayground 做交集，滤掉数据库测试残留。
pub fn fetch_areas(api: &mut Api) -> (Vec<Area>, Vec<String>) {
    let mut logs = Vec::new();
    let mut runnable: Vec<(String, String)> = Vec::new();

    if let Some(pj) = api.get_playground() {
        let pr = Resp::of(Some(&pj));
        if pr.ok {
            if let Some(arr) = pr.data.as_array() {
                for p in arr {
                    if as_str(p, "sportsItem") == "0" {
                        runnable.push((as_str(p, "placeCode"), as_str(p, "placeName")));
                    }
                }
            }
            logs.push(format!("可跑步场地 {} 个", runnable.len()));
        } else {
            logs.push(format!("⚠ 场地表拉取失败（{} {}），不过滤", pr.code, pr.msg));
        }
    } else {
        logs.push(format!("✗ 无法连接：{}", api.last_error));
        return (Vec::new(), logs);
    }

    let Some(aj) = api.get_all_area() else {
        logs.push(format!("✗ 无法连接：{}", api.last_error));
        return (Vec::new(), logs);
    };
    let r = Resp::of(Some(&aj));
    if !r.ok {
        logs.push(format!("✗ code={} {}", r.code, r.msg));
        return (Vec::new(), logs);
    }
    let Some(arr) = r.data.as_array() else {
        return (Vec::new(), logs);
    };

    let mut fences: Vec<(String, String, Poly)> = Vec::new();
    let mut bans: Vec<(String, Poly)> = Vec::new();
    let mut skipped: Vec<String> = Vec::new();

    for o in arr {
        let code = as_str(o, "placeCode");
        let name = as_str(o, "placeName");
        let func = as_str(o, "areaFuncCode");

        if !runnable.is_empty() && !runnable.iter().any(|(c, _)| *c == code) {
            let tag = format!("{} ({})", name, code);
            if !skipped.contains(&tag) {
                skipped.push(tag);
            }
            continue;
        }

        let Some(pl) = o.get("areaPointList").and_then(|v| v.as_array()) else {
            continue;
        };
        let pts: Poly = pl
            .iter()
            .map(|p| {
                let lat = p.get("latitude").and_then(|v| v.as_f64()).unwrap_or(0.0);
                let lon = p.get("longitude").and_then(|v| v.as_f64()).unwrap_or(0.0);
                (lat, lon)
            })
            .filter(|(a, b)| *a != 0.0 && *b != 0.0)
            .collect();
        if pts.len() < 3 {
            continue;
        }

        match func.as_str() {
            "dzwl" => {
                if !fences.iter().any(|(c, _, _)| *c == code) {
                    let display = runnable
                        .iter()
                        .find(|(c, _)| *c == code)
                        .map(|(_, n)| n.clone())
                        .unwrap_or(name);
                    fences.push((code, display, pts));
                }
            }
            "jpq" => bans.push((code, pts)),
            _ => {}
        }
    }

    if !skipped.is_empty() {
        logs.push(format!(
            "已过滤测试残留 {} 个：{}",
            skipped.len(),
            skipped.join("、")
        ));
    }

    let out: Vec<Area> = fences
        .into_iter()
        .map(|(code, name, fence)| {
            let ex: Vec<Poly> = bans
                .iter()
                .filter(|(c, _)| *c == code)
                .map(|(_, p)| p.clone())
                .collect();
            Area {
                place_name: name,
                place_code: code,
                fence_vertices: fence.len(),
                ban_count: ex.len(),
                fence,
                excludes: ex,
            }
        })
        .collect();

    logs.push(format!("可用场地 {} 个", out.len()));
    (out, logs)
}

pub fn fetch_stats(api: &mut Api) -> Option<Stats> {
    let j = api.get_sports_result()?;
    let r = Resp::of(Some(&j));
    if !r.ok {
        return None;
    }
    let arr = r.data.as_array()?;

    let mut stats = Stats::default();
    let mut by_place: Vec<(String, usize)> = Vec::new();
    let mut total_sec = 0.0;

    for o in arr {
        let km = as_str(o, "distance").parse::<f64>().unwrap_or(0.0) / 1000.0;
        let dur = as_str(o, "duration").parse::<f64>().unwrap_or(0.0) as i64;
        let valid = as_str(o, "isValid") == "1";
        let place = as_str(o, "placeName");
        let reason = as_str(o, "reason");

        stats.rows.push(StatRow {
            place: place.clone(),
            km,
            sec: dur,
            duration: fmt_duration(dur),
            valid,
            reason,
        });
        if valid {
            stats.valid_count += 1;
            stats.total_km += km;
            total_sec += dur as f64;
            match by_place.iter_mut().find(|(p, _)| *p == place) {
                Some(e) => e.1 += 1,
                None => by_place.push((place, 1)),
            }
        } else {
            stats.invalid_count += 1;
        }
    }

    stats.total = stats.rows.len();
    stats.avg_pace_sec_km = if stats.total_km > 0.0 {
        total_sec / stats.total_km
    } else {
        0.0
    };
    by_place.sort_by(|a, b| b.1.cmp(&a.1));
    stats.by_place = by_place;
    Some(stats)
}

// ------------------------------------------------------------------ 运行

/// 每个点是否计入里程（禁跑区内的点按小程序语义标记 isValid="2"）。
fn valid_flags(track: &[TrackPoint], area: &Area) -> Vec<bool> {
    track
        .iter()
        .map(|p| {
            geo::point_in_poly(p.lat, p.lon, &area.fence)
                && !area.excludes.iter().any(|e| geo::point_in_poly(p.lat, p.lon, e))
        })
        .collect()
}

/// 每 n 个点一批，并把上一批的末点作为下一批的首点。
fn batch<T: Clone>(pts: &[T], n: usize) -> Vec<Vec<T>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < pts.len() {
        let end = (i + n).min(pts.len());
        let mut chunk = Vec::with_capacity(end - i + 1);
        if i > 0 {
            chunk.push(pts[i - 1].clone());
        }
        chunk.extend_from_slice(&pts[i..end]);
        out.push(chunk);
        i = end;
    }
    out
}

#[allow(clippy::too_many_arguments)]
pub fn run(
    api: &mut Api,
    area: &Area,
    pace_sec_km: f64,
    target_m: f64,
    noise: f64,
    seed: i64,
    pace_tol: f64,
    burrs: bool,
    cancel: &AtomicBool,
    on_state: &dyn Fn(RunState),
    on_log: &dyn Fn(String),
) {
    cancel.store(false, Ordering::SeqCst);

    let mut state = RunState {
        phase: "初始化".into(),
        pace_sec_km,
        meters_total: target_m,
        eta_sec: -1,
        server_mileage: -1.0,
        server_seconds: -1,
        ..Default::default()
    };
    let push = |s: &RunState| on_state(s.clone());
    push(&state);

    // ① 规则校验（只提示，不阻断）
    if let Some(rule) = fetch_rule(api) {
        on_log(format!(
            "配速区间 {} ~ {}/km，建议 {}",
            track::fmt_pace(rule.min_pace),
            track::fmt_pace(rule.max_pace),
            track::fmt_pace(rule.suggest())
        ));
        if pace_sec_km < rule.min_pace || pace_sec_km > rule.max_pace {
            on_log(format!(
                "⚠ 目标配速超出规则区间，可能被判无效（区间 {} ~ {}）",
                track::fmt_pace(rule.min_pace),
                track::fmt_pace(rule.max_pace)
            ));
        }
        if target_m < rule.race_mile - 1.0 {
            on_log(format!(
                "⚠ 目标距离低于达标里程 {} m",
                rule.race_mile as i64
            ));
        }
    }

    if cancel.load(Ordering::SeqCst) {
        state.phase = "已取消".into();
        state.failed = true;
        on_state(state);
        return;
    }

    // ② 生成轨迹
    on_log("生成轨迹 …".into());
    state.phase = "生成轨迹".into();
    on_state(state.clone());

    let result = match track::generate(
        &area.fence,
        &area.excludes,
        pace_sec_km,
        target_m,
        noise,
        seed,
        pace_tol,
        burrs,
    ) {
        Ok(r) => r,
        Err(e) => {
            on_log(format!("✗ 轨迹生成失败：{}", e));
            state.phase = "失败：轨迹".into();
            state.failed = true;
            on_state(state);
            return;
        }
    };

    let track = &result.points;
    on_log(format!(
        "轨迹 {} 点 · 实测配速 {}/km · {}",
        track.len(),
        track::fmt_pace(result.pace_sec_km),
        track::audit(track, &area.fence, &area.excludes)
    ));
    if result.adjusted {
        on_log("   采样点数已微调以压进配速窗口".into());
    }

    if cancel.load(Ordering::SeqCst) {
        state.phase = "已取消".into();
        state.failed = true;
        on_state(state);
        return;
    }

    // ③ 开始记录
    on_log("开始打卡 start2 …".into());
    state.phase = "开始打卡".into();
    on_state(state.clone());

    let Some(sj) = api.start_sport(&area.place_name, &area.place_code) else {
        on_log(format!("✗ 网络失败：{}", api.last_error));
        state.phase = "失败：start2 网络".into();
        state.failed = true;
        on_state(state);
        return;
    };
    let sr = Resp::of(Some(&sj));
    if !sr.ok {
        on_log(format!("✗ code={} {}", sr.code, sr.msg));
        state.phase = "失败：start2".into();
        state.failed = true;
        on_state(state);
        return;
    }
    let mut record_no = match &sr.data {
        serde_json::Value::String(s) => s.trim().trim_matches('"').to_string(),
        serde_json::Value::Null => String::new(),
        other => other.to_string().trim().trim_matches('"').to_string(),
    };
    if record_no.is_empty() || record_no == "null" {
        on_log("✗ 未拿到 sportRecordNo".into());
        state.phase = "失败：无记录号".into();
        state.failed = true;
        on_state(state);
        return;
    }
    on_log(format!("✓ sportRecordNo = {}", record_no));

    // 服务端 start2 会接续上次没结束的记录，先清掉再开一条干净的
    let pre_pts = api
        .get_record_info(&record_no)
        .map(|v| {
            let r = Resp::of(Some(&v));
            r.data
                .get("points")
                .and_then(|p| p.as_array())
                .map(|a| a.len())
                .unwrap_or(0)
        })
        .unwrap_or(0);
    if pre_pts > 0 {
        on_log(format!("⚠ 接续了上次未结束的记录（已有 {} 点），先结束再重开", pre_pts));
        api.end_sport(&record_no);
        if let Some(sj2) = api.start_sport(&area.place_name, &area.place_code) {
            let r2 = Resp::of(Some(&sj2));
            let no2 = match &r2.data {
                serde_json::Value::String(s) => s.trim().trim_matches('"').to_string(),
                other => other.to_string().trim().trim_matches('"').to_string(),
            };
            if r2.ok && !no2.is_empty() && no2 != "null" && no2 != record_no {
                record_no = no2;
                on_log(format!("✓ 新 sportRecordNo = {}", record_no));
            } else {
                on_log("✗ 重新开一条失败，仍用原记录".into());
            }
        }
    } else {
        on_log("记录干净，从 0 开始".into());
    }

    // ④ 组装点并按节拍上传
    let valid = valid_flags(track, area);
    let banned = valid.iter().filter(|v| !**v).count();
    let start = Local::now().timestamp_millis();

    let fmt = "%Y-%m-%d %H:%M:%S";
    let payload: Vec<serde_json::Value> = track
        .iter()
        .enumerate()
        .map(|(i, p)| {
            let t = chrono::DateTime::from_timestamp_millis(start + p.sec_offset as i64 * 1000)
                .unwrap_or_default()
                .with_timezone(&Local);
            serde_json::json!({
                "sportRecordNo": record_no,
                "longitude": p.lon,
                "latitude": p.lat,
                "placeName": area.place_name,
                "placeCode": area.place_code,
                "collectTime": t.format(fmt).to_string(),
                "isValid": if valid[i] { "1" } else { "2" }
            })
        })
        .collect();

    let batches = batch(&payload, POINT_BATCH);
    let total_sec = track.len().saturating_sub(1) as i64;

    // 累计里程，用于界面上的"已跑"估算
    let mut cum = vec![0.0f64; track.len()];
    for k in 1..track.len() {
        cum[k] = cum[k - 1]
            + geo::hav(track[k - 1].lat, track[k - 1].lon, track[k].lat, track[k].lon);
    }

    on_log(format!(
        "共 {} 点 → {} 批（每批 {}，末点作下批首点）",
        payload.len(),
        batches.len(),
        POINT_BATCH
    ));
    on_log(format!(
        "轨迹时长 {}（服务端按 collectTime 跨度算时长）",
        fmt_duration(total_sec)
    ));
    if banned > 0 {
        on_log(format!(
            "⚠ 其中 {} 点落在禁跑区，已标记 isValid=\"2\"（不计里程）",
            banned
        ));
    }

    state.phase = "上传中".into();
    state.points_total = payload.len();
    state.batches_total = batches.len();
    state.pace_lo = result.window_lo;
    state.pace_hi = result.window_hi;
    on_state(state.clone());

    let wall = Instant::now();
    let mut uploaded = 0usize;
    let mut server_mileage = -1.0f64;
    let mut server_seconds = -1i64;

    for (i, b) in batches.iter().enumerate() {
        if cancel.load(Ordering::SeqCst) {
            on_log("已取消".into());
            state.phase = "已取消".into();
            state.failed = true;
            on_state(state);
            return;
        }

        match api.upload_points(&record_no, b) {
            None => on_log(format!(
                "批次 {}/{} ✗ {}",
                i + 1,
                batches.len(),
                api.last_error
            )),
            Some(j) => {
                let ur = Resp::of(Some(&j));
                if let Some(m) = ur.num("mileage") {
                    server_mileage = m;
                }
                if let Some(s) = ur.num("timeConsuming") {
                    server_seconds = s as i64;
                }
                if !ur.ok {
                    on_log(format!("批次 {}/{} ✗ code={} {}", i + 1, batches.len(), ur.code, ur.msg));
                }
            }
        }

        uploaded += if i == 0 { b.len() } else { b.len().saturating_sub(1) };
        uploaded = uploaded.min(track.len());
        let meters_done = if uploaded > 0 {
            cum[(uploaded - 1).min(track.len() - 1)]
        } else {
            0.0
        };

        if (i + 1) % 10 == 0 || i + 1 == batches.len() {
            on_log(format!(
                "批次 {}/{}　已跑 {:.2}/{:.2} km　用时 {}",
                i + 1,
                batches.len(),
                meters_done / 1000.0,
                target_m / 1000.0,
                fmt_duration(wall.elapsed().as_secs() as i64)
            ));
        }

        // 节拍对齐：目标时刻 = 起点 + 本批末点的 secOffset
        if i + 1 < batches.len() {
            let last_idx = uploaded.saturating_sub(1).min(track.len() - 1);
            let target_sec = track[last_idx].sec_offset as f64;
            let deadline = Duration::from_millis((target_sec * 1000.0) as u64);
            let mut last_push = Instant::now();
            while !cancel.load(Ordering::SeqCst) {
                let elapsed = wall.elapsed();
                if elapsed >= deadline {
                    break;
                }
                let remain = (deadline - elapsed).min(Duration::from_millis(200));
                std::thread::sleep(remain);
                if last_push.elapsed() >= Duration::from_millis(900) {
                    last_push = Instant::now();
                    let e = wall.elapsed().as_secs() as i64;
                    state.elapsed_sec = e;
                    state.eta_sec = (total_sec - e).max(0);
                    on_state(state.clone());
                }
            }
        }

        let elapsed = wall.elapsed().as_secs() as i64;
        state.points_done = uploaded;
        state.meters_done = if server_mileage >= 0.0 {
            server_mileage * 1000.0
        } else {
            meters_done
        };
        state.elapsed_sec = elapsed;
        state.eta_sec = (total_sec - elapsed).max(0);
        state.batches_done = i + 1;
        state.server_mileage = server_mileage;
        state.server_seconds = server_seconds;
        on_state(state.clone());
    }

    if cancel.load(Ordering::SeqCst) {
        state.phase = "已取消".into();
        state.failed = true;
        on_state(state);
        return;
    }

    // ⑤ 结束
    on_log("结束记录 end …".into());
    state.phase = "结算中".into();
    on_state(state.clone());

    match api.end_sport(&record_no) {
        Some(j) => {
            let er = Resp::of(Some(&j));
            if er.ok {
                on_log("✓ 结算完成".into());
            } else {
                on_log(format!("✗ 结算失败 code={} {}", er.code, er.msg));
            }
        }
        None => on_log(format!("✗ 结算网络失败：{}", api.last_error)),
    }

    state.phase = "已完成".into();
    state.finished = true;
    state.points_done = uploaded;
    state.meters_done = if server_mileage >= 0.0 {
        server_mileage * 1000.0
    } else {
        target_m
    };
    state.eta_sec = 0;
    on_state(state);
}
