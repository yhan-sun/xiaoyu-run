import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ============================================================ 类型

interface Area {
  placeName: string;
  placeCode: string;
  fenceVertices: number;
  banCount: number;
}

interface Rule {
  minPace: number;
  maxPace: number;
  raceMile: number;
}

interface ConnectResult {
  ok: boolean;
  message: string;
  tokenMasked: string;
  rule: Rule | null;
  areas: Area[];
  logs: string[];
}

interface PreviewResult {
  ok: boolean;
  message: string;
  fence: [number, number][];
  points: [number, number][];
  paceSecKm: number;
  windowLo: number;
  windowHi: number;
  inWindow: boolean;
  count: number;
  adjusted: boolean;
  distanceM: number;
}

interface RunState {
  phase: string;
  pointsDone: number;
  pointsTotal: number;
  metersDone: number;
  metersTotal: number;
  elapsedSec: number;
  etaSec: number;
  paceSecKm: number;
  paceLo: number;
  paceHi: number;
  batchesDone: number;
  batchesTotal: number;
  serverMileage: number;
  serverSeconds: number;
  finished: boolean;
  failed: boolean;
}

interface StatRow {
  place: string;
  km: number;
  sec: number;
  duration: string;
  valid: boolean;
  reason: string;
}

interface Stats {
  total: number;
  validCount: number;
  invalidCount: number;
  totalKm: number;
  avgPaceSecKm: number;
  byPlace: [string, number][];
  rows: StatRow[];
}

interface Config {
  openid: string;
  pace: string;
  dist: string;
  noise: number;
  burrs: boolean;
  seed: number;
  placeCode: string;
  theme: string;
}

// ============================================================ DOM

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

const el = {
  statusDot: $("statusDot"),
  statusText: $("statusText"),
  pageTitle: $("pageTitle"),
  btnRefresh: $<HTMLButtonElement>("btnRefresh"),

  mDist: $("mDist"),
  mTotal: $("mTotal"),
  mPhase: $("mPhase"),
  mPaceHint: $("mPaceHint"),
  mPct: $("mPct"),
  mElapsed: $("mElapsed"),
  mEta: $("mEta"),
  mBatch: $("mBatch"),
  progressFill: $("progressFill"),
  canvasBadge: $("canvasBadge"),
  canvas: $<HTMLCanvasElement>("trackCanvas"),

  btnStart: $<HTMLButtonElement>("btnStart"),
  btnCancel: $<HTMLButtonElement>("btnCancel"),
  runWarn: $("runWarn"),
  runWarnText: $("runWarnText"),

  selPlace: $<HTMLSelectElement>("selPlace"),
  inPace: $<HTMLInputElement>("inPace"),
  inDist: $<HTMLInputElement>("inDist"),
  inNoise: $<HTMLInputElement>("inNoise"),
  noiseVal: $("noiseVal"),
  swBurrs: $<HTMLButtonElement>("swBurrs"),

  logBox: $("logBox"),

  sValid: $("sValid"),
  sInvalid: $("sInvalid"),
  sKm: $("sKm"),
  sPace: $("sPace"),
  sByPlace: $("sByPlace"),
  statsBody: $("statsBody"),

  inOpenid: $<HTMLInputElement>("inOpenid"),
  btnConnect: $<HTMLButtonElement>("btnConnect"),
  connectMsg: $("connectMsg"),

  themeSeg: $("themeSeg"),
  inSeed: $<HTMLInputElement>("inSeed"),
  verText: $("verText"),
  btnCopyRepo: $<HTMLButtonElement>("btnCopyRepo"),
  btnReset: $<HTMLButtonElement>("btnReset"),

  toastHost: $("toastHost"),
};

// ============================================================ 状态

const state = {
  config: null as Config | null,
  areas: [] as Area[],
  rule: null as Rule | null,
  preview: null as PreviewResult | null,
  running: false,
  logs: [] as string[],
  connected: false,
  progressFrac: 0,
};

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ============================================================ 工具

function fmtPace(sec: number): string {
  if (!sec || sec <= 0 || sec > 3600) return "--";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}'${String(s).padStart(2, "0")}"`;
}

