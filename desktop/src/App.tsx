import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Card,
  Collapse,
  Dialog,
  Input,
  List,
  NavBar,
  Selector,
  Switch,
  TabBar,
  Tag,
  Toast,
} from "antd-mobile";
import { AnimatePresence, motion, useSpring } from "motion/react";
import TrackCanvas from "./TrackCanvas";
import { describeRunStatus } from "./run-status.mjs";
import {
  call,
  DEFAULT_CONFIG,
  fmtDuration,
  fmtPace,
  isTauri,
  on,
  openidHint,
  sanitizeOpenid,
} from "./api";
import type {
  Area,
  Config,
  ConnectResult,
  ExtractResult,
  PowerStatus,
  PreviewResult,
  Rule,
  RunState,
  Stats,
} from "./api";

type TabKey = "run" | "stats" | "guide" | "settings" | "extract";

const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// ---------------------------------------------------------------- 图标

const svg = (d: React.ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="22"
    height="22"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {d}
  </svg>
);

const IconRun = () => svg(<path d="M3 12h3.5l2.2-6 3.4 12 2.6-8 1.8 4H21" />);
const IconStats = () => svg(<path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />);
const IconGuide = () =>
  svg(
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z" />
      <path d="M8 7h7M8 11h5" />
    </>
  );
const IconSettings = () =>
  svg(
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  );
const IconQr = () =>
  svg(
    <>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.4" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.4" />
      <path d="M14 14h3v3h-3zM20.5 14v6.5H14" />
    </>
  );

// ---------------------------------------------------------------- 小组件

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="section-title">{children}</div>;
}

// ---------------------------------------------------------------- 主体

