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
  Slider,
  Switch,
  TabBar,
  Tag,
  Toast,
} from "antd-mobile";
import { AnimatePresence, motion, useSpring } from "motion/react";
import TrackCanvas from "./TrackCanvas";
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
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanReady, setScanReady] = useState(false);
  const scanActive = useRef(false);
  const scanCancelled = useRef(false);
  const [openidText, setOpenidText] = useState("");
  const [version, setVersion] = useState("3.2.2");

  const loadedRef = useRef(false);
  const saveTimer = useRef(0);

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
    void (async () => {
      const cfg = await call<Config>("load_config");
      const merged = { ...DEFAULT_CONFIG, ...(cfg ?? {}) };
      setConfig(merged);
      setOpenidText(merged.openid);
      if (merged.lastStats) setStats(merged.lastStats);
      loadedRef.current = true;
    })();
  }, []);

  const update = useCallback((patch: Partial<Config>) => {
    setConfig((c) => ({ ...c, ...patch }));
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void call("save_config", { config }).catch(() => undefined);
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
    async (openid: string) => {
      setBusy(true);
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
        if (!res.areas.some((a) => a.placeCode === config.placeCode)) {
          update({ placeCode: res.areas[0]?.placeCode ?? "" });
        }
        Toast.show({ icon: "success", content: res.message });
      } catch (e) {
        Toast.show({ icon: "fail", content: String(e) });
      } finally {
        setBusy(false);
      }
    },
    [config.placeCode, pushLog, update]
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
      try {
        const imported = await call<string | null>("take_imported_openid");
        if (imported) {
          const clean = sanitizeOpenid(imported);
          setOpenidText(clean);
          update({ openid: clean });
          Toast.show({ content: "已从电脑导入 OpenID" });
        }
      } catch {
        /* ignore */
      }
    })();
  }, [update]);

  // 配置里已有 openid 时静默同步场地
  useEffect(() => {
    if (!loadedRef.current || !config.openid || areas.length > 0) return;
    void connect(config.openid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.openid]);

  // ---------- 运行事件 ----------
  useEffect(() => {
    if (!isTauri) return;
    let dispose: (() => void) | undefined;
    void (async () => {
      const unState = await on<RunState>("run-state", (e) => {
        setRun(e.payload);
        if (e.payload.finished) Toast.show({ icon: "success", content: e.payload.phase });
        if (e.payload.failed) Toast.show({ icon: "fail", content: e.payload.phase });
      });
      const unLog = await on<string>("run-log", (e) => pushLog(e.payload));
      dispose = () => {
        unState();
        unLog();
      };
    })();
    return () => dispose?.();
  }, [pushLog]);

  // ---------- 动作 ----------
  const startRun = useCallback(async () => {
    if (!config.placeCode) {
      Toast.show({ content: "请先同步并选择场地" });
      return;
    }
    if (!config.openid) {
      Toast.show({ content: "请先填入 OpenID" });
      return;
    }
    setLogs([]);
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
    }
  }, [config]);

  const cancelRun = useCallback(async () => {
    await call("cancel_run").catch(() => undefined);
    pushLog("请求取消 …");
  }, [pushLog]);

  const loadStats = useCallback(async () => {
    if (!config.openid) {
      Toast.show({ content: "请先填入 OpenID" });
      return;
    }
    setBusy(true);
    try {
      const s = await call<Stats>("get_stats", { openid: config.openid });
      if (s) {
        setStats(s);
        setConfig((c) => ({ ...c, lastStats: s }));
      }
    } catch (e) {
      Toast.show({ icon: "fail", content: String(e) });
    } finally {
      setBusy(false);
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
      update({ openid: clean });
      Toast.show({ icon: "success", content: "已扫码填入" });
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
  }, [update]);

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
    try {
      const res = await call<ExtractResult>("extract_openid");
      if (res) setExtract(res);
    } catch (e) {
      Toast.show({ icon: "fail", content: String(e) });
    }
  }, []);

  // 桌面端首次进入且没配置时，直接落到提取页
  useEffect(() => {
    if (loadedRef.current && !isPhone && !config.openid) {
      setTab("extract");
      void runExtract();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.openid]);

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
          extractFound: document.querySelector(".qr-id")?.textContent ?? "",
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

  const pages: Record<TabKey, React.ReactNode> = {
    run: (
      <>
        <Card className="hero-card">
          <div className="hero">
            <span className="hero-num">{distText}</span>
            <span className="hero-unit">km</span>
            <span className="hero-total">
              / {((run?.metersTotal ?? Number(config.dist) * 1000) / 1000).toFixed(2)}
            </span>
          </div>
          <div className="hero-sub">
            {run?.phase ?? "待命"}
            {(() => {
              const p = run?.paceSecKm || 0;
              return p > 0 ? ` · ${fmtPace(p)}/km` : "";
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

          <div style={{ marginTop: 14 }}>
            <TrackCanvas preview={preview} running={running} progress={progress} />
          </div>

          <div className="canvas-foot">
            <span>
              {preview?.ok
                ? `${preview.count} 点 · 实测 ${fmtPace(preview.paceSecKm)}`
                : "未生成轨迹"}
            </span>
            {preview && preview.ok && !preview.inWindow && (
              <Tag color="warning" fill="outline">
                超出配速窗口
              </Tag>
            )}
          </div>
        </Card>

        <motion.div whileTap={{ scale: 0.98 }} style={{ marginTop: 12 }}>
          <Button
            block
            size="large"
            color={running ? "danger" : "primary"}
            onClick={() => void (running ? cancelRun() : startRun())}
          >
            {running ? "停止并结算" : "开始打卡"}
          </Button>
        </motion.div>

        <SectionTitle>参数</SectionTitle>
        <Card>
          {placeOptions.length === 0 ? (
            <div className="empty">
              还没有同步场地
              <Button size="small" color="primary" fill="outline" style={{ marginLeft: 10 }} onClick={() => setTab("guide")}>
                去同步
              </Button>
            </div>
          ) : (
            <Selector
              options={placeOptions}
              value={config.placeCode ? [config.placeCode] : []}
              onChange={(v) => update({ placeCode: v[0] ?? "" })}
              disabled={running}
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

          <div className="field">
            <span>
              GPS 抖动 <em>{config.noise.toFixed(2)}</em>
            </span>
            <Slider
              value={config.noise}
              min={0}
              max={1.6}
              step={0.05}
              onChange={(v) => update({ noise: v as number })}
              disabled={running}
            />
          </div>

          <List.Item
            extra={
              <Switch
                checked={config.burrs}
                onChange={(v) => update({ burrs: v })}
                disabled={running}
              />
            }
            description="叠加多尺度步态漂移与变道，更像真人跑出来的"
          >
            拟真毛刺
          </List.Item>

          {rule && (
            <div className="hint">
              规则区间 {fmtPace(rule.minPace)} ~ {fmtPace(rule.maxPace)}/km · 达标{" "}
              {Math.round(rule.raceMile)} m
            </div>
          )}
        </Card>

        <SectionTitle>运行日志</SectionTitle>
        <Card>
          <Collapse defaultActiveKey={["log"]}>
            <Collapse.Panel key="log" title={`${logs.length} 条`}>
              <pre className="log">
                {logs.length ? logs.join("\n") : "尚未开始"}
              </pre>
            </Collapse.Panel>
          </Collapse>
        </Card>
      </>
    ),

    stats: (
      <>
        <div className="metrics card-like">
          <Metric label="有效" value={stats ? String(stats.validCount) : "—"} />
          <Metric label="无效" value={stats ? String(stats.invalidCount) : "—"} />
          <Metric label="累计里程" value={stats ? stats.totalKm.toFixed(2) : "—"} />
          <Metric label="平均配速" value={stats ? fmtPace(stats.avgPaceSecKm) : "—"} />
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
            <div className="empty">暂无数据</div>
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
            <div className="empty">还没有记录</div>
          )}
        </Card>

        <Button block color="primary" fill="outline" loading={busy} onClick={() => void loadStats()} style={{ marginTop: 12 }}>
          同步最新成绩
        </Button>
      </>
    ),

    guide: (
      <>
        <SectionTitle>身份</SectionTitle>
        <Card>
          <label className="field">
            <span>OpenID</span>
            <Input
              value={openidText}
              onChange={(v) => {
                setOpenidText(v);
                update({ openid: sanitizeOpenid(v) });
              }}
              onBlur={() => {
                const clean = sanitizeOpenid(openidText);
                setOpenidText(clean);
                update({ openid: clean });
              }}
              placeholder="粘贴或扫码"
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
              loading={busy}
              onClick={() => {
                const clean = sanitizeOpenid(openidText);
                setOpenidText(clean);
                update({ openid: clean });
                void connect(clean);
              }}
            >
              保存并同步场地
            </Button>
            <Button block fill="outline" color="primary" onClick={() => void scanQr()}>
              <span className="btn-line">
                <IconQr />
                扫码导入 OpenID
              </span>
            </Button>
          </div>
        </Card>

        <SectionTitle>首次配置</SectionTitle>
        <Card>
          <ol className="steps">
            <li>
              <b>取得 OpenID</b>
              <p>电脑上运行取码工具（或界面版），得到 OpenID 与二维码。</p>
            </li>
            <li>
              <b>填入</b>
              <p>扫码，或把 OpenID 粘贴到上面。只需一次，之后永久保存。</p>
            </li>
            <li>
              <b>同步场地</b>
              <p>点「保存并同步场地」，拉取操场围栏与配速规则。</p>
            </li>
            <li>
              <b>到操场</b>
              <p>点开始打卡后保持应用在前台，本人到摄像头下刷脸。跑满自动结算。</p>
            </li>
          </ol>
        </Card>

        <Card style={{ marginTop: 12 }}>
          <div className="hint">
            人脸核验在操场摄像头侧完成，工具无法绕开 —— 必须本人到场。
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
              options={[
                { label: "跟随系统", value: "system" },
                { label: "深色", value: "dark" },
                { label: "浅色", value: "light" },
              ]}
              value={[config.theme]}
              onChange={(v) => update({ theme: v[0] ?? "system" })}
            />
          </div>
          <div className="field">
            <span>随机种子</span>
            <Input
              value={String(config.seed)}
              onChange={(v) => update({ seed: Number(v) || 0 })}
              placeholder="0"
            />
          </div>
        </Card>

        <SectionTitle>后台与电源</SectionTitle>
        <List className="group">
          <List.Item
            extra={
              <Switch
                checked={config.keepAwake}
                onChange={(v) => update({ keepAwake: v })}
              />
            }
            description={
              power?.platform === "android"
                ? "Android 没有可申请的省电白名单，打卡时请保持应用在前台"
                : "打卡期间阻止系统空闲休眠"
            }
          >
            打卡时保持唤醒
          </List.Item>
        </List>
        <div className="hint" style={{ paddingLeft: 4 }}>
          {power?.platform === "android"
            ? running
              ? "打卡中 · 请勿切走或锁屏"
              : "切到后台可能被系统挂起"
            : power
              ? `系统休眠设定：${power.sleepMinutes == null ? "从不" : `${power.sleepMinutes} 分钟`}`
              : "—"}
        </div>

        <SectionTitle>关于</SectionTitle>
        <List className="group">
          <List.Item
            description="Rust + Tauri · 轨迹与协议全部本地完成"
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
                onClick={() =>
                  void Dialog.confirm({
                    content: "清空本地保存的 OpenID 与参数？",
                    onConfirm: () => {
                      setConfig((c) => ({ ...DEFAULT_CONFIG, theme: c.theme }));
                      setOpenidText("");
                      setAreas([]);
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
            <Button block color="primary" onClick={() => void runExtract()}>
              扫描本机微信
            </Button>
            <Button
              block
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
        </Card>

        <Card style={{ marginTop: 12 }}>
          <div className="hint">
            手机端无法自己取：小程序数据在 /data/data/com.tencent.mm，未 root 读不到。
            电脑版微信的缓存是明文，所以只能在电脑上取一次。
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
      <NavBar
        className="navbar"
        back={null}
        right={
          tab === "stats" ? (
            <Button size="mini" fill="none" onClick={() => void loadStats()} loading={busy}>
              刷新
            </Button>
          ) : undefined
        }
      >
        {titles[tab]}
      </NavBar>

      <div className="body">
        <div className="page-inner">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={tab}
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
        <TabBar activeKey={tab} onChange={(k) => setTab(k as TabKey)} safeArea>
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
