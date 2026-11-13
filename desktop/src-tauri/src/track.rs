//! 轨迹生成：配速标定 / 电子围栏内缩 / 禁跑区避让 / 多尺度 GPS 噪声 / 毛刺突起。
//!
//! 与原 Kotlin 实现同构，但用显式结构体替代闭包捕获，避免隐式状态。
//!
//! 关键设计：
//!  1. 采样点数由「配速 × 距离」锁死，二分反解地面速度，使实测配速等于目标配速
//!  2. 四层时间尺度的 AR(1) 噪声，模拟真实 GPS 的低频漂移 + 高频毛糙
//!  3. 越界不硬拽：按「基准点 → 噪声点」二分回缩，保住毛刺形状
//!  4. 逐秒速度带温和起伏，平均值仍锁死在目标配速上

use crate::geo;
use crate::rng::Rng;

/// 平均配速相对目标值允许偏离多少秒/公里。
pub const DEFAULT_PACE_TOLERANCE_SEC: f64 = 20.0;

const MAX_PACE_FIX_ATTEMPTS: usize = 4;

/// 环线相对围栏的内缩比例：从外向里试，取第一个基准环完全合法的。
const RING_INSETS: [f64; 10] = [0.90, 0.88, 0.86, 0.84, 0.81, 0.77, 0.72, 0.66, 0.59, 0.51];

/// 环线有机摆动的基准幅度（米）。
const RING_WOBBLE_M: f64 = 4.5;

/// 环线加密步长（米）。
const RING_STEP_M: f64 = 7.0;

/// AR(1) 噪声的相关系数与强度：几分钟级 / 十几秒 / 一秒级毛糙。
const NOISE_RHO: [f64; 4] = [0.997, 0.970, 0.850, 0.550];
const NOISE_SIGMA: [f64; 4] = [0.50, 0.27, 0.27, 0.33];

pub type Poly = Vec<(f64, f64)>;

#[derive(Clone, Debug, serde::Serialize)]
pub struct TrackPoint {
    pub lat: f64,
    pub lon: f64,
    pub sec_offset: i32,
    pub speed: f64,
    pub bearing: f64,
    pub accuracy: f64,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct TrackResult {
    pub points: Vec<TrackPoint>,
    /// 实测平均配速，秒/公里
    pub pace_sec_km: f64,
    pub window_lo: f64,
    pub window_hi: f64,
    /// 采样点数是否为了压进窗口而被调整过
    pub adjusted: bool,
    /// 400m standard geometry inferred from a fence, not surveyed lane lines.
    pub inferred_standard_track: bool,
    pub track_lanes: Vec<Poly>,
}

impl TrackResult {
    pub fn in_window(&self) -> bool {
        self.pace_sec_km >= self.window_lo && self.pace_sec_km <= self.window_hi
    }
}

/// 环线 / 起点的合法性判定上下文
struct Fence<'a> {
    fence: &'a [(f64, f64)],
    excludes: &'a [Vec<(f64, f64)>],
}

impl<'a> Fence<'a> {
    fn valid(&self, lat: f64, lon: f64) -> bool {
        if !geo::point_in_poly(lat, lon, self.fence) {
            return false;
        }
        for e in self.excludes {
            if geo::point_in_poly(lat, lon, e) {
                return false;
            }
        }
        true
    }
}

/// 逐秒的额外横向 / 纵向偏移（米）。
struct Spurs {
    lateral: Vec<f64>,
    forward: Vec<f64>,
}

/// 生成一条落在围栏内、配速精确的闭环轨迹。
pub fn generate(
    poly: &[(f64, f64)],
    excludes: &[Vec<(f64, f64)>],
    pace_sec_km: f64,
    target_m: f64,
    noise: f64,
    seed: i64,
    pace_tolerance_sec: f64,
    burrs: bool,
) -> Result<TrackResult, String> {
    if poly.len() < 3 {
        return Err("区域多边形至少需要 3 个顶点".into());
    }
    if !(pace_sec_km > 0.0) {
        return Err("配速必须为正数".into());
    }

    let fence = dedupe(poly);
    let bans: Vec<Poly> = excludes.iter().map(|e| dedupe(e)).filter(|e| e.len() >= 3).collect();
    let (wlo, whi) = pace_window(pace_sec_km, pace_tolerance_sec);
    let ctx = Fence {
        fence: &fence,
        excludes: &bans,
    };

    if !burrs {
        return Ok(generate_smooth(&ctx, pace_sec_km, target_m, noise, seed, wlo, whi));
    }

    // 环线必须先合法，噪声才有地方伸胳膊踢腿
    let ring = choose_ring(&ctx, seed);

    // 采样点数由「配速 × 距离」唯一确定（时长是硬约束）
    let mut n = ((target_m * pace_sec_km / 1000.0).round() as i64).max(2) as usize;
    let mut adjusted = false;
    let mut pts: Vec<TrackPoint> = Vec::new();
    let mut pace = 0.0;

    for _ in 0..MAX_PACE_FIX_ATTEMPTS {
        let weights = step_weights(n, seed);
        let spurs = make_spurs(n, seed, (noise / 0.6).clamp(0.0, 2.5));
        pts = build(&ring, n, &weights, &spurs, target_m, noise, seed, &ctx);
        pace = pace_of(&pts);
        if pace >= wlo && pace <= whi {
            break;
        }
        // 飘出窗口：按配速比例反推该用多少秒
        let ratio = pace / pace_sec_km;
        let next = ((n as f64 / ratio).round() as i64).clamp(2, (n as i64) * 4 + 8) as usize;
        if next == n {
            break;
        }
        n = next;
        adjusted = true;
    }

    Ok(TrackResult {
        points: pts,
        pace_sec_km: pace,
        window_lo: wlo,
        window_hi: whi,
        adjusted,
        inferred_standard_track: false,
        track_lanes: Vec::new(),
    })
}

/// 平均配速允许窗口（秒/公里）。
pub fn pace_window(pace_sec_km: f64, tol: f64) -> (f64, f64) {
    let t = tol.abs();
    ((pace_sec_km - t).max(60.0), pace_sec_km + t)
}

pub fn pace_of(pts: &[TrackPoint]) -> f64 {
    if pts.len() < 2 {
        return 0.0;
    }
    let d = distance_of(pts);
    if d > 0.0 {
        (pts.len() - 1) as f64 / (d / 1000.0)
    } else {
        0.0
    }
}

pub fn distance_of(pts: &[TrackPoint]) -> f64 {
    let mut s = 0.0;
    for i in 0..pts.len().saturating_sub(1) {
        s += geo::hav(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon);
    }
    s
}

// T1001/T1005 only have fence and exclusion coordinates, not surveyed lanes.
// Fit standard 400 m geometry around the largest exclusion area and reject the
// estimate if the first seven lanes cannot be placed inside the permitted area.
const TRACK_RADIUS_M: f64 = 36.8;
const TRACK_STRAIGHT_M: f64 = (400.0 - std::f64::consts::TAU * TRACK_RADIUS_M) / 2.0;
const TRACK_LANE_WIDTH_M: f64 = 1.22;
const TRACK_LANES: usize = 7;

struct StandardTrack {
    lat0: f64,
    lon0: f64,
    lon_scale: f64,
    axis: f64,
    center_u: f64,
    center_v: f64,
}

impl StandardTrack {
    fn ring(&self, offset_m: f64) -> Poly {
        let radius = TRACK_RADIUS_M + offset_m;
        let (s, c) = self.axis.sin_cos();
        let meters_per_degree = geo::R_EARTH * std::f64::consts::PI / 180.0;
        let mut out = Vec::with_capacity(130);
        for side in 0..2 {
            for i in 0..=64 {
                let a = -std::f64::consts::FRAC_PI_2
                    + side as f64 * std::f64::consts::PI
                    + i as f64 * std::f64::consts::PI / 64.0;
                let u = self.center_u
                    + if side == 0 { TRACK_STRAIGHT_M / 2.0 } else { -TRACK_STRAIGHT_M / 2.0 }
                    + radius * a.cos();
                let v = self.center_v + radius * a.sin();
                let (x, y) = (u * c - v * s, u * s + v * c);
                out.push((self.lat0 + y / meters_per_degree, self.lon0 + x / (meters_per_degree * self.lon_scale)));
            }
        }
        out
    }
}

fn lane_offset(lane: usize) -> f64 {
    if lane <= 1 { 0.0 } else { 1.12 + (lane - 2) as f64 * TRACK_LANE_WIDTH_M }
}

