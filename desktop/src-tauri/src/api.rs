//! 重邮智慧体育 API 客户端（Rust 移植）。
//!
//! 协议逆向自小程序 wx13b7520eb7351f4f：无签名、无加密，全部明文 JSON，
//! 认证只靠请求头 `token`。

use serde_json::{json, Value};

pub const BASE: &str = "https://sport.cqupt.edu.cn/new_wxapp";
/// 与小程序 globalData.pointCount 一致
pub const POINT_BATCH: usize = 8;

fn http_error(code: u16, text: &str) -> String {
    if code == 403 && text.to_ascii_lowercase().contains("waf") {
        return "HTTP 403：请求被服务器安全防护拦截，服务端未确认操作".into();
    }
    let trimmed = text.trim_start();
    if trimmed.to_ascii_lowercase().starts_with("<!doctype html") || trimmed.to_ascii_lowercase().starts_with("<html") {
        format!("HTTP {}：服务器返回了网页错误响应", code)
    } else {
        format!("HTTP {}: {}", code, truncate(text))
    }
}

#[cfg(test)]
mod http_error_tests {
    use super::http_error;

    #[test]
    fn summarizes_waf_html_without_claiming_success() {
        let message = http_error(403, "<!DOCTYPE html><title>waf拦截</title>");
        assert!(message.contains("403"));
        assert!(message.contains("拦截"));
        assert!(!message.contains("<!DOCTYPE"));
    }
}

fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// 业务响应包装：code == 10200 视为成功。
#[derive(Clone, Debug)]
pub struct Resp {
    pub ok: bool,
    pub code: String,
    pub msg: String,
    pub data: Value,
}

