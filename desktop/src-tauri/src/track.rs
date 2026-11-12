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
    let i = lo.min(n.saturating_sub(2));
    let seg = cum[i + 1] - cum[i];
    let t = if seg <= 0.0 { 0.0 } else { (d - cum[i]) / seg };
    let a = dense[i];
    let b = dense[i + 1];
    (
        (a.0 + (b.0 - a.0) * t, a.1 + (b.1 - a.1) * t),
        geo::bearing(a.0, a.1, b.0, b.1),
    )
}

// ------------------------------------------------------------------ 毛刺 / 突起

/// 稀疏野点：模拟真实 GPS 在多径、树荫、贴楼时突然"跳一下"。
fn make_spurs(n: usize, seed: i64, intensity: f64) -> Spurs {
    let mut lateral = vec![0.0; n];
    let mut forward = vec![0.0; n];
    if n < 80 {
        return Spurs { lateral, forward };
    }

    let mut rnd = Rng::new(seed.wrapping_mul(1_000_003).wrapping_add(77));
    let mut used: Vec<i32> = Vec::new();
    let free = |used: &Vec<i32>, at: i32, gap: i32| -> bool {
        !used.iter().any(|u| (u - at).abs() < gap)
    };

    let lo = ((n as f64 * 0.04) as i32).max(2);
    let hi = ((n as f64 * 0.96) as i32).min(n as i32 - 4);
    if hi <= lo {
        return Spurs { lateral, forward };
    }

    // 大跳：先占位，免得被密集的小毛刺挤掉
    for _ in 0..(n / 450).max(1) {
        let mut tries = 0;
        while tries < 60 {
            tries += 1;
            let at = rnd.range(lo, hi);
            if !free(&used, at, 14) {
                continue;
            }
            used.push(at);
            let a = rnd.uniform(9.0, 16.0) * intensity * rnd.sign();
            lateral[at as usize] = a;
            forward[at as usize] = a * rnd.uniform(-0.25, 0.25);
            break;
        }
    }

    // 大绕行包：走成一个不对称的三角形
    for _ in 0..(n / 230).max(2) {
        let mut tries = 0;
        while tries < 80 {
            tries += 1;
            let at = rnd.range(lo, hi);
            let span = rnd.range(4, 10);
            if at + span >= n as i32 || !free(&used, at, span + 10) {
                continue;
            }
            used.push(at);
            let a = rnd.uniform(5.0, 11.0) * intensity * rnd.sign();
            let fwd_share = rnd.uniform(-0.25, 0.25);
            for k in 0..=span {
                let s = k as f64 / span as f64;
                let idx = (at + k) as usize;
                if idx < n {
                    lateral[idx] = a * (std::f64::consts::PI * s).sin();
                    forward[idx] = a * fwd_share * (2.0 * std::f64::consts::PI * s).sin();
                }
            }
            break;
        }
    }

    // 硬毛刺：一秒尖刺 / 两秒来回 / 两三秒的小三角
    for _ in 0..(n / 75).max(4) {
        let mut tries = 0;
        while tries < 80 {
            tries += 1;
            let at = rnd.range(lo, hi);
            if !free(&used, at, 8) {
                continue;
            }
            used.push(at);
            let a = rnd.uniform(3.0, 8.0) * intensity;
            let sign = rnd.sign();
            let share = rnd.uniform(-0.35, 0.35);
            let shape = rnd.next_f64();
            let idx = at as usize;
            if shape < 0.45 {
                lateral[idx] = a * sign;
                forward[idx] = a * share;
            } else if shape < 0.72 {
                lateral[idx] = a * sign;
                forward[idx] = a * share;
                if idx + 1 < n {
                    lateral[idx + 1] = if rnd.boolean() {
                        -a * 0.55 * sign
                    } else {
                        a * 0.3 * sign
                    };
                }
            } else {
                let span = rnd.range(2, 5);
                let peak = rnd.range(1, span);
                for k in 0..=span {
                    let denom = if k <= peak { peak } else { span - peak }.max(1) as f64;
                    let frac = (1.0 - (k - peak).abs() as f64 / denom).max(0.0);
                    let j = (at + k) as usize;
                    if j < n {
                        lateral[j] = a * 1.2 * sign * frac;
                    }
                }
            }
            break;
        }
    }

    // 小毛刺：频率高、幅度小，负责把线边揉毛
    for _ in 0..(n / 17).max(6) {
        let mut tries = 0;
        while tries < 60 {
            tries += 1;
            if n < 5 {
                break;
            }
            let at = rnd.range(2, n as i32 - 2);
            if !free(&used, at, 4) {
                continue;
            }
            used.push(at);
            let a = rnd.uniform(0.8, 2.6) * intensity * rnd.sign();
            let idx = at as usize;
            lateral[idx] = a;
            forward[idx] = rnd.uniform(-0.5, 0.5) * a * 0.4;
            break;
        }
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