fn fit_standard_track(ctx: &Fence, place_code: Option<&str>) -> Result<StandardTrack, String> {
    let (lat0, lon0) = geo::centroid(ctx.fence);
    let lon_scale = lat0.to_radians().cos().abs().max(0.01);
    let meters_per_degree = geo::R_EARTH * std::f64::consts::PI / 180.0;
    let project = |&(lat, lon): &(f64, f64)| {
        ((lon - lon0) * lon_scale * meters_per_degree, (lat - lat0) * meters_per_degree)
    };
    let fence: Vec<_> = ctx.fence.iter().map(project).collect();
    let bounds = |poly: &[(f64, f64)], axis: f64| {
        let (s, c) = axis.sin_cos();
        poly.iter().fold((f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY), |b, &(x, y)| {
            let (u, v) = (x * c + y * s, -x * s + y * c);
            (b.0.min(u), b.1.max(u), b.2.min(v), b.3.max(v))
        })
    };
    let mut best: Option<(f64, f64)> = None;
    for i in 0..fence.len() {
        let (a, b) = (fence[i], fence[(i + 1) % fence.len()]);
        let axis = (b.1 - a.1).atan2(b.0 - a.0);
        let rect = bounds(&fence, axis);
        let area = (rect.1 - rect.0) * (rect.3 - rect.2);
        if area > 0.0 && best.map_or(true, |(_, old)| area < old) { best = Some((axis, area)); }
    }
    let mut axis = best.ok_or("围栏无法拟合跑道")?.0;
    let rect = bounds(&fence, axis);
    if rect.1 - rect.0 < rect.3 - rect.2 { axis += std::f64::consts::FRAC_PI_2; }

    let largest = ctx.excludes.iter().map(|poly| {
        let p: Vec<_> = poly.iter().map(project).collect();
        let area = (0..p.len()).map(|i| {
            let (a, b) = (p[i], p[(i + 1) % p.len()]);
            a.0 * b.1 - b.0 * a.1
        }).sum::<f64>().abs();
        (p, area)
    }).max_by(|a, b| a.1.total_cmp(&b.1)).ok_or("缺少场地内部参考区域，无法估计跑道位置")?;
    let inner = bounds(&largest.0, axis);
    let mut track = StandardTrack {
        lat0, lon0, lon_scale, axis,
        center_u: (inner.0 + inner.1) / 2.0,
        center_v: (inner.2 + inner.3) / 2.0,
    };
    if place_code == Some("T1001") {
        // Fenghua venue bounding-box centre, OpenStreetMap way 277744172,
        // converted from WGS-84 to GCJ-02. This is a map estimate, not a survey.
        // Only use it when it remains close to the live field's reference area.
        let mapped_center = (29.53277572, 106.60752688);
        let (x, y) = project(&mapped_center);
        let (s, c) = axis.sin_cos();
        let (u, v) = (x * c + y * s, -x * s + y * c);
        if (u - track.center_u).hypot(v - track.center_v) > 35.0 {
            return Err("地图参考位置与同步场地不一致，需要重新校准".into());
        }
        track.center_u = u;
        track.center_v = v;
    }
    // Validate intermediate offsets too, so changing lanes stays legal. Include
    // small GPS drift inside lane 1 and outside lane 7.
    for i in 0..=20 {
        let offset = -0.4 + i as f64 * ((lane_offset(TRACK_LANES) + 0.8) / 20.0);
        let ring = track.ring(offset);
        if densify_poly(&ring, 2.0).iter().any(|&(lat, lon)| !ctx.valid(lat, lon)) {
            return Err("标准跑道估计位置与围栏或禁跑区冲突，需要校准场地坐标".into());
        }
    }
    Ok(track)
}

fn lane_plan(n: usize, seed: i64) -> Vec<f64> {
    let mut rng = Rng::new(seed.wrapping_mul(479).wrapping_add(21));
    let mut lane = 2 + rng.below((TRACK_LANES - 2) as i32) as usize;
    let mut plan = vec![lane_offset(lane); n];
    let mut i = 0;
    while i < n {
        let hold = rng.range(65, 125) as usize;
        i = (i + hold).min(n);
        if i >= n { break; }
        let next = if lane == 1 { 2 } else if lane == TRACK_LANES { TRACK_LANES - 1 }
            else if rng.boolean() { lane + 1 } else { lane - 1 };
        let duration = rng.range(7, 13) as usize;
        let from = lane_offset(lane);
        let to = lane_offset(next);
        for j in 0..duration.min(n - i) {
            let t = (j + 1) as f64 / duration as f64;
            let blend = 0.5 - 0.5 * (std::f64::consts::PI * t).cos();
            plan[i + j] = from + (to - from) * blend;
        }
        i = (i + duration).min(n);
        lane = next;
        for value in &mut plan[i..] { *value = to; }
    }
    plan
}

#[allow(clippy::too_many_arguments)]
pub fn generate_for_place(
    place_code: &str, poly: &[(f64, f64)], excludes: &[Vec<(f64, f64)>],
    pace_sec_km: f64, target_m: f64, noise: f64, seed: i64,
    pace_tolerance_sec: f64, burrs: bool,
) -> Result<TrackResult, String> {
    if !matches!(place_code, "T1001" | "T1005") {
        return generate(poly, excludes, pace_sec_km, target_m, noise, seed, pace_tolerance_sec, burrs);
    }
    if poly.len() < 3 || pace_sec_km <= 0.0 || target_m <= 0.0 {
        return Err("场地、配速或距离无效".into());
    }
    let fence = dedupe(poly);
    let bans: Vec<_> = excludes.iter().map(|e| dedupe(e)).filter(|e| e.len() >= 3).collect();
    let ctx = Fence { fence: &fence, excludes: &bans };
    let stadium = fit_standard_track(&ctx, Some(place_code))?;
    let ring = stadium.ring(0.0);
    let (dense, cum) = densify_ring(&ring, 1.0);
    let (wlo, whi) = pace_window(pace_sec_km, pace_tolerance_sec);
    let mut n = ((target_m * pace_sec_km / 1000.0).round() as i64).max(2) as usize;
    let mut adjusted = false;
    let mut points = Vec::new();
    let mut pace = 0.0;
    for _ in 0..MAX_PACE_FIX_ATTEMPTS {
        let weights = step_weights(n, seed);
        let lanes = lane_plan(n, seed);
        let emit = |step: f64| {
            let mut rng = Rng::new(seed.wrapping_add(91));
            let mut lateral: f64 = 0.0;
            let mut forward: f64 = 0.0;
            let mut travelled = 0.0;
            let mut coords = Vec::with_capacity(n);
            for i in 0..n {
                let (p, heading) = point_at(&dense, &cum, travelled);
                let intensity = noise.clamp(0.0, 3.0) * if burrs { 1.0 } else { 0.5 };
                // Bounded correlated GPS drift, distinct from actual lane
                // changes. This adds modest variation without sudden jumps.
                lateral = (0.96 * lateral + rng.uniform(-0.55, 0.55) * intensity).clamp(-1.5, 1.5);
                forward = (0.90 * forward + rng.uniform(-0.22, 0.22) * intensity).clamp(-0.8, 0.8);
                let shifted = geo::offset(p.0, p.1, lanes[i] + lateral, (heading + 90.0) % 360.0);
                let final_point = geo::offset(shifted.0, shifted.1, forward, heading);
                coords.push(tolerate(p, final_point, &ctx));
                travelled += step * weights[i];
            }
            coords.iter().enumerate().map(|(i, p)| {
                let j = if i + 1 < n { i + 1 } else { i.saturating_sub(1) };
                let speed = geo::hav(p.0, p.1, coords[j].0, coords[j].1);
                let bearing = if i + 1 < n { geo::bearing(p.0, p.1, coords[j].0, coords[j].1) }
                    else { geo::bearing(coords[j].0, coords[j].1, p.0, p.1) };
                TrackPoint { lat: p.0, lon: p.1, sec_offset: i as i32,
                    speed: (speed * 100.0).round() / 100.0, bearing: (bearing * 10.0).round() / 10.0,
                    accuracy: 5.0 }
            }).collect::<Vec<_>>()
        };
        let mut lo = 0.0;
        let mut hi = 5.0;
        while distance_of(&emit(hi)) < target_m && hi < 1e5 { hi *= 1.5; }
        for _ in 0..44 {
            let mid = (lo + hi) / 2.0;
            if distance_of(&emit(mid)) < target_m { lo = mid; } else { hi = mid; }
        }
        points = emit((lo + hi) / 2.0);
        pace = pace_of(&points);
        if (wlo..=whi).contains(&pace) { break; }
        if pace <= 0.0 { return Err("无法生成有效跑道轨迹".into()); }
        let next = ((n as f64 * pace_sec_km / pace).round() as i64).clamp(2, n as i64 * 4 + 8) as usize;
        if next == n { break; }
        n = next;
        adjusted = true;
    }
    let track_lanes = (1..=TRACK_LANES).map(|lane| stadium.ring(lane_offset(lane))).collect();
    Ok(TrackResult { points, pace_sec_km: pace, window_lo: wlo, window_hi: whi, adjusted,
        inferred_standard_track: true, track_lanes })
}