impl Resp {
    pub fn of(v: Option<&Value>) -> Resp {
        let Some(v) = v else {
            return Resp {
                ok: false,
                code: "-1".into(),
                msg: "网络异常".into(),
                data: Value::Null,
            };
        };
        let code = v
            .get("code")
            .map(|c| match c {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_else(|| "?".into());
        Resp {
            ok: code == "10200",
            code,
            msg: v
                .get("msg")
                .and_then(|m| m.as_str())
                .unwrap_or("")
                .to_string(),
            data: v.get("data").cloned().unwrap_or(Value::Null),
        }
    }

    pub fn num(&self, key: &str) -> Option<f64> {
        self.data.get(key).and_then(|v| match v {
            Value::Number(n) => n.as_f64(),
            Value::String(s) => s.trim().parse::<f64>().ok(),
            _ => None,
        })
    }

    #[allow(dead_code)]
    pub fn text(&self, key: &str) -> String {
        self.data
            .get(key)
            .map(|v| match v {
                Value::String(s) => s.clone(),
                other => other.to_string(),
            })
            .unwrap_or_default()
    }
}

pub struct Api {
    pub token: String,
    pub last_error: String,
    pub trace: Vec<String>,
}

impl Default for Api {
    fn default() -> Self {
        Self::new()
    }
}

impl Api {
    pub fn new() -> Self {
        Self {
            token: String::new(),
            last_error: String::new(),
            trace: Vec::new(),
        }
    }

    pub fn reset(&mut self, openid: &str) {
        self.token.clear();
        self.trace.clear();
        self.trace.push(format!("=== 新会话 openid={} ===", mask(openid)));
    }

    fn call(
        &mut self,
        method: &str,
        url: &str,
        body: Option<&str>,
        use_token: bool,
    ) -> Option<Value> {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(std::time::Duration::from_secs(20))
            .timeout_read(std::time::Duration::from_secs(30))
            .build();

        let mut req = match method {
            "POST" => agent.post(url),
            _ => agent.get(url),
        }
        .set("Content-Type", "application/json; charset=utf-8")
        .set("User-Agent", "Mozilla/5.0 MicroMessenger");

        if use_token && !self.token.is_empty() {
            req = req.set("token", &self.token);
        }

        let result = if let Some(b) = body {
            req.send_string(b)
        } else {
            req.call()
        };

        match result {
            Ok(resp) => {
                let text = resp.into_string().unwrap_or_default();
                self.trace.push(format!(
                    "{} {}  body={}  → {} {}",
                    method,
                    url,
                    body.map(truncate).unwrap_or_else(|| "-".into()),
                    200,
                    truncate(&text)
                ));
                serde_json::from_str(&text).ok().or_else(|| {
                    self.last_error = "响应不是合法 JSON".into();
                    None
                })
            }
            Err(ureq::Error::Status(code, resp)) => {
                let text = resp.into_string().unwrap_or_default();
                self.last_error = http_error(code, &text);
                self.trace
                    .push(format!("{} {}  → {}", method, url, self.last_error));
                None
            }
            Err(e) => {
                self.last_error = format!("{}", e);
                self.trace
                    .push(format!("{} {}  → 异常 {}", method, url, self.last_error));
                None
            }
        }
    }

    fn get(&mut self, path: &str, params: &[(&str, &str)], use_token: bool) -> Option<Value> {
        let qs: Vec<String> = params
            .iter()
            .filter(|(_, v)| !v.is_empty())
            .map(|(k, v)| format!("{}={}", enc(k), enc(v)))
            .collect();
        let url = if qs.is_empty() {
            format!("{}{}", BASE, path)
        } else {
            format!("{}{}{}{}", BASE, path, if path.contains('?') { "&" } else { "?" }, qs.join("&"))
        };
        self.call("GET", &url, None, use_token)
    }

    fn post(&mut self, path: &str, body: Option<&str>, use_token: bool) -> Option<Value> {
        self.call("POST", &format!("{}{}", BASE, path), body, use_token)
    }

    // ---------------------------------------------------------- 业务

    /// wxCode 留空即可，只要有 openid。
    pub fn check_binding(&mut self, openid: &str) -> Option<Value> {
        self.get(
            "/wxUnifyId/checkBinding",
            &[("wxCode", ""), ("openid", openid), ("phoneType", "PC_Windows")],
            false,
        )
    }

    pub fn get_rule(&mut self) -> Option<Value> {
        self.get("/setting/getRule", &[], true)
    }

    pub fn get_playground(&mut self) -> Option<Value> {
        self.get("/place/getPlayground", &[], true)
    }

    /// 真正的多边形在 /area/getAllArea。
    pub fn get_all_area(&mut self) -> Option<Value> {
        self.get("/area/getAllArea", &[], true)
    }

    pub fn get_sports_result(&mut self) -> Option<Value> {
        self.get("/sportsResult/list", &[], true)
    }

    #[allow(dead_code)]
    pub fn get_record_page(&mut self, page: i32, size: i32) -> Option<Value> {
        self.get(
            &format!("/sportRecord/mobile/list/{}/{}", page, size),
            &[],
            true,
        )
    }

    pub fn get_record_info(&mut self, no: &str) -> Option<Value> {
        self.get(&format!("/sportRecord/info/{}", no), &[], true)
    }

    pub fn start_sport(&mut self, place_name: &str, place_code: &str) -> Option<Value> {
        let body = json!({
            "placeName": place_name,
            "placeCode": place_code
        })
        .to_string();
        self.post("/sportRecord/sport/start2", Some(&body), true)
    }

    pub fn upload_points(&mut self, record_no: &str, points: &[Value]) -> Option<Value> {
        let body = json!({
            "sportRecordNo": record_no,
            "sportPointList": points
        })
        .to_string();
        self.post("/sportRecord/point/saveListByNo", Some(&body), true)
    }

    pub fn end_sport(&mut self, record_no: &str) -> Option<Value> {
        self.post(&format!("/sportRecord/sport/end/{}", record_no), None, true)
    }
}

pub fn mask(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= 8 {
        return "***".into();
    }
    let head: String = chars[..4].iter().collect();
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("{}****{}", head, tail)
}

pub fn truncate(s: &str) -> String {
    let n = 300;
    let chars: Vec<char> = s.chars().collect();
    if chars.len() <= n {
        return s.to_string();
    }
    let head: String = chars[..n].iter().collect();
    format!("{}...({}B)", head, s.len())
}