function fmtDuration(sec: number): string {
  if (sec < 0) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function toast(msg: string, kind: "ok" | "bad" | "" = "") {
  const node = document.createElement("div");
  node.className = `toast ${kind}`;
  node.textContent = msg;
  el.toastHost.appendChild(node);
  window.setTimeout(() => {
    node.classList.add("out");
    window.setTimeout(() => node.remove(), 220);
  }, 2400);
}

function appendLog(line: string) {
  state.logs.push(line);
  if (state.logs.length > 400) state.logs.splice(0, state.logs.length - 400);
  renderLog();
}

function renderLog() {
  if (state.logs.length === 0) {
    el.logBox.innerHTML = '<span class="log-empty">尚未开始</span>';
    return;
  }
  el.logBox.textContent = state.logs.join("\n");
  el.logBox.scrollTop = el.logBox.scrollHeight;
}

function setStatus(text: string, kind: "" | "ok" | "busy" | "bad") {
  el.statusText.textContent = text;
  el.statusDot.className = `status-dot ${kind}`;
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!isTauri) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    toast(String(e), "bad");
    return null;
  }
}

// ============================================================ 画布

interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

function project(
  lat: number,
  lon: number,
  b: Bounds,
  w: number,
  h: number,
  pad: number
): [number, number] {
  const cos = Math.cos((((b.minLat + b.maxLat) / 2) * Math.PI) / 180);
  const spanLon = Math.max(1e-7, (b.maxLon - b.minLon) * cos);
  const spanLat = Math.max(1e-7, b.maxLat - b.minLat);
  const scale = Math.min((w - pad * 2) / spanLon, (h - pad * 2) / spanLat);
  const x = w / 2 + (lon - (b.minLon + b.maxLon) / 2) * cos * scale;
  const y = h / 2 - (lat - (b.minLat + b.maxLat) / 2) * scale;
  return [x, y];
}

function computeBounds(rings: [number, number][][]): Bounds | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  for (const ring of rings) {
    for (const [lat, lon] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
    }
  }
  if (!Number.isFinite(minLat)) return null;
  return { minLat, maxLat, minLon, maxLon };
}

