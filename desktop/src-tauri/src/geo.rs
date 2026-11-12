//! 球面几何。全部在 GCJ02 经纬度上做近似运算 —— 服务端与区域多边形都用 gcj02，
//! 保持一致即可完全避开坐标系转换带来的偏移。

pub const R_EARTH: f64 = 6_371_008.8;

/// 两点球面距离（米）。
pub fn hav(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let p1 = lat1.to_radians();
    let p2 = lat2.to_radians();
    let dp = p2 - p1;
    let dl = (lon2 - lon1).to_radians();
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * R_EARTH * a.sqrt().min(1.0).asin()
}

/// a → b 的初始方位角，0..360。
pub fn bearing(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let p1 = lat1.to_radians();
    let p2 = lat2.to_radians();
    let dl = (lon2 - lon1).to_radians();
    let x = dl.sin() * p2.cos();
    let y = p1.cos() * p2.sin() - p1.sin() * p2.cos() * dl.cos();
    (x.atan2(y).to_degrees() + 360.0) % 360.0
}

/// 从 (lat, lon) 沿方位角 brg_deg 走 dist 米。
pub fn offset(lat: f64, lon: f64, dist: f64, brg_deg: f64) -> (f64, f64) {
    let p1 = lat.to_radians();
    let l1 = lon.to_radians();
    let brg = brg_deg.to_radians();
    let d = dist / R_EARTH;
    let p2 = (p1.sin() * d.cos() + p1.cos() * d.sin() * brg.cos()).asin();
    let l2 = l1 + (brg.sin() * d.sin() * p1.cos()).atan2(d.cos() - p1.sin() * p2.sin());
    (p2.to_degrees(), l2.to_degrees())
}

/// 射线法判定点是否在多边形内。poly 元素为 (lat, lon)。
/// 与小程序 IsPtInPoly 的判据保持一致。
pub fn point_in_poly(lat: f64, lon: f64, poly: &[(f64, f64)]) -> bool {
    let n = poly.len();
    if n < 3 {
        return false;
    }
    let mut inside = false;
    for i in 0..n {
        let (la, lo) = poly[i];
        let (lb, lob) = if i == n - 1 { poly[0] } else { poly[i + 1] };
        if (lat >= la && lat < lb) || (lat >= lb && lat < la) {
            if (la - lb).abs() > 0.0 {
                if lo - (lo - lob) * (la - lat) / (la - lb) < lon {
                    inside = !inside;
                }
            }
        }
    }
    inside
}

/// 多边形质心（顶点算术平均）。
pub fn centroid(poly: &[(f64, f64)]) -> (f64, f64) {
    let n = poly.len().max(1) as f64;
    let mut la = 0.0;
    let mut lo = 0.0;
    for (a, b) in poly {
        la += a;
        lo += b;
    }
    (la / n, lo / n)
}