/// 15 秒滚动窗口的配速 (最快, 最慢)，秒/公里。
#[allow(dead_code)]
pub fn window_pace_range(pts: &[TrackPoint], win: usize) -> (f64, f64) {
    if pts.len() <= win + 1 {
        return (0.0, 0.0);
    }
    let mut fastest = f64::MAX;
    let mut slowest: f64 = 0.0;
    for i in 0..=(pts.len() - 1 - win) {
        let mut seg = 0.0;
        for k in i..(i + win) {
            seg += geo::hav(pts[k].lat, pts[k].lon, pts[k + 1].lat, pts[k + 1].lon);
        }
        if seg <= 0.1 {
            continue;
        }
        let p = win as f64 / (seg / 1000.0);
        if p < fastest {
            fastest = p;
        }
        if p > slowest {
            slowest = p;
        }
    }
    if fastest == f64::MAX {
        return (0.0, 0.0);
    }
    (fastest, slowest)
}

pub fn fmt_pace(sec_per_km: f64) -> String {
    if sec_per_km <= 0.0 || sec_per_km > 3600.0 {
        return "--".to_string();
    }
    let m = (sec_per_km / 60.0) as i64;
    let s = (sec_per_km % 60.0) as i64;
    format!("{}'{:02}\"", m, s)
}

/// 统计：围栏内比例、禁跑区点数。
pub fn audit(pts: &[TrackPoint], fence: &[(f64, f64)], excludes: &[Vec<(f64, f64)>]) -> String {
    let inside = pts
        .iter()
        .filter(|p| geo::point_in_poly(p.lat, p.lon, fence))
        .count();
    let banned = pts
        .iter()
        .filter(|p| excludes.iter().any(|e| geo::point_in_poly(p.lat, p.lon, e)))
        .count();
    format!(
        "围栏内 {}/{} = {:.2}% | 禁跑区 {} 点",
        inside,
        pts.len(),
        inside as f64 * 100.0 / pts.len().max(1) as f64,
        banned
    )
}

// ------------------------------------------------------------------ 基础

/// 去掉重复顶点（服务器下发的多边形经常有连续重复点）。
fn dedupe(poly: &[(f64, f64)]) -> Poly {
    let mut out: Poly = Vec::with_capacity(poly.len());
    for p in poly {
        match out.last() {
            Some(last) if last.0 == p.0 && last.1 == p.1 => {}
            _ => out.push(*p),
        }
    }
    if out.len() > 1 {
        let first = out[0];
        let last = *out.last().unwrap();
        if first.0 == last.0 && first.1 == last.1 {
            out.pop();
        }
    }
    out
}

/// 选一圈基准环：先检查未加噪声的内缩环本身是否完全合法，不合适就往里缩一档。
fn choose_ring(ctx: &Fence, seed: i64) -> Poly {
    if let Some(ring) = choose_stadium(ctx) {
        return organic(&ring, RING_WOBBLE_M, seed, ctx);
    }
    let mut fallback: Poly = Vec::new();
    let mut fallback_bad = usize::MAX;

    for f in RING_INSETS {
        let raw = inset(ctx.fence, f);
        let bad = bad_points(&raw, ctx);
        if bad < fallback_bad {
            fallback_bad = bad;
            fallback = raw.clone();
        }
        if bad == 0 {
            return organic(&raw, RING_WOBBLE_M, seed, ctx);
        }
    }
    organic(&fallback, RING_WOBBLE_M, seed, ctx)
}

/// Fit an oriented stadium to the fence and use it only when its entire
/// perimeter avoids both the fence boundary and excluded areas.
fn choose_stadium(ctx: &Fence) -> Option<Poly> {
    let (lat0, lon0) = geo::centroid(ctx.fence);
    let lon_scale = lat0.to_radians().cos().abs().max(0.01);
    let xy: Vec<(f64, f64)> = ctx.fence.iter()
        .map(|&(lat, lon)| ((lon - lon0) * lon_scale, lat - lat0))
        .collect();
    let bounds = |angle: f64| {
        let (s, c) = angle.sin_cos();
        xy.iter().fold((f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY), |b, &(x, y)| {
            let (u, v) = (x * c + y * s, -x * s + y * c);
            (b.0.min(u), b.1.max(u), b.2.min(v), b.3.max(v))
        })
    };
    let mut best_angle = 0.0;
    let mut best_area = f64::INFINITY;
    for i in 0..xy.len() {
        let (a, b) = (xy[i], xy[(i + 1) % xy.len()]);
        let angle = (b.1 - a.1).atan2(b.0 - a.0);
        let bb = bounds(angle);
        let area = (bb.1 - bb.0) * (bb.3 - bb.2);
        if area < best_area && area > 0.0 {
            best_area = area;
            best_angle = angle;
        }
    }
    if !best_area.is_finite() { return None; }
    let mut bb = bounds(best_angle);
    if bb.1 - bb.0 < bb.3 - bb.2 {
        best_angle += std::f64::consts::FRAC_PI_2;
        bb = bounds(best_angle);
    }
    let (center_u, center_v) = ((bb.0 + bb.1) / 2.0, (bb.2 + bb.3) / 2.0);
    let (s, c) = best_angle.sin_cos();
    for factor in RING_INSETS {
        let radius = (bb.3 - bb.2) * factor / 2.0;
        let straight = ((bb.1 - bb.0) * factor / 2.0 - radius).max(0.0);
        if radius <= 0.0 { continue; }
        let mut ring = Vec::with_capacity(50);
        for side in 0..2 {
            for i in 0..=24 {
                let angle = -std::f64::consts::FRAC_PI_2
                    + side as f64 * std::f64::consts::PI
                    + i as f64 * std::f64::consts::PI / 24.0;
                let u = center_u + if side == 0 { straight } else { -straight } + radius * angle.cos();
                let v = center_v + radius * angle.sin();
                let (x, y) = (u * c - v * s, u * s + v * c);
                ring.push((lat0 + y, lon0 + x / lon_scale));
            }
        }
        if bad_points(&ring, ctx) == 0 { return Some(ring); }
    }
    None
}

/// 多边形边界（按 7m 加密）有多少点掉出围栏或压进禁跑区。
fn bad_points(poly: &[(f64, f64)], ctx: &Fence) -> usize {
    let mut bad = 0;
    let n = poly.len();
    for i in 0..n {
        let a = poly[i];
        let b = poly[(i + 1) % n];
        let d = geo::hav(a.0, a.1, b.0, b.1);
        let k = ((d / RING_STEP_M).ceil() as i32).max(1);
        for j in 0..k {
            let t = j as f64 / k as f64;
            let lat = a.0 + (b.0 - a.0) * t;
            let lon = a.1 + (b.1 - a.1) * t;
            if !ctx.valid(lat, lon) {
                bad += 1;
            }
        }
    }
    bad
}

/// 向内缩放：每个顶点朝质心方向按比例靠拢。
fn inset(poly: &[(f64, f64)], f: f64) -> Poly {
    let (clat, clon) = geo::centroid(poly);
    poly.iter()
        .map(|(la, lo)| (clat + (la - clat) * f, clon + (lo - clon) * f))
        .collect()
}