function drawCanvas() {
  const canvas = el.canvas;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);

  const styles = getComputedStyle(document.documentElement);
  const accent = styles.getPropertyValue("--accent").trim() || "#0a84ff";
  const tertiary = styles.getPropertyValue("--text-tertiary").trim() || "#6a6e76";
  const success = styles.getPropertyValue("--success").trim() || "#30d158";

  const p = state.preview;
  const w = rect.width;
  const h = rect.height;

  if (!p || !p.ok || p.points.length < 2) {
    ctx.fillStyle = tertiary;
    ctx.font =
      '500 12px -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(
      p && p.message ? p.message : "同步场地后即可生成真实轨迹",
      w / 2,
      h / 2
    );
    return;
  }

  const bounds = computeBounds([p.fence, p.points]);
  if (!bounds) return;
  const pad = 26;

  // 围栏
  if (p.fence.length >= 3) {
    ctx.beginPath();
    p.fence.forEach(([lat, lon], i) => {
      const [x, y] = project(lat, lon, bounds, w, h, pad);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(255,255,255,0.022)";
    ctx.fill();
    ctx.strokeStyle = tertiary;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  // 轨迹
  ctx.beginPath();
  p.points.forEach(([lat, lon], i) => {
    const [x, y] = project(lat, lon, bounds, w, h, pad);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.7;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.92;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // 起终点
  const start = p.points[0];
  const [sx, sy] = project(start[0], start[1], bounds, w, h, pad);
  ctx.beginPath();
  ctx.arc(sx, sy, 3, 0, Math.PI * 2);
  ctx.fillStyle = success;
  ctx.fill();

  // 跑动中的当前位置
  if (state.running && state.progressFrac > 0) {
    const idx = Math.min(
      p.points.length - 1,
      Math.floor(state.progressFrac * (p.points.length - 1))
    );
    const [px, py] = project(
      p.points[idx][0],
      p.points[idx][1],
      bounds,
      w,
      h,
      pad
    );
    ctx.beginPath();
    ctx.arc(px, py, 10, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.globalAlpha = 0.16;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(px, py, 4, 0, Math.PI * 2);
    ctx.fillStyle = accent;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, 1.6, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }
}

// ============================================================ 渲染

function renderDashboard(s: Partial<RunState>) {
  const total = s.metersTotal ?? 0;
  const done = s.metersDone ?? 0;
  const frac = total > 0 ? Math.min(1, done / total) : 0;

  el.mDist.textContent = (done / 1000).toFixed(2);
  el.mTotal.textContent = `/ ${(total / 1000).toFixed(2)}`;
  el.mPct.textContent = `${Math.round(frac * 100)}%`;
  el.progressFill.style.width = `${frac * 100}%`;
  el.mElapsed.textContent = fmtDuration(s.elapsedSec ?? 0);
  el.mEta.textContent =
    (s.etaSec ?? -1) >= 0 ? fmtDuration(s.etaSec ?? 0) : "--:--";
  el.mBatch.textContent = `${s.batchesDone ?? 0} / ${s.batchesTotal ?? 0}`;
  el.mPhase.textContent = s.phase ?? "待命";

  const pace = s.paceSecKm ?? 0;
  el.mPaceHint.textContent = pace > 0 ? `${fmtPace(pace)}/km` : "—";

  state.progressFrac = frac;
  el.progressFill.classList.toggle("done", !!s.finished);
  el.progressFill.classList.toggle("failed", !!s.failed);
}

function renderPreviewBadge() {
  const p = state.preview;
  if (!p || !p.ok) {
    el.canvasBadge.textContent = "未生成轨迹";
    return;
  }
  const warn = p.inWindow ? "" : " · 超窗";
  el.canvasBadge.textContent = `${p.count} 点 · 实测 ${fmtPace(
    p.paceSecKm
  )}${warn}`;
}

function renderPlaceOptions() {
  const sel = el.selPlace;
  sel.innerHTML = "";
  if (state.areas.length === 0) {
    const opt = document.createElement("option");
    opt.value = "__demo__";
    opt.textContent = "示例场地（离线预览）";
    sel.appendChild(opt);
    sel.value = "__demo__";
    return;
  }
  for (const a of state.areas) {
    const opt = document.createElement("option");
    opt.value = a.placeCode;
    opt.textContent = a.placeName;
    sel.appendChild(opt);
  }
  const saved = state.config?.placeCode ?? "";
  if (saved && state.areas.some((a) => a.placeCode === saved)) {
    sel.value = saved;
  }
}

function renderStats(st: Stats) {
  el.sValid.textContent = String(st.validCount);
  el.sInvalid.textContent = String(st.invalidCount);
  el.sKm.textContent = st.totalKm.toFixed(2);
  el.sPace.textContent = fmtPace(st.avgPaceSecKm);

  if (st.byPlace.length === 0) {
    el.sByPlace.innerHTML = '<div class="tiny">暂无数据</div>';
  } else {
    el.sByPlace.innerHTML = st.byPlace
      .map(
        ([name, n]) => `
        <div class="list-row" style="padding: 9px 0">
          <div class="list-main"><div class="list-title">${escapeHtml(name)}</div></div>
          <div class="metric-val sm">${n} 次</div>
        </div>`
      )
      .join("");
  }

  if (st.rows.length === 0) {
    el.statsBody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-tertiary);padding:28px">暂无记录</td></tr>`;
    return;
  }

  el.statsBody.innerHTML = st.rows
    .slice(0, 60)
    .map((r) => {
      const pace = r.km > 0 ? fmtPace(r.sec / r.km) : "--";
      const tag = r.valid
        ? '<span class="tag tag-ok">有效</span>'
        : `<span class="tag tag-bad">${escapeHtml(r.reason || "无效")}</span>`;
      return `<tr>
        <td>${escapeHtml(r.place)}</td>
        <td>${r.km.toFixed(2)} km</td>
        <td>${r.duration}</td>
        <td>${pace}/km</td>
        <td>${tag}</td>
      </tr>`;
    })
    .join("");
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c as "&"])
  );
}

// ============================================================ 参数

function currentParams() {
  return {
    placeCode: el.selPlace.value,
    pace: el.inPace.value.trim(),
    dist: el.inDist.value.trim(),
    noise: Number(el.inNoise.value),
    burrs: el.swBurrs.getAttribute("aria-checked") === "true",
    seed: Number(el.inSeed.value) || 0,
  };
}

function setRunningUi(running: boolean) {
  state.running = running;
  el.btnStart.disabled = running;
  el.btnStart.classList.toggle("hide", running);
  el.btnCancel.classList.toggle("hide", !running);
  el.selPlace.disabled = running;
  el.inPace.disabled = running;
  el.inDist.disabled = running;
  el.inNoise.disabled = running;
  el.swBurrs.disabled = running;
  if (running) setStatus("打卡中", "busy");
}

let previewTimer = 0;
function schedulePreview(immediate = false) {
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(runPreview, immediate ? 0 : 220);
}

async function runPreview() {
  const prm = currentParams();
  if (!prm.placeCode) {
    state.preview = null;
    el.canvasBadge.textContent = "未生成轨迹";
    drawCanvas();
    return;
  }
  const res = await call<PreviewResult>("preview", {
    placeCode: prm.placeCode,
    pace: prm.pace,
    dist: prm.dist,
    noise: prm.noise,
    burrs: prm.burrs,
    seed: prm.seed,
  });
  if (!res) return;
  state.preview = res;
  if (!res.ok) {
    el.canvasBadge.textContent = res.message || "轨迹无效";
  } else {
    renderPreviewBadge();
    // 配速是否落在允许窗口
    if (!res.inWindow) {
      el.runWarn.style.display = "flex";
      el.runWarnText.textContent = `实测配速 ${fmtPace(
        res.paceSecKm
      )} 超出目标窗口 ${fmtPace(res.windowLo)} ~ ${fmtPace(res.windowHi)}，服务端可能判无效。`;
    } else {
      el.runWarn.style.display = "none";
    }
  }
  drawCanvas();
  if (probeCount < 6) {
    probeCount += 1;
    await sendProbe(performance.now());
  }
}

// ============================================================ 配置

let saveTimer = 0;
function persist() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    if (!state.config) return;
    const prm = currentParams();
    state.config = {
      ...state.config,
      openid: el.inOpenid.value.trim(),
      pace: prm.pace,
      dist: prm.dist,
      noise: prm.noise,
      burrs: prm.burrs,
      seed: prm.seed,
      placeCode: prm.placeCode,
    };
    await call("save_config", { config: state.config });
  }, 400);
}