export default function App() {
  const [tab, setTab] = useState<TabKey>("run");
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [areas, setAreas] = useState<Area[]>([]);
  const [rule, setRule] = useState<Rule | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [power, setPower] = useState<PowerStatus | null>(null);
  const [extract, setExtract] = useState<ExtractResult | null>(null);
  const [connectBusy, setConnectBusy] = useState(false);
  const [statsBusy, setStatsBusy] = useState(false);
  const [extractBusy, setExtractBusy] = useState(false);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState("");
  const [statsError, setStatsError] = useState("");
  const [stopping, setStopping] = useState(false);
  const [starting, setStarting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanReady, setScanReady] = useState(false);
  const scanActive = useRef(false);
  const scanCancelled = useRef(false);
  const [openidText, setOpenidText] = useState("");
  const [version, setVersion] = useState("3.2.7");

  const loadedRef = useRef(false);
  const saveTimer = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const autoConnectStarted = useRef(false);
  const identityRevision = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [logOpen, setLogOpen] = useState(false);

  const running = !!run && !run.finished && !run.failed;

  // ---------- 里程数字弹簧 ----------
  const distSpring = useSpring(0, { stiffness: 150, damping: 24 });
  const [distText, setDistText] = useState("0.00");
  useEffect(() => {
    const un = distSpring.on("change", (v) => setDistText(v.toFixed(2)));
    return () => un();
  }, [distSpring]);
  useEffect(() => {
    distSpring.set((run?.metersDone ?? 0) / 1000);
  }, [run?.metersDone, distSpring]);

  const progress = useMemo(() => {
    const total = run?.metersTotal ?? 0;
    return total > 0 ? Math.min(1, (run?.metersDone ?? 0) / total) : 0;
  }, [run?.metersDone, run?.metersTotal]);

  // ---------- 日志 ----------
  const pushLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-260), line]);
  }, []);

  // ---------- 主题 ----------
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const mode = config.theme;
      const dark = mode === "dark" || (mode === "system" && mq.matches);
      document.documentElement.setAttribute(
        "data-prefers-color-scheme",
        dark ? "dark" : "light"
      );
    };
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [config.theme]);

  // ---------- 配置读写 ----------
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cfg = await call<Config>("load_config");
        if (cancelled) return;
        let merged = { ...DEFAULT_CONFIG, ...(cfg ?? {}) };
        try {
          const imported = await call<string | null>("take_imported_openid");
          if (cancelled) return;
          if (imported) {
            const clean = sanitizeOpenid(imported);
            if (clean !== merged.openid) {
              merged = { ...merged, openid: clean, placeCode: "", lastStats: null, lastStatsSyncAt: null };
            }
            Toast.show({ content: "已从电脑导入 OpenID" });
          }
        } catch {
          /* optional import is unavailable on some platforms */
        }
        loadedRef.current = true;
        setConfig(merged);
        setOpenidText(merged.openid);
        if (merged.lastStats) setStats(merged.lastStats);
        setConfigLoaded(true);
      } catch (e) {
        if (cancelled) return;
        setConfigError(String(e));
        Toast.show({ icon: "fail", content: `读取配置失败：${String(e)}` });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((patch: Partial<Config>) => {
    setConfig((c) => ({ ...c, ...patch }));
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.then(async () => {
        try {
          await call("save_config", { config });
        } catch (e) {
          Toast.show({ icon: "fail", content: `保存配置失败：${String(e)}` });
        }
      });
    }, 400);
  }, [config]);

  // ---------- 预览 ----------
  const previewTimer = useRef(0);
  const doPreview = useCallback(async () => {
    if (!config.placeCode) {
      setPreview(null);
      return;
    }
    try {
      const res = await call<PreviewResult>("preview", {
        placeCode: config.placeCode,
        pace: config.pace,
        dist: config.dist,
        noise: config.noise,
        burrs: config.burrs,
        seed: config.seed,
      });
      if (res) setPreview(res);
    } catch {
      /* 参数不合法时后端会返回空，忽略即可 */
    }
  }, [config.placeCode, config.pace, config.dist, config.noise, config.burrs, config.seed]);

  useEffect(() => {
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => void doPreview(), 220);
  }, [doPreview]);

  // ---------- 场地同步 ----------
  const connect = useCallback(
    async (openid: string, quiet = false) => {
      setConnectBusy(true);
      try {
        const res = await call<ConnectResult>("connect", { openid });
        if (!res) return;
        res.logs.forEach(pushLog);
        if (!res.ok) {
          Toast.show({ icon: "fail", content: res.message });
          return;
        }
        setAreas(res.areas);
        setRule(res.rule);
        setConfig((c) => res.areas.some((a) => a.placeCode === c.placeCode)
          ? c : { ...c, placeCode: res.areas[0]?.placeCode ?? "" });
        if (!quiet) Toast.show({ icon: "success", content: res.message });
      } catch (e) {
        Toast.show({ icon: "fail", content: String(e) });
      } finally {
        setConnectBusy(false);
      }
    },
    [pushLog]
  );

  // ---------- 启动流程 ----------
  useEffect(() => {
    if (!isTauri) return;
    void (async () => {
      try {
        const v = await call<string>("app_version");
        if (v) setVersion(v);
      } catch {
        /* ignore */
      }
      try {
        const p = await call<PowerStatus>("power_status");
        if (p) setPower(p);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  // 配置里已有 openid 时静默同步场地
  useEffect(() => {
    if (!configLoaded || autoConnectStarted.current) return;
    autoConnectStarted.current = true;
    if (config.openid.trim()) void connect(config.openid, true);
  }, [configLoaded, config.openid, connect]);

  // ---------- 运行事件 ----------
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void (async () => {
      const unState = await on<RunState>("run-state", (e) => {
        setRun(e.payload);
        if (e.payload.finished || e.payload.failed) setStopping(false);
        if (e.payload.finished) Toast.show({ icon: "success", content: e.payload.phase });
        if (e.payload.failed) Toast.show({ icon: "fail", content: e.payload.phase });
      });
      if (cancelled) { unState(); return; }
      const unLog = await on<string>("run-log", (e) => pushLog(e.payload));
      if (cancelled) { unState(); unLog(); return; }
      dispose = () => {
        unState();
        unLog();
      };
    })();
    return () => { cancelled = true; dispose?.(); };
  }, [pushLog]);

  // ---------- 动作 ----------
  const startRun = useCallback(async () => {
    if (starting) return;
    if (!configLoaded) {
      Toast.show({ content: "配置尚未读取，请重新打开应用" });
      return;
    }
    if (!config.placeCode || !areas.some((area) => area.placeCode === config.placeCode)) {
      Toast.show({ content: "请先同步并选择场地" });
      return;
    }
    if (!config.openid) {
      Toast.show({ content: "请先填入 OpenID" });
      return;
    }
    setLogs([]);
    setStarting(true);
    try {
      const ok = await call<boolean>("start_run", {
        req: {
          openid: config.openid,
          placeCode: config.placeCode,
          pace: config.pace,
          dist: config.dist,
          noise: config.noise,
          burrs: config.burrs,
          seed: config.seed,
          keepAwake: config.keepAwake,
        },
      });
      if (!ok) Toast.show({ content: "启动失败" });
    } catch (e) {
      Toast.show({ icon: "fail", content: String(e) });
    } finally {
      setStarting(false);
    }
  }, [config, areas, starting, configLoaded]);

  const cancelRun = useCallback(async () => {
    if (stopping) return;
    setStopping(true);
    try {
      await call("cancel_run");
      pushLog("已请求停止，等待当前操作完成并结算 …");
    } catch (e) {
      setStopping(false);
      Toast.show({ icon: "fail", content: `停止请求未发送：${String(e)}` });
    }
  }, [pushLog, stopping]);

  const loadStats = useCallback(async () => {
    if (!config.openid) {
      Toast.show({ content: "请先填入 OpenID" });
      return;
    }
    const revision = identityRevision.current;
    setStatsBusy(true);
    setStatsError("");
    try {
      const s = await call<Stats>("get_stats", { openid: config.openid });
      if (s && revision === identityRevision.current) {
        setStats(s);
        setConfig((c) => ({ ...c, lastStats: s, lastStatsSyncAt: new Date().toISOString() }));
      }
    } catch (e) {
      if (revision === identityRevision.current) {
        setStatsError("同步失败，请检查网络后重试。现有缓存仍保留。");
        Toast.show({ icon: "fail", content: String(e) });
      }
    } finally {
      setStatsBusy(false);
    }
  }, [config.openid]);

  const scanQr = useCallback(async () => {
    if (scanActive.current) return;
    scanActive.current = true;
    scanCancelled.current = false;
    try {
      const mod = await import("@tauri-apps/plugin-barcode-scanner");
      let permission = await mod.checkPermissions();
      if (permission !== "granted") permission = await mod.requestPermissions();
      if (permission !== "granted") {
        Toast.show({ icon: "fail", content: "没有相机权限，请在系统设置里允许" });
        return;
      }

      // windowed 模式的相机画面位于 WebView 下方，先让页面透明。
      document.documentElement.classList.add("scanner-active");
      setScanning(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const result = mod.scan({ windowed: true, formats: [mod.Format.QRCode] });
      setScanReady(true);
      const res = await result;
      const clean = sanitizeOpenid(res.content ?? "");
      if (!clean) {
        Toast.show({ content: "二维码里没有有效内容" });
        return;
      }
      setOpenidText(clean);
      Toast.show({ icon: "success", content: "已填入，请继续同步场地" });
    } catch (e) {
      if (scanCancelled.current) return;
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object" && e !== null
            ? (e as { message?: string; error?: string }).message ??
              (e as { error?: string }).error ??
              JSON.stringify(e)
            : String(e);
      Toast.show({ icon: "fail", content: `扫码失败：${msg}，也可以粘贴 OpenID` });
    } finally {
      document.documentElement.classList.remove("scanner-active");
      setScanning(false);
      setScanReady(false);
      scanActive.current = false;
    }
  }, []);

  const cancelScan = useCallback(async () => {
    try {
      const mod = await import("@tauri-apps/plugin-barcode-scanner");
      scanCancelled.current = true;
      await mod.cancel();
    } catch {
      scanCancelled.current = false;
      Toast.show({ icon: "fail", content: "退出扫码失败，请重试" });
    }
  }, []);

  const runExtract = useCallback(async () => {
    setExtractBusy(true);
    try {
      const res = await call<ExtractResult>("extract_openid");
      if (res) setExtract(res);
    } catch (e) {
      Toast.show({ icon: "fail", content: String(e) });
    } finally {
      setExtractBusy(false);
    }
  }, []);

  const goTo = useCallback((next: TabKey) => {
    setTab(next);
    bodyRef.current?.scrollTo({ top: 0 });
  }, []);

  const saveIdentity = useCallback(() => {
    if (running || starting || !configLoaded) return;
    const clean = sanitizeOpenid(openidText);
    setOpenidText(clean);
    if (!clean) {
      Toast.show({ content: "请先填入 OpenID" });
      return;
    }
    if (clean !== config.openid) {
      identityRevision.current += 1;
      setAreas([]);
      setRule(null);
      setPreview(null);
      setStats(null);
      setStatsError("");
      setConfig((c) => ({ ...c, openid: clean, placeCode: "", lastStats: null, lastStatsSyncAt: null }));
    }
    void connect(clean);
  }, [openidText, config.openid, connect, running, starting, configLoaded]);

  // 启动自检：把真实布局度量回传，用于没有截图权限时验证界面
  useEffect(() => {
    if (!isTauri) return;
    const t = window.setTimeout(() => {
      const bar = document.querySelector(".adm-tab-bar");
      const items = document.querySelectorAll(".adm-tab-bar-item");
      void call("ui_probe", {
        info: {
          ok: true,
          framework: "react + antd-mobile",
          tabbar: !!bar,
          tabItems: items.length,
          activeTab: tab,
          viewport: {
            w: window.innerWidth,
            h: window.innerHeight,
            dpr: window.devicePixelRatio,
          },
          theme:
            document.documentElement.getAttribute("data-prefers-color-scheme") ?? "?",
          cardRadius: getComputedStyle(
            document.querySelector(".adm-card") ?? document.body
          ).borderRadius,
          heroFont: document.querySelector(".hero-num")
            ? getComputedStyle(document.querySelector(".hero-num")!).fontSize
            : "n/a",
          canvas: (() => {
            const c = document.querySelector("canvas");
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height) };
          })(),
          buttons: Array.from(document.querySelectorAll("button")).map((b) => {
            const r = b.getBoundingClientRect();
            const cs = getComputedStyle(b);
            return {
              text: (b.textContent ?? "").trim().slice(0, 14),
              w: Math.round(r.width),
              h: Math.round(r.height),
              visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none",
              bg: cs.backgroundColor,
              color: cs.color,
            };
          }),
        },
      }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(t);
  }, [tab]);

  // ---------------------------------------------------------------- 页面

  const placeOptions = areas.map((a) => ({
    label: a.placeName,
    value: a.placeCode,
  }));
  const selectedArea = areas.find((a) => a.placeCode === config.placeCode);
  const ready = Boolean(config.openid.trim() && selectedArea);
  const settling = run?.phase === "结算中";
  const notice = describeRunStatus(run, stopping);
  const unconfirmed = notice?.needsReview ?? false;
  const lastSynced = config.lastStatsSyncAt && !Number.isNaN(Date.parse(config.lastStatsSyncAt))
    ? new Date(config.lastStatsSyncAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;
  const showLogs = () => {
    setLogOpen(true);
    requestAnimationFrame(() => logRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const pages: Record<TabKey, React.ReactNode> = {
    run: (
      <>
        {!run && !ready ? (
          <div className="welcome-card">
            <div className="eyebrow"><span className="status-dot" /> 开始之前</div>
            <div className="welcome-mark" aria-hidden="true"><IconRun /></div>
            <h1>{connectBusy ? "正在同步场地" : "准备好，轻松出发"}</h1>
            <p>{connectBusy ? "正在获取场地和规则，请稍候。" : "先完成身份配置并同步场地，之后就可以在这里查看运动进度。"}</p>
            <div className="setup-steps">
              <span className={config.openid.trim() ? "done" : ""}>1 <b>填写 OpenID</b></span>
              <span className={selectedArea ? "done" : ""}>2 <b>同步场地</b></span>
            </div>
            <Button block color="primary" size="large" disabled={!configLoaded} onClick={() => goTo("guide")}>
              {config.openid.trim() ? "查看配置与场地" : "开始配置"}
            </Button>
          </div>
        ) : (
        <>
        <Card className="hero-card">
          <div className="hero-topline"><span className="eyebrow"><span className="status-dot" />{selectedArea?.placeName || "运动记录"}</span><span>{run?.phase ?? "准备就绪"}</span></div>
          <div className="hero">
            <span className="hero-num">{distText}</span>
            <span className="hero-unit">km</span>
            <span className="hero-total">
              / {((run?.metersTotal ?? Number(config.dist) * 1000) / 1000).toFixed(2)}
            </span>
          </div>
          <div className="hero-sub">
            {(() => {
              const p = run?.paceSecKm || 0;
              return p > 0 ? `配速 ${fmtPace(p)}/km` : `目标配速 ${config.pace}/km`;
            })()}
          </div>

          <div className="progress">
            <motion.div
              className={"progress-fill" + (run?.finished ? " done" : run?.failed ? " bad" : "")}
              animate={{ width: `${progress * 100}%` }}
              transition={{ type: "spring", stiffness: 120, damping: 22 }}
            />
          </div>

          <div className="metrics">
            <Metric label="进度" value={`${Math.round(progress * 100)}%`} />
            <Metric label="用时" value={fmtDuration(run?.elapsedSec ?? 0)} />
            <Metric
              label="剩余"
              value={(run?.etaSec ?? -1) >= 0 ? fmtDuration(run?.etaSec ?? 0) : "--:--"}
            />
            <Metric
              label="批次"
              value={`${run?.batchesDone ?? 0}/${run?.batchesTotal ?? 0}`}
            />
          </div>

          {(preview?.ok || running) && <div className="track-wrap">
            <TrackCanvas preview={preview} running={running} progress={progress} />
          </div>}

          <div className="canvas-foot">
            <span>
              {preview?.ok
                ? `${preview.count} 点 · 实测 ${fmtPace(preview.paceSecKm)}`
                : "轨迹将在准备完成后显示"}
              {preview?.trackNote ? ` · ${preview.trackNote}` : ""}
            </span>
            {preview && preview.ok && !preview.inWindow && (
              <Tag color="warning" fill="outline">
                超出配速窗口
              </Tag>
            )}
          </div>
        </Card>

        {notice && (
          <div className={`run-notice ${notice.kind}`} role="status" aria-live="polite">
            <div className="notice-title">{notice.title}</div>
            <p>{notice.description}</p>
            {notice.showLogs && <button className="text-action" onClick={showLogs}>查看运行日志 →</button>}
            {unconfirmed && <button className="text-action" onClick={() => setRun(null)}>我已检查，返回待命</button>}
          </div>
        )}
        {!unconfirmed && <motion.div whileTap={{ scale: 0.98 }} className="primary-action">
          <Button
            block
            size="large"
            color={running ? "danger" : "primary"}
            disabled={settling || stopping || starting}
            onClick={() => void (running ? cancelRun() : startRun())}
          >
            {settling ? "正在结算…" : stopping ? "正在停止…" : starting ? "正在启动…" : running ? "停止并结算" : "开始打卡"}
          </Button>
        </motion.div>}
        </>)}

        {(ready || run) && <>
        <SectionTitle>参数</SectionTitle>
        <Card>
          {placeOptions.length === 0 ? (
            <div className="empty">
              还没有同步场地
              <Button size="small" color="primary" fill="outline" style={{ marginLeft: 10 }} onClick={() => goTo("guide")}>
                去同步
              </Button>
            </div>
          ) : (
            <Selector
              className="choice-selector place-selector"
              options={placeOptions}
              value={config.placeCode ? [config.placeCode] : []}
              onChange={(v) => update({ placeCode: v[0] ?? "" })}
              disabled={running}
              showCheckMark={false}
            />
          )}

          <div className="two-col">
            <label className="field">
              <span>配速</span>
              <div className="input-unit">
                <Input
                  value={config.pace}
                  onChange={(v) => update({ pace: v })}
                  placeholder="5:45"
                  disabled={running}
                />
                <span className="unit">/km</span>
              </div>
            </label>
            <label className="field">
              <span>距离</span>
              <div className="input-unit">
                <Input
                  value={config.dist}
                  onChange={(v) => update({ dist: v })}
                  placeholder="2.0"
                  disabled={running}
                />
                <span className="unit">km</span>
              </div>
            </label>
          </div>

          {rule && (
            <div className="rule-hint">
              规则：{fmtPace(rule.minPace)}–{fmtPace(rule.maxPace)}/km · 达标 {Math.round(rule.raceMile)} m
            </div>
          )}

          <details className="advanced">
            <summary>高级设置 <span>轨迹细节与随机种子</span></summary>
          <div className="field">
            <span>
              GPS 抖动 <em>{config.noise.toFixed(2)}</em>
            </span>
            <input
              className="jitter-slider"
              type="range"
              aria-label="GPS 抖动"
              aria-valuetext={config.noise.toFixed(2)}
              value={config.noise}
              min={0}
              max={3}
              step={0.05}
              onChange={(event) => update({ noise: Number(event.target.value) })}
              disabled={running}
            />
            <div className="range-ends" aria-hidden="true"><span>0</span><span>3</span></div>
          </div>

          <List.Item
            className="detail-toggle"
            extra={
              <Switch
                checked={config.burrs}
                onChange={(v) => update({ burrs: v })}
                disabled={running}
              />
            }
            description="控制轨迹细节的变化幅度"
          >
            轨迹细节变化
          </List.Item>
          <label className="field">
            <span>随机种子</span>
            <Input value={String(config.seed)} onChange={(v) => update({ seed: Number(v) || 0 })} disabled={running} />
          </label>
          <div className="hint">相同参数和种子会得到相同的预览；一般保持默认即可。</div>
          </details>
        </Card></>}

        {(logs.length > 0 || run) && <>
        <SectionTitle>运行日志</SectionTitle>
        <div ref={logRef}><Card>
          <Collapse activeKey={logOpen ? ["log"] : []} onChange={(keys) => setLogOpen(keys.includes("log"))}>
            <Collapse.Panel key="log" title={`${logs.length} 条`}>
              <pre className="log">
                {logs.length ? logs.join("\n") : "尚未开始"}
              </pre>
            </Collapse.Panel>
          </Collapse>
        </Card></div></>}
      </>
    ),

    stats: (
      <>
        <div className="page-intro">
          <div><div className="eyebrow">你的运动</div><h1>每一步，都算数</h1><p>{stats ? lastSynced ? `上次同步：${lastSynced}` : "显示本机缓存 · 同步时间未知" : "同步后查看你的运动记录"}</p></div>
          {stats && <Button size="small" color="primary" fill="outline" loading={statsBusy} onClick={() => void loadStats()}>同步</Button>}
        </div>
        {statsError && <div className="run-notice warning" role="alert">{statsError}</div>}
        {stats ? <>
        <div className="metrics card-like stats-metrics">
          <Metric label="有效" value={stats ? String(stats.validCount) : "—"} />
          <Metric label="无效" value={stats ? String(stats.invalidCount) : "—"} />
          <Metric label="累计里程" value={`${stats.totalKm.toFixed(2)} km`} />
          <Metric label="平均配速" value={stats.avgPaceSecKm > 0 ? `${fmtPace(stats.avgPaceSecKm)}/km` : "—"} />
        </div>

        <SectionTitle>场地分布</SectionTitle>
        <Card>
          {stats && stats.byPlace.length > 0 ? (
            stats.byPlace.map(([name, n]) => (
              <div key={name} className="row-between">
                <span>{name}</span>
                <span className="muted">{n} 次</span>
              </div>
            ))
          ) : (
            <div className="empty">有有效记录后，这里会显示场地分布。</div>
          )}
        </Card>

        <SectionTitle>记录明细</SectionTitle>
        <Card>
          {stats && stats.rows.length > 0 ? (
            stats.rows.slice(0, 40).map((r, i) => (
              <div key={i} className="record">
                <div className="record-main">
                  <div className="record-title">{r.place}</div>
                  <div className="muted small">
                    {r.km.toFixed(2)} km · {r.duration} ·{" "}
                    {r.km > 0 ? fmtPace(r.sec / r.km) : "--"}/km
                  </div>
                </div>
                <Tag color={r.valid ? "success" : "danger"} fill="outline">
                  {r.valid ? "有效" : r.reason || "无效"}
                </Tag>
              </div>
            ))
          ) : (
            <div className="empty">已同步，目前还没有运动记录。</div>
          )}
        </Card>

        </> : <div className="empty-state">
          <div className="empty-mark" aria-hidden="true"><IconStats /></div>
          <h2>成绩还没有同步</h2>
          <p>{config.openid.trim() ? "同步后，这里会显示里程、配速和记录明细。" : "先完成身份配置，就可以同步并查看成绩。"}</p>
          <Button block color="primary" loading={statsBusy} onClick={() => config.openid.trim() ? void loadStats() : goTo("guide")}>
            {config.openid.trim() ? "同步成绩" : "去配置身份"}
          </Button>
        </div>}
      </>
    ),

    guide: (
      <>
        <div className="page-intro"><div><div className="eyebrow">简单两步</div><h1>准备好出发</h1><p>身份只需配置一次，可随时回来查看或更新。</p></div></div>
        <SectionTitle>身份与场地</SectionTitle>
        <Card className="identity-card">
          <label className="field">
            <span>OpenID</span>
            <Input
              value={openidText}
              onChange={setOpenidText}
              disabled={!configLoaded || connectBusy || running || starting}
              onBlur={() => {
                const clean = sanitizeOpenid(openidText);
                setOpenidText(clean);
              }}
              placeholder={isPhone ? "粘贴或扫码导入" : "粘贴，或从本机提取"}
            />
          </label>
          {(() => {
            const h = openidHint(sanitizeOpenid(openidText));
            return h.text ? (
              <div className={"hint" + (h.bad ? " bad" : "")}>{h.text}</div>
            ) : null;
          })()}

          <div className="btn-stack">
            <Button
              block
              color="primary"
              loading={connectBusy}
              disabled={!configLoaded || running || starting}
              onClick={saveIdentity}
            >
              保存并同步场地
            </Button>
            <Button block fill="outline" color="primary" disabled={!configLoaded || running || starting} onClick={() => isPhone ? void scanQr() : goTo("extract")}>
              <span className="btn-line">
                <IconQr />
                {isPhone ? "扫码导入 OpenID" : "从本机微信提取"}
              </span>
            </Button>
          </div>
          {(running || starting) && <div className="hint">运动进行中，暂时不能更改身份配置。</div>}
        </Card>

        <SectionTitle>首次配置</SectionTitle>
        <Card>
          <ol className="steps">
            <li>
              <b>取得 OpenID</b>
              <p>{isPhone ? "在电脑端取码工具中获取 OpenID 或二维码。" : "使用本机微信提取功能，或粘贴已有的 OpenID。"}</p>
            </li>
            <li>
              <b>填入</b>
              <p>{isPhone ? "扫码或粘贴到上面，覆盖更新时配置会保留。" : "填入后保存在本机，覆盖更新时配置会保留。"}</p>
            </li>
            <li>
              <b>同步场地</b>
              <p>点「保存并同步场地」，拉取操场围栏与配速规则。</p>
            </li>
            <li>
              <b>到操场</b>
              <p>保持应用在前台，本人到摄像头下刷脸。结算结果以服务器确认为准。</p>
            </li>
          </ol>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <div className="hint">
            人脸核验在操场摄像头侧完成，请本人到场。
          </div>
        </Card>
      </>
    ),

    settings: (
      <>
        <SectionTitle>外观</SectionTitle>
        <Card>
          <div className="field">
            <span>主题</span>
            <Selector
              className="choice-selector"
              options={[
                { label: "跟随系统", value: "system" },
                { label: "深色", value: "dark" },
                { label: "浅色", value: "light" },
              ]}
              value={[config.theme]}
              onChange={(v) => update({ theme: v[0] ?? "system" })}
              showCheckMark={false}
            />
          </div>
        </Card>

        <SectionTitle>后台与电源</SectionTitle>
        {isPhone ? <div className="platform-note">打卡时请保持应用在前台，切到后台或锁屏可能会中断。</div> : <List className="group">
          <List.Item
            extra={
              <Switch
                checked={config.keepAwake}
                onChange={(v) => update({ keepAwake: v })}
              />
            }
            description={
              "打卡期间阻止系统空闲休眠"
            }
          >
            打卡时保持唤醒
          </List.Item>
        </List>}
        {!isPhone && power && <div className="hint" style={{ paddingLeft: 4 }}>系统休眠设定：{power.sleepMinutes == null ? "从不" : `${power.sleepMinutes} 分钟`}</div>}

        <SectionTitle>关于</SectionTitle>
        <List className="group">
          <List.Item
            description="校园运动小助手"
            extra={<span className="ver">v{version}</span>}
          >
            小雨run
          </List.Item>
          <List.Item
            extra={
              <Button
                size="mini"
                color="danger"
                fill="outline"
                disabled={running || starting}
                onClick={() =>
                  void Dialog.confirm({
                    content: "清空本地保存的 OpenID、参数和缓存成绩？此操作不会删除服务器上的记录。",
                    onConfirm: () => {
                      setConfig((c) => ({ ...DEFAULT_CONFIG, theme: c.theme }));
                      identityRevision.current += 1;
                      setOpenidText("");
                      setAreas([]);
                      setRule(null);
                      setStats(null);
                      setPreview(null);
                    },
                  })
                }
              >
                清空
              </Button>
            }
          >
            本地配置
          </List.Item>
        </List>

        <div className="foot-note">仅供个人学习与协议研究 · 请遵守校纪校规</div>
      </>
    ),

    extract: (
      <>
        <div className="page-intro"><div><div className="eyebrow">只在本机处理</div><h1>提取 OpenID</h1><p>先在电脑微信中打开过智慧体育小程序，再手动开始扫描。</p></div></div>
        <SectionTitle>本机微信身份</SectionTitle>
        <Card>
          <div className="qr-wrap">
            <div className="qr-box">
              {extract?.qr ? (
                <div dangerouslySetInnerHTML={{ __html: extract.qr }} />
              ) : (
                <span className="muted small">尚未扫描</span>
              )}
            </div>
            <div className="qr-side">
              <div className="metric-label">OpenID</div>
              <div className="qr-id">
                {extract?.found.find((f) => f.cqupt)?.openid ??
                  extract?.found[0]?.openid ??
                  "—"}
              </div>
              <div className="hint">{extract?.note ?? "点下方扫描本机微信缓存"}</div>
            </div>
          </div>
          <div className="two-col" style={{ marginTop: 14 }}>
            <Button block color="primary" loading={extractBusy} onClick={() => void runExtract()}>
              扫描本机微信
            </Button>
            <Button
              block
              disabled={!extract?.found.length}
              onClick={() => {
                const id =
                  extract?.found.find((f) => f.cqupt)?.openid ?? extract?.found[0]?.openid;
                if (!id) {
                  Toast.show({ content: "还没有结果" });
                  return;
                }
                void navigator.clipboard.writeText(id).then(
                  () => Toast.show({ icon: "success", content: "已复制" }),
                  () => Toast.show({ content: "复制失败" })
                );
              }}
            >
              复制
            </Button>
          </div>
          {extract?.found.length ? <Button block fill="outline" color="primary" className="use-openid" onClick={() => {
            const id = extract.found.find((f) => f.cqupt)?.openid ?? extract.found[0]?.openid;
            if (id) { setOpenidText(id); goTo("guide"); }
          }}>填入配置</Button> : null}
        </Card>

        <Card style={{ marginTop: 12 }}>
          <div className="hint">
            仅在你点击扫描后读取本机微信缓存；如果没有结果，请先在电脑微信中打开小程序并完成绑定。
          </div>
        </Card>
      </>
    ),
  };

  const titles: Record<TabKey, string> = {
    run: "运动",
    stats: "成绩",
    guide: "指南",
    settings: "设置",
    extract: "提取 OpenID",
  };

  if (scanning) {
    return (
      <div className="scanner-screen">
        <div className="scanner-heading">将二维码放入画面中</div>
        <div className="scanner-frame" aria-hidden="true" />
        <Button disabled={!scanReady} onClick={() => void cancelScan()}>取消扫码</Button>
      </div>
    );
  }

  return (
    <div className="shell">
      {configError && <div className="config-error" role="alert">配置读取失败，暂时无法保存。请重新打开应用或检查本机配置。</div>}
      <NavBar
        className="navbar"
        back={null}
        right={undefined}
      >
        {titles[tab]}
      </NavBar>

      <div className="body" ref={bodyRef}>
        <div className="page-inner">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
              className="page-stack"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            >
              {pages[tab]}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="tabbar-wrap">
        <TabBar activeKey={tab} onChange={(k) => goTo(k as TabKey)} safeArea>
          <TabBar.Item key="run" icon={<IconRun />} title="运动" />
          <TabBar.Item key="stats" icon={<IconStats />} title="成绩" />
          <TabBar.Item key="guide" icon={<IconGuide />} title="指南" />
          <TabBar.Item key="settings" icon={<IconSettings />} title="设置" />
          {!isPhone && <TabBar.Item key="extract" icon={<IconQr />} title="提取" />}
        </TabBar>
      </div>
    </div>
  );
}