/// 沿「该点 → 质心」连线二分逼近边界，把越界点拉回围栏内。
fn clamp_to_fence(lat: f64, lon: f64, fence: &[(f64, f64)]) -> (f64, f64) {
    if fence.len() < 3 {
        return (lat, lon);
    }
    if geo::point_in_poly(lat, lon, fence) {
        return (lat, lon);
    }
    let (clat, clon) = geo::centroid(fence);
    // 质心本身不在围栏里（凹多边形）就没法这么拉
    if !geo::point_in_poly(clat, clon, fence) {
        return (lat, lon);
    }
    let mut lo = 0.0;
    let mut hi = 1.0;
    for _ in 0..24 {
        let mid = (lo + hi) / 2.0;
        let mlat = clat + (lat - clat) * mid;
        let mlon = clon + (lon - clon) * mid;
        if geo::point_in_poly(mlat, mlon, fence) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let t = (lo * 0.995).clamp(0.0, 1.0);
    (clat + (lat - clat) * t, clon + (lon - clon) * t)
}

/// 沿 base → p 连线二分，找最大的、仍然合法的内插点。
fn pull_toward(base: (f64, f64), p: (f64, f64), ctx: &Fence) -> (f64, f64) {
    if !ctx.valid(base.0, base.1) {
        return p;
    }
    let mut lo = 0.0;
    let mut hi = 1.0;
    for _ in 0..22 {
        let mid = (lo + hi) / 2.0;
        let mlat = base.0 + (p.0 - base.0) * mid;
        let mlon = base.1 + (p.1 - base.1) * mid;
        if ctx.valid(mlat, mlon) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let t = (lo * 0.99).clamp(0.0, 1.0);
    (base.0 + (p.0 - base.0) * t, base.1 + (p.1 - base.1) * t)
}

/// 把噪声点收回到合法范围，但只收噪声那一截，保留毛刺方向。
fn tolerate(base: (f64, f64), q: (f64, f64), ctx: &Fence) -> (f64, f64) {
    if ctx.valid(q.0, q.1) {
        return q;
    }
    if !ctx.valid(base.0, base.1) {
        return clamp_to_fence(q.0, q.1, ctx.fence);
    }
    let mut lo = 0.0;
    let mut hi = 1.0;
    for _ in 0..22 {
        let mid = (lo + hi) / 2.0;
        let mlat = base.0 + (q.0 - base.0) * mid;
        let mlon = base.1 + (q.1 - base.1) * mid;
        if ctx.valid(mlat, mlon) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let t = (lo * 0.99).clamp(0.0, 1.0);
    (base.0 + (q.0 - base.0) * t, base.1 + (q.1 - base.1) * t)
}

// ------------------------------------------------------------------ 配速形态

fn step_weights(n: usize, seed: i64) -> Vec<f64> {
    if n < 24 {
        return vec![1.0; n];
    }
    let slow = slowness_profile(n, seed);
    let terrain = random_walk_segments(n, 260, 0.06, seed, 1);
    let jitter = random_walk_segments(n, 11, 0.045, seed, 2);

    let mut w = vec![0.0; n];
    for i in 0..n {
        w[i] = 1.0 / (slow[i] * terrain[i] * jitter[i]);
    }
    let mean = w.iter().sum::<f64>() / n as f64;
    if mean > 0.0 {
        for v in w.iter_mut() {
            *v /= mean;
        }
    }
    w
}

/// "慢"的倍数：1.0 = 目标配速，越大越慢，22 ≈ 停下来系鞋带。
fn slowness_profile(n: usize, seed: i64) -> Vec<f64> {
    let mut out = vec![1.0; n];
    let mut rnd = Rng::new(seed.wrapping_mul(7919).wrapping_add(13));

    // 配速段：每 40~70 秒换一档
    let seg_len = 40 + rnd.below(31) as usize;
    let mut i = 0;
    while i < n {
        let end = (i + seg_len).min(n);
        let f = 0.85 + rnd.next_f64() * 0.60;
        for k in i..end {
            out[k] = f;
        }
        i = end;
    }

    for k in 0..n {
        if k < 25 {
            out[k] *= 1.08;
        }
        if k + 25 >= n {
            out[k] *= 0.94;
        }
        out[k] *= 1.0 + 0.10 * k as f64 / n as f64;
    }

    // 停顿：约 7% 的时间点落在里面
    let pauses = ((n as f64 * 0.07 / 6.0) as usize).clamp(1, 5);
    for _ in 0..pauses {
        let len = 4 + rnd.below(6) as usize;
        let span = n.saturating_sub(len + 1).max(1);
        let at = (span as f64 * (0.12 + rnd.next_f64() * 0.76)) as usize;
        for k in at..(at + len).min(n) {
            out[k] = 22.0;
        }
    }
    out
}

/// 分段常数的乘性扰动：每段随机长度、随机幅度。
fn random_walk_segments(n: usize, seg_len: i32, jitter: f64, seed: i64, salt: i64) -> Vec<f64> {
    let mut rnd = Rng::new(seed.wrapping_mul(131).wrapping_add(salt * 977).wrapping_add(17));
    let mut out = vec![1.0; n];
    let mut i = 0usize;
    while i < n {
        let g = ((seg_len / 2 + rnd.below(seg_len + 1)) as usize).max(1);
        let v = 1.0 + rnd.uniform(-jitter, jitter);
        let end = (i + g).min(n);
        for k in i..end {
            out[k] = v;
        }
        i = end;
    }
    out
}

// ------------------------------------------------------------------ 环线有机化

/// 把规则多边形磨成"人跑出来"的环线。
fn organic(raw: &[(f64, f64)], amp: f64, seed: i64, ctx: &Fence) -> Poly {
    let dense = densify_poly(raw, RING_STEP_M);
    let n = dense.len();
    if n < 16 {
        return raw.to_vec();
    }

    let mut per = 0.0;
    for i in 0..n {
        let a = dense[i];
        let b = dense[(i + 1) % n];
        per += geo::hav(a.0, a.1, b.0, b.1);
    }
    let step_m = (per / n as f64).max(1.0);
    let mut rnd = Rng::new(seed.wrapping_mul(1_000_003).wrapping_add(97));

    // 整数圈正弦：频率就是圈数，k 越大波长越短
    const HARMONIC: [f64; 6] = [2.0, 3.0, 5.0, 7.0, 11.0, 17.0];
    const WEIGHT: [f64; 6] = [0.46, 0.34, 0.24, 0.17, 0.12, 0.07];
    let phase: Vec<f64> = (0..6).map(|_| rnd.uniform(0.0, std::f64::consts::TAU)).collect();
    let wave_amp: Vec<f64> = (0..6)
        .map(|i| amp * WEIGHT[i] * rnd.uniform(0.55, 1.25))
        .collect();

    // 局部鼓包：3~5 处
    let bump_count = 3 + rnd.below(3) as usize;
    let mut bump_center = vec![0.0; bump_count];
    let mut bump_width = vec![0.0; bump_count];
    let mut bump_amp = vec![0.0; bump_count];
    for b in 0..bump_count {
        bump_center[b] = rnd.uniform(0.0, n as f64);
        let width_m = rnd.uniform(10.0, 38.0);
        bump_width[b] = (width_m / step_m).max(1.0);
        bump_amp[b] = rnd.uniform(2.0, 6.2) * if rnd.boolean() { 1.0 } else { -1.0 };
    }

    let mut cur: Vec<(f64, f64)> = Vec::with_capacity(n);
    for i in 0..n {
        let prev = dense[(i + n - 1) % n];
        let next = dense[(i + 1) % n];
        let hdg = geo::bearing(prev.0, prev.1, next.0, next.1);
        let u = i as f64 / n as f64 * std::f64::consts::TAU;

        let mut off = 0.0;
        for k in 0..6 {
            off += wave_amp[k] * (HARMONIC[k] * u + phase[k]).sin();
        }
        for b in 0..bump_count {
            let mut di = (i as f64 - bump_center[b]).abs();
            di = di.min(n as f64 - di);
            off += bump_amp[b] * (-0.5 * (di / bump_width[b]).powi(2)).exp();
        }
        cur.push(geo::offset(dense[i].0, dense[i].1, off, (hdg + 90.0) % 360.0));
    }

    // 只磨一遍、窗口 2：再磨就回到"光滑椭圆"了
    let w = 2usize;
    let mut smooth: Vec<(f64, f64)> = Vec::with_capacity(n);
    for i in 0..n {
        let (mut sla, mut slo) = (0.0, 0.0);
        for k in 0..(2 * w + 1) {
            let q = cur[(i + k + n - w) % n];
            sla += q.0;
            slo += q.1;
        }
        let d = (2 * w + 1) as f64;
        smooth.push((sla / d, slo / d));
    }

    // 收掉顶出围栏 / 碰进禁跑区的少数点
    let mut out: Vec<(f64, f64)> = Vec::with_capacity(n);
    for i in 0..n {
        let p = smooth[i];
        out.push(if ctx.valid(p.0, p.1) {
            p
        } else {
            pull_toward(dense[i], p, ctx)
        });
    }
    out
}

/// 按固定步长把多边形边界加密成点列。
fn densify_poly(raw: &[(f64, f64)], step_m: f64) -> Poly {
    let mut out = Vec::new();
    let n = raw.len();
    for i in 0..n {
        let a = raw[i];
        let b = raw[(i + 1) % n];
        let d = geo::hav(a.0, a.1, b.0, b.1);
        let k = ((d / step_m).ceil() as i32).max(1);
        for j in 0..k {
            let t = j as f64 / k as f64;
            out.push((a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t));
        }
    }
    out
}

/// 闭环点列 + 累计弧长。
fn densify_ring(ring: &[(f64, f64)], step_m: f64) -> (Poly, Vec<f64>) {
    let dense = densify_poly(ring, step_m);
    let n = dense.len();
    let mut cum = vec![0.0; n + 1];
    for i in 0..n {
        let a = dense[i];
        let b = if i == n - 1 { dense[0] } else { dense[i + 1] };
        cum[i + 1] = cum[i] + geo::hav(a.0, a.1, b.0, b.1);
    }
    (dense, cum)
}

/// 弧长 → 坐标 + 航向。
fn point_at(dense: &[(f64, f64)], cum: &[f64], dist: f64) -> ((f64, f64), f64) {
    let n = dense.len();
    if n == 0 {
        return ((0.0, 0.0), 0.0);
    }
    let total = cum[n];
    if total <= 0.0 {
        return (dense[0], 0.0);
    }
    let d = ((dist % total) + total) % total;

    let mut lo = 0usize;
    let mut hi = n - 1;
    while lo < hi {
        let mid = (lo + hi + 1) / 2;
        if cum[mid] <= d {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    let i = lo.min(n - 1);
    let seg = cum[i + 1] - cum[i];
    let t = if seg <= 0.0 { 0.0 } else { (d - cum[i]) / seg };
    let a = dense[i];
    let b = dense[(i + 1) % n];
    (
        (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t),
        geo::bearing(a.0, a.1, b.0, b.1),
    )
}

// ------------------------------------------------------------------ 毛刺 / 突起

/// 横向游走：让轨迹像真人跑出来的，而不是尺子画的一条线。
///
/// **不用脉冲式尖刺。** 早期版本用「单点横向偏移 9~16m」模拟 GPS 跳点，
/// 那在几何上等于一秒内出峰又回原位，必然形成尖锐的针状突起 ——
/// 真人跑步产生不了这种形状，看起来也假。
///
/// 现在改成若干**升余弦包络**的横向偏移：
///   env(s) = (1 - cos(2πs)) / 2   ，s ∈ [0,1]
/// 两端值与一阶导同时为零，所以偏移是"鼓包"而不是"尖刺"，
/// 起点和终点都平滑并入跑线。多档不同跨度叠加后，得到的是
/// 真实 App 上那种**粗细不均、来回游走**的带状轨迹。
///
/// 三档尺度（全部按总时长换算，2km 和 5km 密度一致）：
///   · 细微摆动  1.2~2.8m / 5~12 秒   每 ~22 秒一次
///   · 明显偏线  2.2~5.0m / 10~24 秒  每 ~70 秒一次
///   · 绕行贴外  4.5~8.5m / 18~40 秒  每 ~180 秒一次
fn make_spurs(n: usize, seed: i64, intensity: f64) -> Spurs {
    let mut lateral = vec![0.0; n];
    let mut forward = vec![0.0; n];
    if n < 80 {
        return Spurs { lateral, forward };
    }

    let mut rnd = Rng::new(seed.wrapping_mul(1_000_003).wrapping_add(77));

    let lo = ((n as f64 * 0.03) as i32).max(2);
    let hi = (n as i32 - 4).max(lo + 6);

    // (幅度下限, 幅度上限, 跨度下限(秒), 跨度上限(秒), 次数分母)
    let tiers: [(f64, f64, i32, i32, usize); 3] = [
        (1.2, 2.8, 5, 12, 22),
        (2.2, 5.0, 10, 24, 70),
        (4.5, 8.5, 18, 40, 180),
    ];

    for (amin, amax, smin, smax, div) in tiers {
        let count = (n / div).max(1);
        for _ in 0..count {
            let span = rnd.range(smin, smax + 1);
            let at = rnd.range(lo, hi);
            let amp = rnd.uniform(amin, amax) * intensity * rnd.sign();
            // 前后方向的轻微错位，避免所有鼓包都严格垂直于跑线
            let fwd_share = rnd.uniform(-0.22, 0.22);

            for k in 0..=span {
                let u = k as f64 / span as f64;
                let env = 0.5 - 0.5 * (std::f64::consts::TAU * u).cos();
                let idx = ((at + k) as usize) % n;
                lateral[idx] += amp * env;
                forward[idx] += amp * fwd_share * (std::f64::consts::TAU * u).sin();
            }
        }
    }

    // ---- 变道：真实跑者会在一段时间里保持某条跑道，然后换到另一条 ----
    // 形态是「保持 → S 形过渡（3~6 秒）→ 保持」，和来回鼓包完全不同。
    //
    // 先算出逐点的横向计划，再一次性加进去：
    // 早期版本在循环里直接 `lateral[idx] += ...` 且用 `.min(n-1)` 钳位，
    // 尾段多个 k 会落到同一个索引上重复累加，数值直接爆掉 —— 那就是尖刺的来源。
    let mut plan = vec![0.0f64; n];
    let mut cur = 0.0f64;
    let mut i = 0usize;
    while i < n {
        let hold = rnd.range(30, 80) as usize;
        let end = (i + hold).min(n);
        for v in plan.iter_mut().take(end).skip(i) {
            *v = cur;
        }
        i = end;
        if i >= n {
            break;
        }
        // 换到另一条道：约 1.2 ~ 3.6 米（一条跑道宽约 1.22 米）
        let target = rnd.uniform(1.2, 3.6) * intensity * rnd.sign();
        let dur = rnd.range(3, 7) as usize;
        // 换道是 0→1 的单调阶跃，用半周期余弦；
        // 用整周期（TAU）会变成"上去再回来"，末尾突然跳到目标值 —— 那就是尖刺。
        for k in 0..=dur {
            let idx = i + k;
            if idx >= n {
                break;
            }
            let u = k as f64 / dur as f64;
            let s_curve = 0.5 - 0.5 * (std::f64::consts::PI * u).cos();
            plan[idx] = cur + (target - cur) * s_curve;
        }
        cur = target;
        i = (i + dur).min(n);
    }

    // 闭环处理：环线首尾相接，若两端偏移不同会在起跑线处留一道缝。
    // 用一条贯穿全程的线性斜坡把缝抹平（等价于极缓慢的横向游移）。
    if n > 1 {
        let seam = plan[0] - plan[n - 1];
        for k in 0..n {
            plan[k] += seam * (k as f64 / (n - 1) as f64);
        }
    }

    for k in 0..n {
        lateral[k] += plan[k];
    }

    Spurs { lateral, forward }
}

// ------------------------------------------------------------------ 采样

/// 固定点数 n，按权重铺开每秒路程，再叠加四层相关噪声和稀疏野点。
fn build(
    ring: &[(f64, f64)],
    n: usize,
    weights: &[f64],
    spurs: &Spurs,
    target_m: f64,
    noise: f64,
    seed: i64,
    ctx: &Fence,
) -> Vec<TrackPoint> {
    let (dense, cum) = densify_ring(ring, 1.0);

    let emit = |step: f64| -> Vec<TrackPoint> {
        let mut rnd = Rng::new(seed);
        let mut rnd_acc = Rng::new(seed.wrapping_mul(31).wrapping_add(7));
        let levels = NOISE_RHO.len();
        let mut perr = vec![0.0; levels];
        let mut aerr = vec![0.0; levels];
        let mut travelled = 0.0;

        let mut lat = vec![0.0; n];
        let mut lon = vec![0.0; n];
        let mut pew = vec![0.0; n];

        for i in 0..n {
            let (p, hdg) = point_at(&dense, &cum, travelled);

            // 野点是"事件"，AR 噪声是"底噪"，先加野点再加底噪
            let mut perr_t = spurs.lateral[i];
            let mut aerr_t = spurs.forward[i];
            for c in 0..levels {
                perr[c] = NOISE_RHO[c] * perr[c] + rnd.uniform(-1.0, 1.0) * noise * NOISE_SIGMA[c];
                aerr[c] = NOISE_RHO[c] * aerr[c] + rnd.uniform(-1.0, 1.0) * noise * NOISE_SIGMA[c];
                perr_t += perr[c];
                aerr_t += aerr[c] * 0.45;
            }

            let o1 = geo::offset(p.0, p.1, perr_t, (hdg + 90.0) % 360.0);
            let q = geo::offset(o1.0, o1.1, aerr_t, hdg);
            let c = tolerate(p, q, ctx);
            lat[i] = c.0;
            lon[i] = c.1;
            pew[i] = perr_t;
            travelled += step * weights[i];
        }

        // speed / bearing 从最终坐标反推，保证字段与轨迹自洽
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let j = if i < n - 1 { i + 1 } else { i.saturating_sub(1) };
            let seg = geo::hav(lat[i], lon[i], lat[j], lon[j]);
            let brg = if i < n - 1 {
                geo::bearing(lat[i], lon[i], lat[j], lon[j])
            } else if n > 1 {
                geo::bearing(lat[j], lon[j], lat[i], lon[i])
            } else {
                0.0
            };
            let acc = 4.5 + pew[i].abs() * 0.30 + rnd_acc.uniform(-1.0, 2.2);
            out.push(TrackPoint {
                lat: lat[i],
                lon: lon[i],
                sec_offset: i as i32,
                speed: (seg * 100.0).round() / 100.0,
                bearing: (brg * 10.0).round() / 10.0,
                accuracy: ((acc.clamp(3.0, 18.0)) * 10.0).round() / 10.0,
            });
        }
        out
    };

    // 噪声按秒注入、与步长无关，会把实测距离撑长。二分反解地面步长。
    if distance_of(&emit(0.0)) >= target_m {
        return emit(0.0);
    }
    let mut lo = 0.0;
    let mut hi = 5.0;
    while distance_of(&emit(hi)) < target_m && hi < 1e5 {
        hi *= 1.5;
    }
    for _ in 0..46 {
        let mid = (lo + hi) / 2.0;
        if distance_of(&emit(mid)) < target_m {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    emit((lo + hi) / 2.0)
}

// ------------------------------------------------------------------ 光滑模式

fn generate_smooth(
    ctx: &Fence,
    pace_sec_km: f64,
    target_m: f64,
    noise: f64,
    seed: i64,
    wlo: f64,
    whi: f64,
) -> TrackResult {
    let mut n = ((target_m * pace_sec_km / 1000.0).round() as i64).max(2) as usize;
    let mut adjusted = false;
    let mut pts: Vec<TrackPoint> = Vec::new();
    let mut pace = 0.0;

    for _ in 0..MAX_PACE_FIX_ATTEMPTS {
        let weights = step_weights(n, seed);
        pts = generate_for_count_smooth(ctx, n, &weights, target_m, noise, seed);
        pace = pace_of(&pts);
        if pace >= wlo && pace <= whi {
            break;
        }
        let ratio = pace / pace_sec_km;
        let next = ((n as f64 / ratio).round() as i64).clamp(2, (n as i64) * 4 + 8) as usize;
        if next == n {
            break;
        }
        n = next;
        adjusted = true;
    }

    TrackResult {
        points: pts,
        pace_sec_km: pace,
        window_lo: wlo,
        window_hi: whi,
        adjusted,
        inferred_standard_track: false,
        track_lanes: Vec::new(),
    }
}

/// 逐个内缩档位试跑，返回得分最高的一版。
fn generate_for_count_smooth(
    ctx: &Fence,
    n: usize,
    weights: &[f64],
    target_m: f64,
    noise: f64,
    seed: i64,
) -> Vec<TrackPoint> {
    if let Some(ring) = choose_stadium(ctx) {
        let pts = build_smooth(&ring, n, weights, target_m, noise, seed, ctx.fence);
        if pts.iter().all(|p| ctx.valid(p.lat, p.lon)) {
            return pts;
        }
    }
    let mut best: Vec<TrackPoint> = Vec::new();
    let mut best_score = -1.0;

    for f in [0.90, 0.85, 0.80, 0.74, 0.66, 0.58, 0.50] {
        let ring = organic_smooth(&inset(ctx.fence, f), 3.0, seed);
        let pts = build_smooth(&ring, n, weights, target_m, noise, seed, ctx.fence);
        let inside = pts
            .iter()
            .filter(|p| geo::point_in_poly(p.lat, p.lon, ctx.fence))
            .count();
        let banned = pts
            .iter()
            .filter(|p| ctx.excludes.iter().any(|e| geo::point_in_poly(p.lat, p.lon, e)))
            .count();
        let score = (inside as f64 - banned as f64) / pts.len().max(1) as f64;
        let perfect = banned == 0 && inside == pts.len();
        if score > best_score {
            best_score = score;
            best = pts;
        }
        if perfect {
            break;
        }
    }
    best
}

/// 光滑版有机化：两条整数圈正弦 + 两轮滑动平均，磨成干净的椭圆。
fn organic_smooth(raw: &[(f64, f64)], amp: f64, seed: i64) -> Poly {
    let dense = densify_poly(raw, 12.0);
    let n = dense.len();
    if n < 8 {
        return raw.to_vec();
    }

    let mut rnd = Rng::new(seed);
    let p1 = rnd.uniform(0.0, std::f64::consts::TAU);
    let p2 = rnd.uniform(0.0, std::f64::consts::TAU);
    let a1 = amp * rnd.uniform(0.5, 1.0);
    let a2 = amp * rnd.uniform(0.3, 0.7);

    let mut cur: Vec<(f64, f64)> = Vec::with_capacity(n);
    for i in 0..n {
        let prev = dense[(i + n - 1) % n];
        let next = dense[(i + 1) % n];
        let hdg = geo::bearing(prev.0, prev.1, next.0, next.1);
        let u = i as f64 / n as f64 * std::f64::consts::TAU;
        let off = a1 * (2.0 * u + p1).sin() + a2 * (3.0 * u + p2).sin();
        cur.push(geo::offset(dense[i].0, dense[i].1, off, (hdg + 90.0) % 360.0));
    }

    for _ in 0..2 {
        let w = 2usize;
        let mut sm: Vec<(f64, f64)> = Vec::with_capacity(n);
        for i in 0..n {
            let (mut sla, mut slo) = (0.0, 0.0);
            for k in 0..(2 * w + 1) {
                let q = cur[(i + k + n - w) % n];
                sla += q.0;
                slo += q.1;
            }
            let d = (2 * w + 1) as f64;
            sm.push((sla / d, slo / d));
        }
        cur = sm;
    }
    cur
}

/// 光滑模式：单个 AR(1) 低频漂移，越界点直接拉回围栏。
fn build_smooth(
    ring: &[(f64, f64)],
    n: usize,
    weights: &[f64],
    target_m: f64,
    noise: f64,
    seed: i64,
    fence: &[(f64, f64)],
) -> Vec<TrackPoint> {
    let (dense, cum) = densify_ring(ring, 1.0);

    let emit = |step: f64| -> Vec<TrackPoint> {
        let mut rnd = Rng::new(seed);
        let mut rnd_acc = Rng::new(seed.wrapping_mul(31).wrapping_add(7));
        let mut perr = 0.0;
        let mut aerr = 0.0;
        let mut travelled = 0.0;

        let mut lat = vec![0.0; n];
        let mut lon = vec![0.0; n];
        let mut pew = vec![0.0; n];
        for i in 0..n {
            let (p, hdg) = point_at(&dense, &cum, travelled);
            perr = 0.9 * perr + rnd.uniform(-1.0, 1.0) * noise * 0.55;
            aerr = 0.9 * aerr + rnd.uniform(-1.0, 1.0) * noise * 0.35;
            let o1 = geo::offset(p.0, p.1, perr, (hdg + 90.0) % 360.0);
            let o2 = geo::offset(o1.0, o1.1, aerr, hdg);
            let c = clamp_to_fence(o2.0, o2.1, fence);
            lat[i] = c.0;
            lon[i] = c.1;
            pew[i] = perr;
            travelled += step * weights[i];
        }

        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let j = if i < n - 1 { i + 1 } else { i.saturating_sub(1) };
            let seg = geo::hav(lat[i], lon[i], lat[j], lon[j]);
            let brg = if i < n - 1 {
                geo::bearing(lat[i], lon[i], lat[j], lon[j])
            } else if n > 1 {
                geo::bearing(lat[j], lon[j], lat[i], lon[i])
            } else {
                0.0
            };
            let acc = 4.5 + pew[i].abs() * 0.45 + rnd_acc.uniform(-1.0, 2.2);
            out.push(TrackPoint {
                lat: lat[i],
                lon: lon[i],
                sec_offset: i as i32,
                speed: (seg * 100.0).round() / 100.0,
                bearing: (brg * 10.0).round() / 10.0,
                accuracy: ((acc.clamp(3.0, 18.0)) * 10.0).round() / 10.0,
            });
        }
        out
    };

    if distance_of(&emit(0.0)) >= target_m {
        return emit(0.0);
    }
    let mut lo = 0.0;
    let mut hi = 5.0;
    while distance_of(&emit(hi)) < target_m && hi < 1e5 {
        hi *= 1.5;
    }
    for _ in 0..44 {
        let mid = (lo + hi) / 2.0;
        if distance_of(&emit(mid)) < target_m {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    emit((lo + hi) / 2.0)
}

// ------------------------------------------------------------------ 测试

#[cfg(test)]
mod tests {
    use super::*;

    /// 合成一个约 115m × 100m 的矩形围栏（接近 400m 跑道的内场），GCJ02 坐标。
    fn rect_fence() -> Poly {
        let clat = 29.5330;
        let clon = 106.6050;
        let dlat = 0.00052;
        let dlon = 0.00052;
        vec![
            (clat - dlat, clon - dlon),
            (clat - dlat, clon + dlon),
            (clat + dlat, clon + dlon),
            (clat + dlat, clon - dlon),
        ]
    }

    fn assert_all_inside(pts: &[TrackPoint], fence: &Poly) {
        for p in pts {
            assert!(
                geo::point_in_poly(p.lat, p.lon, fence),
                "点 ({}, {}) 落在围栏外",
                p.lat,
                p.lon
            );
        }
    }

    #[test]
    fn rectangular_fence_gets_a_stadium_ring() {
        let fence = rect_fence();
        let ctx = Fence { fence: &fence, excludes: &[] };
        let ring = choose_stadium(&ctx).expect("矩形围栏应能容纳跑道");
        assert_eq!(ring.len(), 50);
        assert_eq!(bad_points(&ring, &ctx), 0);
        // The two straight sections join the endpoints of equal semicircles.
        let straight_a = geo::hav(ring[24].0, ring[24].1, ring[25].0, ring[25].1);
        let straight_b = geo::hav(ring[49].0, ring[49].1, ring[0].0, ring[0].1);
        assert!(straight_a > 5.0 && (straight_a - straight_b).abs() < 0.2);
        let arc_step = geo::hav(ring[0].0, ring[0].1, ring[1].0, ring[1].1);
        assert!(arc_step > 1.0 && straight_a > arc_step);
    }

    #[test]
    fn stadium_respects_rotated_fence_and_excluded_area() {
        let (lat, lon) = (29.533_f64, 106.605_f64);
        let scale = lat.to_radians().cos();
        let (s, c) = 0.5_f64.sin_cos();
        let map = |x: f64, y: f64| (lat + x * s + y * c, lon + (x * c - y * s) / scale);
        let fence = vec![map(-0.0008, -0.0004), map(0.0008, -0.0004), map(0.0008, 0.0004), map(-0.0008, 0.0004)];
        let ban = vec![map(-0.0001, -0.0001), map(0.0001, -0.0001), map(0.0001, 0.0001), map(-0.0001, 0.0001)];
        let bans = vec![ban];
        let ctx = Fence { fence: &fence, excludes: &bans };
        let ring = choose_stadium(&ctx).expect("旋转围栏应能容纳跑道");
        assert_eq!(bad_points(&ring, &ctx), 0);
        let straight = geo::hav(ring[24].0, ring[24].1, ring[25].0, ring[25].1);
        assert!(straight > 30.0);
    }

    #[test]
    fn stadium_fits_taiji_fixture() {
        // Coordinates already used in the Android track tests.
        let fence = vec![
            (29.533933, 106.608884), (29.531893, 106.608970),
            (29.532019, 106.610646), (29.533979, 106.610558),
        ];
        let bans = vec![vec![
            (29.533214, 106.609447), (29.533071, 106.609473),
            (29.532917, 106.609468), (29.532626, 106.609486),
            (29.532506, 106.609612), (29.532533, 106.610029),
            (29.532691, 106.610093), (29.533146, 106.610060),
            (29.533421, 106.610058), (29.533549, 106.609690),
            (29.533457, 106.609455),
        ]];
        let ctx = Fence { fence: &fence, excludes: &bans };
        let ring = choose_stadium(&ctx).expect("太极运动场应能容纳跑道");
        assert_eq!(bad_points(&ring, &ctx), 0);
        for burrs in [false, true] {
            let track = generate(&fence, &bans, 345.0, 2000.0, 0.6, 42, 20.0, burrs).unwrap();
            assert!(track.in_window());
            assert!(track.points.iter().all(|p| ctx.valid(p.lat, p.lon)));
        }
    }

    fn stadium_fixtures() -> Vec<(&'static str, Poly, Vec<Poly>)> {
        vec![
            ("T1005", vec![
                (29.533933, 106.608884), (29.531893, 106.608970),
                (29.532019, 106.610646), (29.533979, 106.610558),
            ], vec![vec![
                (29.533214, 106.609447), (29.533071, 106.609473),
                (29.532917, 106.609468), (29.532626, 106.609486),
                (29.532506, 106.609612), (29.532533, 106.610029),
                (29.532691, 106.610093), (29.533146, 106.610060),
                (29.533421, 106.610058), (29.533549, 106.609690),
                (29.533457, 106.609455),
            ]]),
            ("T1001", vec![
                (29.532692, 106.608105), (29.532871, 106.608176),
                (29.533363, 106.608104), (29.533592, 106.608107),
                (29.533707, 106.607374), (29.533713, 106.607166),
                (29.533627, 106.607020), (29.533197, 106.607033),
                (29.532749, 106.607017), (29.532289, 106.607043),
                (29.532065, 106.607032), (29.531956, 106.607445),
                (29.531947, 106.607814), (29.531952, 106.607986),
                (29.532145, 106.608111), (29.532466, 106.608101),
            ], vec![vec![
                (29.532769, 106.607824), (29.533107, 106.607843),
                (29.533293, 106.607835), (29.533417, 106.607734),
                (29.533403, 106.607527), (29.533345, 106.607373),
                (29.533219, 106.607323), (29.533012, 106.607303),
                (29.532650, 106.607330), (29.532462, 106.607380),
                (29.532362, 106.607479), (29.532323, 106.607624),
                (29.532385, 106.607769), (29.532528, 106.607824),
                (29.532717, 106.607841),
            ]]),
        ]
    }

    #[test]
    fn standard_track_has_correct_lane_lengths_at_both_fixtures() {
        for (code, fence, bans) in stadium_fixtures() {
            let ctx = Fence { fence: &fence, excludes: &bans };
            let geometry = fit_standard_track(&ctx, Some(code)).unwrap_or_else(|e| panic!("{code}: {e}"));
            for (lane, expected) in [(1, 400.0), (2, 407.04), (3, 414.70), (4, 422.37), (7, 445.36)] {
                let ring = geometry.ring(lane_offset(lane));
                let (_, cum) = densify_ring(&ring, 1.0);
                let length = *cum.last().unwrap();
                assert!((length - expected).abs() < 0.1, "{code} lane {lane}: {length}");
            }
        }
    }

    #[test]
    fn fenghua_uses_mapped_center_and_not_exclusion_center() {
        let (code, fence, bans) = stadium_fixtures().remove(1);
        let ctx = Fence { fence: &fence, excludes: &bans };
        let geometry = fit_standard_track(&ctx, Some(code)).unwrap();
        let (s, c) = geometry.axis.sin_cos();
        let x = geometry.center_u * c - geometry.center_v * s;
        let y = geometry.center_u * s + geometry.center_v * c;
        let meters_per_degree = geo::R_EARTH * std::f64::consts::PI / 180.0;
        let lat = geometry.lat0 + y / meters_per_degree;
        let lon = geometry.lon0 + x / (meters_per_degree * geometry.lon_scale);
        assert!(geo::hav(lat, lon, 29.53277572, 106.60752688) < 0.01);
    }

    #[test]
    fn standard_track_noise_changes_the_route_and_stays_repeatable() {
        let (code, fence, bans) = stadium_fixtures().remove(1);
        let generate_with_noise = |noise| {
            generate_for_place(code, &fence, &bans, 345.0, 2000.0, noise, 42, 20.0, true).unwrap()
        };
        let clean = generate_with_noise(0.0);
        let noisy = generate_with_noise(0.6);
        let again = generate_with_noise(0.6);
        let max_difference = clean.points.iter().zip(&noisy.points)
            .map(|(a, b)| geo::hav(a.lat, a.lon, b.lat, b.lon))
            .fold(0.0_f64, f64::max);
        assert!(max_difference > 0.5, "GPS jitter has no visible effect");
        assert_eq!(noisy.points.len(), again.points.len());
        assert!(noisy.points.iter().zip(&again.points).all(|(a, b)| a.lat == b.lat && a.lon == b.lon));
    }

    #[test]
    fn upper_jitter_range_changes_both_tracks_and_stays_in_bounds() {
        for (code, fence, bans) in stadium_fixtures() {
            let ctx = Fence { fence: &fence, excludes: &bans };
            let make = |noise| generate_for_place(code, &fence, &bans, 345.0, 2000.0, noise, 42, 20.0, true).unwrap();
            let at_two = make(2.0);
            let at_three = make(3.0);
            assert!(at_three.in_window());
            assert!(at_three.points.iter().all(|p| ctx.valid(p.lat, p.lon)));
            assert!(at_two.points.iter().zip(&at_three.points).any(|(a, b)| geo::hav(a.lat, a.lon, b.lat, b.lon) > 0.1));
        }
    }

    #[test]
    fn both_venues_get_legal_standard_tracks_with_lane_changes() {
        for (code, fence, bans) in stadium_fixtures() {
            for burrs in [false, true] {
                for seed in [0, 1, 42, 123, 2026] {
                    let track = generate_for_place(code, &fence, &bans, 345.0, 2000.0, 0.6, seed, 20.0, burrs)
                        .unwrap_or_else(|e| panic!("{code}: {e}"));
                    assert!(track.inferred_standard_track && track.in_window());
                    assert_eq!(track.track_lanes.len(), 7);
                    assert!((distance_of(&track.points) - 2000.0).abs() < 1.0);
                    let ctx = Fence { fence: &fence, excludes: &bans };
                    assert!(track.points.iter().all(|p| ctx.valid(p.lat, p.lon)));
                    let max_step = track.points.windows(2)
                        .map(|w| geo::hav(w[0].lat, w[0].lon, w[1].lat, w[1].lon))
                        .fold(0.0_f64, f64::max);
                    assert!(max_step < 10.0, "{code} seed={seed} step={max_step}");
                }
            }
        }
        let lanes = lane_plan(690, 42);
        assert!(lanes.iter().any(|&v| (v - lanes[0]).abs() > 1.0));
        assert!(lanes.windows(2).all(|p| (p[1] - p[0]).abs() < 0.3));
        assert!(lanes.iter().all(|&p| (0.0..=lane_offset(7)).contains(&p)));
    }

    #[test]
    fn standard_track_rejects_missing_or_conflicting_reference_area() {
        let (_, fence, _) = stadium_fixtures().remove(0);
        let missing = generate_for_place("T1005", &fence, &[], 345.0, 2000.0, 0.6, 42, 20.0, true);
        assert!(missing.is_err());
        let blocked = generate_for_place("T1005", &fence, &[fence.clone()], 345.0, 2000.0, 0.6, 42, 20.0, true);
        assert!(blocked.is_err());
    }

    #[test]
    fn last_ring_segment_interpolates_back_to_start() {
        let ring = vec![(29.0, 106.0), (29.0, 106.001), (29.001, 106.001), (29.001, 106.0)];
        let (dense, cum) = densify_ring(&ring, 20.0);
        let last = *dense.last().unwrap();
        let first = dense[0];
        let closing = geo::hav(last.0, last.1, first.0, first.1);
        let (p, _) = point_at(&dense, &cum, cum.last().unwrap() - closing / 2.0);
        let midpoint = ((last.0 + first.0) / 2.0, (last.1 + first.1) / 2.0);
        assert!(geo::hav(p.0, p.1, midpoint.0, midpoint.1) < 0.01);
    }

    #[test]
    fn pace_window_is_clamped() {
        let (lo, hi) = pace_window(345.0, 20.0);
        assert!((lo - 325.0).abs() < 1e-9);
        assert!((hi - 365.0).abs() < 1e-9);
        // 容差大于配速时下界不能到 0
        let (lo2, _) = pace_window(70.0, 40.0);
        assert!(lo2 >= 60.0);
    }

    #[test]
    fn fmt_pace_formats() {
        assert_eq!(fmt_pace(345.0), "5'45\"");
        assert_eq!(fmt_pace(0.0), "--");
    }

    #[test]
    fn smooth_track_hits_target_pace_and_stays_inside() {
        let fence = rect_fence();
        let r = generate(&fence, &[], 345.0, 2000.0, 0.6, 12345, 20.0, false).unwrap();

        // 距离落在目标附近（±3%）
        let d = distance_of(&r.points);
        assert!(
            (d - 2000.0).abs() / 2000.0 < 0.03,
            "距离偏差过大: {} m",
            d
        );

        // 实测配速落在允许窗口
        assert!(r.in_window(), "配速 {} 不在窗口 {:?}..{:?}", r.pace_sec_km, r.window_lo, r.window_hi);

        // 100% 落在围栏内
        assert_all_inside(&r.points, &fence);

        // 每秒一个点
        assert_eq!(r.points.len(), 690, "2km @5'45 应为 690 点");
        assert!(r.points.iter().enumerate().all(|(i, p)| p.sec_offset == i as i32));
    }

    #[test]
    fn burr_track_hits_target_pace_and_stays_inside() {
        let fence = rect_fence();
        let r = generate(&fence, &[], 345.0, 2000.0, 0.6, 999, 20.0, true).unwrap();

        assert!(r.in_window(), "配速 {} 超窗", r.pace_sec_km);
        assert_all_inside(&r.points, &fence);
        let d = distance_of(&r.points);
        assert!((d - 2000.0).abs() / 2000.0 < 0.03, "距离偏差过大: {}", d);
    }

    #[test]
    fn avoids_banned_area() {
        let fence = rect_fence();
        // 把禁跑区放在几何中心，覆盖 ±30% 范围
        let (clat, clon) = geo::centroid(&fence);
        let d = 0.00016;
        let ban = vec![
            (clat - d, clon - d),
            (clat - d, clon + d),
            (clat + d, clon + d),
            (clat + d, clon - d),
        ];
        let r = generate(&fence, &[ban.clone()], 345.0, 1000.0, 0.4, 7, 20.0, true).unwrap();

        let banned = r
            .points
            .iter()
            .filter(|p| geo::point_in_poly(p.lat, p.lon, &ban))
            .count();
        assert_eq!(banned, 0, "有 {} 个点落进禁跑区", banned);
    }

    #[test]
    fn same_seed_is_deterministic() {
        let fence = rect_fence();
        let a = generate(&fence, &[], 345.0, 1000.0, 0.6, 42, 20.0, true).unwrap();
        let b = generate(&fence, &[], 345.0, 1000.0, 0.6, 42, 20.0, true).unwrap();
        assert_eq!(a.points.len(), b.points.len());
        for (x, y) in a.points.iter().zip(b.points.iter()) {
            assert_eq!(x.lat, y.lat);
            assert_eq!(x.lon, y.lon);
        }
    }

    #[test]
    fn different_seed_changes_shape() {
        let fence = rect_fence();
        let a = generate(&fence, &[], 345.0, 1000.0, 0.6, 1, 20.0, true).unwrap();
        let b = generate(&fence, &[], 345.0, 1000.0, 0.6, 2, 20.0, true).unwrap();
        let diff = a
            .points
            .iter()
            .zip(b.points.iter())
            .any(|(x, y)| x.lat != y.lat || x.lon != y.lon);
        assert!(diff, "不同种子应生成不同轨迹");
    }

    #[test]
    fn rejects_degenerate_input() {
        assert!(generate(&[], &[], 345.0, 2000.0, 0.6, 1, 20.0, false).is_err());
        let fence = rect_fence();
        assert!(generate(&fence, &[], 0.0, 2000.0, 0.6, 1, 20.0, false).is_err());
    }

    #[test]
    fn window_pace_range_is_finite() {
        let fence = rect_fence();
        let r = generate(&fence, &[], 345.0, 1000.0, 0.6, 5, 20.0, true).unwrap();
        let (fast, slow) = window_pace_range(&r.points, 15);
        assert!(fast > 0.0 && slow > 0.0);
        assert!(fast <= slow);
    }
}

#[cfg(test)]
mod shape_tests {
    use super::*;

    fn rect_fence() -> Poly {
        let (clat, clon) = (29.5330, 106.6050);
        let (dlat, dlon) = (0.00052, 0.00052);
        vec![
            (clat - dlat, clon - dlon),
            (clat - dlat, clon + dlon),
            (clat + dlat, clon + dlon),
            (clat + dlat, clon - dlon),
        ]
    }

    /// 到局部弦的垂距 / 弦长。
    ///
    /// 这是「尖刺」的物理定义：正常跑动里，中间点应该贴着前后两点的连线
    /// （比值很小）；出峰又原路返回的针状突起，比值会接近甚至超过 1。
    /// 只用「航向变化」不行 —— 暂停时相邻点几乎重合，方位角是噪声。
    fn spur_ratio(pts: &[TrackPoint], i: usize) -> Option<f64> {
        let a = (pts[i - 1].lat, pts[i - 1].lon);
        let b = (pts[i].lat, pts[i].lon);
        let c = (pts[i + 1].lat, pts[i + 1].lon);

        let chord = geo::hav(a.0, a.1, c.0, c.1);
        if chord < 1.5 {
            return None; // 几乎静止，没有判别意义
        }
        // 平面近似下的点到直线距离
        let scale = (a.0.to_radians().cos()).max(0.2);
        let ax = a.1 * scale;
        let ay = a.0;
        let bx = b.1 * scale;
        let by = b.0;
        let cx = c.1 * scale;
        let cy = c.0;
        let dx = cx - ax;
        let dy = cy - ay;
        let len = (dx * dx + dy * dy).sqrt();
        if len <= 0.0 {
            return None;
        }
        let cross = ((bx - ax) * dy - (by - ay) * dx).abs() / len;
        // 把「度」换算成米量级比例（同一尺度下相除，单位约掉）
        Some(cross / (chord / 111_320.0))
    }

    fn worst_spur(pts: &[TrackPoint]) -> (usize, f64) {
        let mut worst = (0usize, 0.0f64);
        for i in 1..pts.len().saturating_sub(1) {
            if let Some(r) = spur_ratio(pts, i) {
                if r > worst.1 {
                    worst = (i, r);
                }
            }
        }
        worst
    }

    #[test]
    fn burrs_have_no_needle_spikes() {
        let fence = rect_fence();
        for seed in [0_i64, 7, 42, 555, 20240101] {
            let r = generate(&fence, &[], 345.0, 2000.0, 0.6, seed, 20.0, true).unwrap();
            let (idx, ratio) = worst_spur(&r.points);
            let g = r
                .points
                .windows(2)
                .map(|w| geo::hav(w[0].lat, w[0].lon, w[1].lat, w[1].lon))
                .fold(0.0f64, f64::max);
            println!(
                "seed={seed:>9}  最尖点 #{idx}  垂距/弦长 = {ratio:.2}  最大间距 {g:.2} m"
            );
            assert!(ratio < 0.9, "seed={seed} 第 {idx} 点出现针状突起（{ratio:.2}）");
        }
    }
}