function applyTheme(mode: string) {
  const html = document.documentElement;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = mode === "dark" || (mode === "system" && prefersDark);
  html.setAttribute("data-theme", dark ? "dark" : "light");
  for (const b of el.themeSeg.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.themeVal === mode);
  }
  if (state.config) state.config.theme = mode;
  drawCanvas();
}

// ============================================================ 动作

async function doConnect() {
  const openid = el.inOpenid.value.trim();
  if (!openid) {
    toast("请先填入 OpenID", "bad");
    return;
  }
  el.btnConnect.disabled = true;
  el.btnConnect.textContent = "同步中 …";
  setStatus("同步中", "busy");

  const res = await call<ConnectResult>("connect", { openid });
  el.btnConnect.disabled = false;
  el.btnConnect.textContent = "保存并同步场地";

  if (!res) {
    setStatus("未连接", "");
    return;
  }

  for (const line of res.logs) appendLog(line);

  if (!res.ok) {
    el.connectMsg.textContent = res.message;
    el.connectMsg.style.color = "var(--danger)";
    setStatus("连接失败", "bad");
    toast(res.message, "bad");
    return;
  }

  state.areas = res.areas;
  state.rule = res.rule;
  state.connected = true;
  el.connectMsg.textContent = `${res.message} · token ${res.tokenMasked}`;
  el.connectMsg.style.color = "var(--success)";
  setStatus(`已连接 ${state.areas.length} 个场地`, "ok");
  renderPlaceOptions();
  persist();
  schedulePreview(true);

  if (res.rule) {
    const suggest = (res.rule.minPace + res.rule.maxPace) / 2;
    el.inPace.value = fmtPace(suggest).replace(/["]/g, "").replace("'", ":");
    el.inDist.value = (res.rule.raceMile / 1000).toFixed(1);
  }
  toast("场地已同步", "ok");
}

async function doStart() {
  const prm = currentParams();
  if (!prm.placeCode || prm.placeCode === "__demo__") {
    toast("示例场地只能预览，请先在「指南」页同步真实场地", "bad");
    return;
  }
  if (!el.inOpenid.value.trim()) {
    toast("请先在「指南」页填入 OpenID", "bad");
    return;
  }
  state.logs = [];
  renderLog();
  setRunningUi(true);
  appendLog("开始打卡 …");

  const res = await call<boolean>("start_run", {
    req: {
      openid: el.inOpenid.value.trim(),
      placeCode: prm.placeCode,
      pace: prm.pace,
      dist: prm.dist,
      noise: prm.noise,
      burrs: prm.burrs,
      seed: prm.seed,
    },
  });

  if (!res) {
    setRunningUi(false);
    setStatus("启动失败", "bad");
  }
}

async function doCancel() {
  await call<boolean>("cancel_run");
  appendLog("请求取消 …");
}

async function doStats() {
  const openid = el.inOpenid.value.trim();
  if (!openid) {
    toast("请先在「指南」页填入 OpenID", "bad");
    return;
  }
  el.btnRefresh.disabled = true;
  const st = await call<Stats>("get_stats", { openid });
  el.btnRefresh.disabled = false;
  if (!st) return;
  renderStats(st);
  toast("成绩已刷新", "ok");
}


// ============================================================ 启动自检

interface Probe {
  ok: boolean;
  viewport: { w: number; h: number; dpr: number };
  theme: string;
  sidebarWidth: number;
  sidebarBg: string;
  contentBg: string;
  font: string;
  navItems: number;
  pages: number;
  activePage: string;
  canvas: { w: number; h: number };
  heroFontSize: string;
  primaryBtnBg: string;
  tauri: boolean;
  errors: string[];
  badge: string;
  preview: { ok: boolean; count: number; pace: number; inWindow: boolean; distanceM: number } | null;
  ms: number;
}

const jsErrors: string[] = [];
let probeCount = 0;
window.addEventListener("error", (e) => {
  jsErrors.push(`${e.message} @ ${e.filename}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  jsErrors.push(`unhandledrejection: ${String(e.reason)}`);
});

async function sendProbe(t0: number) {
  const cs = getComputedStyle(document.documentElement);
  const side = document.querySelector(".sidebar") as HTMLElement | null;
  const canvas = el.canvas.getBoundingClientRect();
  const btn = el.btnStart;
  const probe: Probe = {
    ok: jsErrors.length === 0,
    viewport: {
      w: window.innerWidth,
      h: window.innerHeight,
      dpr: window.devicePixelRatio,
    },
    theme: document.documentElement.getAttribute("data-theme") ?? "?",
    sidebarWidth: side ? Math.round(side.getBoundingClientRect().width) : 0,
    sidebarBg: cs.getPropertyValue("--bg-sunken").trim(),
    contentBg: cs.getPropertyValue("--bg").trim(),
    font: cs.getPropertyValue("--font").trim().slice(0, 40),
    navItems: document.querySelectorAll(".nav-item").length,
    pages: document.querySelectorAll(".page").length,
    activePage: document.querySelector(".page.active")?.id ?? "none",
    canvas: { w: Math.round(canvas.width), h: Math.round(canvas.height) },
    heroFontSize: getComputedStyle(el.mDist).fontSize,
    primaryBtnBg: getComputedStyle(btn).backgroundColor,
    tauri: isTauri,
    errors: jsErrors,
    badge: el.canvasBadge.textContent ?? "",
    preview: state.preview
      ? {
          ok: state.preview.ok,
          count: state.preview.count,
          pace: Math.round(state.preview.paceSecKm * 10) / 10,
          inWindow: state.preview.inWindow,
          distanceM: Math.round(state.preview.distanceM),
        }
      : null,
    ms: Math.round(performance.now() - t0),
  };
  await call("ui_probe", { info: probe });
}

// ============================================================ 初始化

function switchPage(name: string) {
  document.querySelectorAll<HTMLElement>(".page").forEach((p) => {
    p.classList.toggle("active", p.id === `page-${name}`);
  });
  document.querySelectorAll<HTMLElement>(".nav-item").forEach((n) => {
    n.classList.toggle("active", n.dataset.page === name);
  });
  const titles: Record<string, string> = {
    run: "运动",
    stats: "成绩",
    guide: "指南",
    settings: "设置",
  };
  el.pageTitle.textContent = titles[name] ?? "小雨run";
  el.btnRefresh.classList.toggle("hide", name !== "stats");
  if (name === "run") drawCanvas();
}

async function init() {
  // 导航
  document.querySelectorAll<HTMLElement>(".nav-item").forEach((n) => {
    n.addEventListener("click", () => switchPage(n.dataset.page ?? "run"));
  });

  // 主题
  el.themeSeg.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      applyTheme(b.dataset.themeVal ?? "system");
      persist();
    });
  });
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if ((state.config?.theme ?? "system") === "system") applyTheme("system");
    });

  // 参数交互
  el.inNoise.addEventListener("input", () => {
    el.noiseVal.textContent = Number(el.inNoise.value).toFixed(2);
    schedulePreview();
    persist();
  });
  el.swBurrs.addEventListener("click", () => {
    const on = el.swBurrs.getAttribute("aria-checked") === "true";
    el.swBurrs.setAttribute("aria-checked", String(!on));
    schedulePreview();
    persist();
  });
  [el.inPace, el.inDist, el.inSeed].forEach((i) => {
    i.addEventListener("input", () => {
      schedulePreview();
      persist();
    });
  });
  el.selPlace.addEventListener("change", () => {
    schedulePreview(true);
    persist();
  });

  // 按钮
  el.btnStart.addEventListener("click", doStart);
  el.btnCancel.addEventListener("click", doCancel);
  el.btnConnect.addEventListener("click", doConnect);
  el.btnRefresh.addEventListener("click", doStats);
  el.btnCopyRepo.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText("https://github.com/yhan-sun/xiaoyu-run");
      toast("链接已复制", "ok");
    } catch {
      toast("复制失败", "bad");
    }
  });
  el.btnReset.addEventListener("click", async () => {
    if (!state.config) return;
    state.config = {
      openid: "",
      pace: "5:45",
      dist: "2.0",
      noise: 0.6,
      burrs: true,
      seed: 0,
      placeCode: "",
      theme: state.config.theme,
    };
    el.inOpenid.value = "";
    el.inPace.value = "5:45";
    el.inDist.value = "2.0";
    el.inNoise.value = "0.6";
    el.noiseVal.textContent = "0.60";
    el.inSeed.value = "0";
    el.swBurrs.setAttribute("aria-checked", "true");
    state.areas = [];
    state.preview = null;
    renderPlaceOptions();
    drawCanvas();
    await call("save_config", { config: state.config });
    toast("已清空本地配置", "ok");
  });

  window.addEventListener("resize", drawCanvas);

  // 读取配置
  const cfg = await call<Config>("load_config");
  state.config = cfg ?? {
    openid: "",
    pace: "5:45",
    dist: "2.0",
    noise: 0.6,
    burrs: true,
    seed: 0,
    placeCode: "",
    theme: "system",
  };

  el.inOpenid.value = state.config.openid ?? "";
  el.inPace.value = state.config.pace ?? "5:45";
  el.inDist.value = state.config.dist ?? "2.0";
  el.inNoise.value = String(state.config.noise ?? 0.6);
  el.noiseVal.textContent = Number(state.config.noise ?? 0.6).toFixed(2);
  el.inSeed.value = String(state.config.seed ?? 0);
  el.swBurrs.setAttribute("aria-checked", String(state.config.burrs ?? true));

  applyTheme(state.config.theme ?? "system");

  const ver = await call<string>("app_version");
  if (ver) el.verText.textContent = `v${ver}`;

  renderPlaceOptions();
  drawCanvas();
  // 首次进入就渲染一版轨迹（未同步场地时走内置示例跑道）
  schedulePreview(true);

  // 事件
  if (isTauri) {
    await listen<RunState>("run-state", (e) => {
      renderDashboard(e.payload);
      drawCanvas();
      if (e.payload.finished) {
        setRunningUi(false);
        setStatus("已完成", "ok");
        toast("打卡完成", "ok");
        runPreview();
      } else if (e.payload.failed) {
        setRunningUi(false);
        setStatus("已中断", "bad");
      } else {
        setRunningUi(true);
      }
    });

    await listen<string>("run-log", (e) => {
      appendLog(e.payload);
    });
  }

  // 已有 openid 时静默同步场地
  if (state.config.openid) {
    setStatus("已保存身份，同步场地中", "busy");
    const res = await call<ConnectResult>("connect", {
      openid: state.config.openid,
    });
    if (res?.ok) {
      state.areas = res.areas;
      state.rule = res.rule;
      state.connected = true;
      renderPlaceOptions();
      setStatus(`已连接 ${state.areas.length} 个场地`, "ok");
      schedulePreview(true);
    } else {
      setStatus("未连接", "");
    }
  }

  switchPage("run");

  // 等一帧让布局稳定后再回传度量
  window.setTimeout(() => sendProbe(performance.now()), 400);
}

window.addEventListener("DOMContentLoaded", init);
