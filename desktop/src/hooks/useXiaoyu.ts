import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion, useSpring } from "motion/react";
import {
  call,
  DEFAULT_CONFIG,
  fmtDuration,
  fmtPace,
  isTauri,
  on,
  openidHint,
  sanitizeOpenid,
} from "../api";
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
} from "../api";
import { formatPaceInput, parseDistanceKm, parsePaceSeconds } from "../lib/format";
import { toast } from "../components/ui/toast";
import { describeRunStatus } from "../run-status.mjs";

export const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

function nowMs() {
  return Date.now();
}

export function useXiaoyu() {
  const [config, setConfig] = useState<Config>(DEFAULT_CONFIG);
  const [areas, setAreas] = useState<Area[]>([]);
  const [rule, setRule] = useState<Rule | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [power, setPower] = useState<PowerStatus | null>(null);
  const [extract, setExtract] = useState<ExtractResult | null>(null);
  const [openidText, setOpenidText] = useState("");
  const [version, setVersion] = useState("3.2.8");

  const [configLoaded, setConfigLoaded] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanReady, setScanReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [lastStatsSync, setLastStatsSync] = useState<number | null>(null);
  const [lastPlacesSync, setLastPlacesSync] = useState<number | null>(null);
  const [verifiedOpenid, setVerifiedOpenid] = useState("");

  const loadedRef = useRef(false);
  const saveTimer = useRef(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const identityRevision = useRef(0);
  const scanActive = useRef(false);
  const scanCancelled = useRef(false);
  const silentTried = useRef("");
  const connectSequence = useRef(0);
  const startFallback = useRef(0);
  const startBusy = useRef(false);
  const stopBusy = useRef(false);

  const running = !!run && !run.finished && !run.failed;

  // ------------------------------------------------------------- distance spring
  const reducedMotion = useReducedMotion();
  const distSpring = useSpring(0, { stiffness: 150, damping: 24 });
  const [distText, setDistText] = useState("0.00");
  const hasRunDistance = useRef(false);
  useEffect(() => {
    const un = distSpring.on("change", (v) => setDistText(v.toFixed(2)));
    return () => un();
  }, [distSpring]);
  useLayoutEffect(() => {
    const distance = (run?.metersDone ?? 0) / 1000;
    const snap = reducedMotion || !run || !hasRunDistance.current || run.finished || run.failed;
    if (snap) {
      distSpring.jump(distance);
      setDistText(distance.toFixed(2));
    } else {
      distSpring.set(distance);
    }
    hasRunDistance.current = !!run;
  }, [run?.metersDone, run?.finished, run?.failed, distSpring, reducedMotion]);

  const progress = useMemo(() => {
    const total = run?.metersTotal ?? 0;
    return total > 0 ? Math.min(1, (run?.metersDone ?? 0) / total) : 0;
  }, [run?.metersDone, run?.metersTotal]);

  const pushLog = useCallback((line: string) => {
    setLogs((prev) => [...prev.slice(-260), line]);
  }, []);

  // ------------------------------------------------------------------- theme
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

  // Load the optional import before enabling persistence, to avoid overwriting
  // an existing identity or its cached results during startup.
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
            if (clean && clean !== merged.openid) {
              merged = { ...merged, openid: clean, placeCode: "", lastStats: null, lastStatsSyncAt: null };
            }
            toast.success("已从电脑导入 OpenID");
          }
        } catch { /* optional import is unavailable on some platforms */ }
        loadedRef.current = true;
        setConfig(merged);
        setOpenidText(merged.openid);
        setStats(merged.lastStats);
        const synced = merged.lastStatsSyncAt ? Date.parse(merged.lastStatsSyncAt) : NaN;
        setLastStatsSync(Number.isFinite(synced) ? synced : null);
        setConfigLoaded(true);
      } catch (error) {
        if (!cancelled) {
          setConfigError(String(error));
          toast.error("读取配置失败，请重新打开应用");
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const update = useCallback((patch: Partial<Config>) => {
    if (loadedRef.current) setConfig((c) => ({ ...c, ...patch }));
  }, []);

  useEffect(() => {
    if (!loadedRef.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveQueue.current = saveQueue.current.then(async () => {
        try { await call("save_config", { config }); }
        catch (error) { toast.error(`保存配置失败：${String(error)}`); }
      });
    }, 400);
    return () => window.clearTimeout(saveTimer.current);
  }, [config]);

  // ----------------------------------------------------------------- preview
  const previewTimer = useRef(0);
  const doPreview = useCallback(async () => {
    if (!config.placeCode) {
      setPreview(null);
      return;
    }
    try {
      const paceSec = parsePaceSeconds(config.pace);
      const res = await call<PreviewResult>("preview", {
        placeCode: config.placeCode,
        pace: paceSec !== null ? formatPaceInput(paceSec) : config.pace,
        dist: config.dist,
        noise: config.noise,
        burrs: config.burrs,
        seed: config.seed,
      });
      if (res) setPreview(res);
    } catch {
      /* invalid params → backend returns empty; keep the last preview */
    }
  }, [
    config.placeCode,
    config.pace,
    config.dist,
    config.noise,
    config.burrs,
    config.seed,
  ]);

  useEffect(() => {
    window.clearTimeout(previewTimer.current);
    previewTimer.current = window.setTimeout(() => void doPreview(), 220);
  }, [doPreview]);

  // A response for an older identity must never replace the current account.
  const connect = useCallback(async (rawOpenid: string, silent = false) => {
    const openid = sanitizeOpenid(rawOpenid);
    if (!openid) { if (!silent) toast.error("请先填入 OpenID"); return false; }
    const revision = identityRevision.current;
    const sequence = ++connectSequence.current;
    setConnecting(true);
    try {
      const res = await call<ConnectResult>("connect", { openid });
      if (revision !== identityRevision.current || sequence !== connectSequence.current) return false;
      if (!res) { if (!silent) toast.error("当前环境无法连接本地服务"); return false; }
      res.logs.forEach(pushLog);
      if (!res.ok) { if (!silent) toast.error(res.message); return false; }
      setAreas(res.areas);
      setRule(res.rule);
      setVerifiedOpenid(openid);
      setLastPlacesSync(nowMs());
      setConfig((c) => res.areas.some((a) => a.placeCode === c.placeCode)
        ? c : { ...c, placeCode: res.areas[0]?.placeCode ?? "" });
      if (!silent) toast.success(res.message);
      return true;
    } catch (error) {
      if (!silent && revision === identityRevision.current) toast.error(String(error));
      return false;
    } finally { if (sequence === connectSequence.current) setConnecting(false); }
  }, [pushLog]);

  // --------------------------------------------------------------- startup
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

  // silently re-sync places when config already has an identity
  useEffect(() => {
    if (!configLoaded || !config.openid || areas.length > 0) return;
    if (silentTried.current === config.openid) return;
    silentTried.current = config.openid;
    void connect(config.openid, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configLoaded, config.openid]);

  // ------------------------------------------------------------ run events
  useEffect(() => {
    if (!isTauri) return;
    let cancelled = false;
    let dispose: (() => void) | undefined;
    void (async () => {
      const unState = await on<RunState>("run-state", (event) => {
        const payload = event.payload;
        setRun(payload);
        setStarting(false);
        startBusy.current = false;
        window.clearTimeout(startFallback.current);
        if (payload.finished || payload.failed) {
          setStopping(false);
          stopBusy.current = false;
        }
      });
      if (cancelled) { unState(); return; }
      const unLog = await on<string>("run-log", (event) => pushLog(event.payload));
      if (cancelled) { unState(); unLog(); return; }
      dispose = () => {
        unState();
        unLog();
      };
    })();
    return () => { cancelled = true; dispose?.(); };
  }, [pushLog]);

  // ------------------------------------------------------------------ actions
  const startRun = useCallback(async () => {
    if (startBusy.current || starting || running) return;
    if (!configLoaded) { toast.warning("配置尚未读取"); return; }
    if (describeRunStatus(run, stopping)?.needsReview) {
      toast.warning("请先在官方小程序检查记录并确认"); return;
    }
    if (!config.placeCode || !areas.some((area) => area.placeCode === config.placeCode)) {
      toast.warning("请先同步并选择场地");
      return;
    }
    if (!config.openid) {
      toast.warning("请先填入 OpenID");
      return;
    }
    const pace = parsePaceSeconds(config.pace);
    const dist = parseDistanceKm(config.dist);
    if (pace === null) {
      toast.error("配速格式无效，应如 5:45");
      return;
    }
    if (dist === null) {
      toast.error("距离需在 0.1 – 100 km 之间");
      return;
    }

    startBusy.current = true;
    setLogs([]);
    setRun(null);
    setStarting(true);
    try {
      const ok = await call<boolean>("start_run", {
        req: {
          openid: config.openid,
          placeCode: config.placeCode,
          pace: formatPaceInput(pace),
          dist: config.dist,
          noise: config.noise,
          burrs: config.burrs,
          seed: config.seed,
          keepAwake: config.keepAwake,
        },
      });
      if (!ok) {
        startBusy.current = false;
        setStarting(false);
        toast.error("启动失败");
        return;
      }
      window.clearTimeout(startFallback.current);
      startFallback.current = window.setTimeout(() => {
        startBusy.current = false;
        setStarting(false);
      }, 5000);
    } catch (error) {
      startBusy.current = false;
      setStarting(false);
      toast.error(String(error));
    }
  }, [config, areas, configLoaded, running, starting, stopping, run]);

  const cancelRun = useCallback(async () => {
    if (stopBusy.current || stopping) return;
    stopBusy.current = true;
    setStopping(true);
    try {
      await call("cancel_run");
      pushLog("已请求停止，等待当前操作完成并结算 …");
    } catch (error) {
      stopBusy.current = false;
      setStopping(false);
      toast.error(String(error));
    }
  }, [pushLog, stopping]);

  const loadStats = useCallback(async () => {
    if (!config.openid) { toast.warning("请先填入 OpenID"); return; }
    const revision = identityRevision.current;
    setStatsLoading(true);
    setStatsError(null);
    try {
      const next = await call<Stats>("get_stats", { openid: config.openid });
      if (next && revision === identityRevision.current) {
        const now = nowMs();
        setStats(next);
        setConfig((c) => ({ ...c, lastStats: next, lastStatsSyncAt: new Date(now).toISOString() }));
        setLastStatsSync(now);
        toast.success(`已同步 ${next.total} 条记录`);
      }
    } catch (error) {
      if (revision === identityRevision.current) {
        setStatsError("同步失败，请检查网络后重试。现有缓存仍保留。");
        toast.error(String(error));
      }
    } finally { setStatsLoading(false); }
  }, [config.openid]);

  const applyOpenid = useCallback((raw: string) => {
    const clean = sanitizeOpenid(raw);
    setOpenidText(clean);
    if (clean !== config.openid) {
      identityRevision.current += 1;
      setAreas([]); setRule(null); setPreview(null); setStats(null);
      setStatsError(null); setLastStatsSync(null); setLastPlacesSync(null);
      setVerifiedOpenid("");
      setConfig((c) => ({ ...c, openid: clean, placeCode: "", lastStats: null, lastStatsSyncAt: null }));
      silentTried.current = clean;
    }
    return clean;
  }, [config.openid]);

  const changeOpenidText = useCallback((raw: string) => {
    if (!running && !starting && loadedRef.current) setOpenidText(raw);
  }, [running, starting]);

  const commitOpenid = useCallback(() => sanitizeOpenid(openidText), [openidText]);
  const saveOpenid = useCallback(async () => {
    if (!loadedRef.current || running || starting) return;
    const clean = sanitizeOpenid(openidText);
    if (!clean) { toast.error("请先填入 OpenID"); return; }
    if (openidHint(clean).bad) { toast.error("OpenID 格式异常，请检查后重试"); return; }
    applyOpenid(clean);
    await connect(clean);
  }, [applyOpenid, connect, openidText, running, starting]);

  const checkImport = useCallback(async () => {
    if (!loadedRef.current || running || starting) return;
    try {
      const imported = await call<string | null>("take_imported_openid");
      if (!imported) { toast.info("没有检测到电脑导入的 OpenID"); return; }
      const clean = applyOpenid(imported);
      toast.success("已从电脑导入 OpenID");
      if (clean) await connect(clean);
    } catch (error) { toast.error(String(error)); }
  }, [applyOpenid, connect, running, starting]);

  const scanQr = useCallback(async () => {
    if (scanActive.current || !loadedRef.current || running || starting) return;
    scanActive.current = true;
    scanCancelled.current = false;
    try {
      const mod = await import("@tauri-apps/plugin-barcode-scanner");
      let permission = await mod.checkPermissions();
      if (permission !== "granted") permission = await mod.requestPermissions();
      if (permission !== "granted") { toast.error("没有相机权限，请在系统设置里允许"); return; }
      document.documentElement.classList.add("scanner-active");
      setScanning(true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const result = mod.scan({ windowed: true, formats: [mod.Format.QRCode] });
      setScanReady(true);
      const res = await result;
      const clean = sanitizeOpenid(res.content ?? "");
      if (!clean) { toast.warning("二维码里没有有效内容"); return; }
      setOpenidText(clean);
      toast.success("已填入，请继续同步场地");
    } catch (error) {
      if (!scanCancelled.current) toast.error(`扫码失败：${String(error)}，也可以粘贴 OpenID`);
    } finally {
      document.documentElement.classList.remove("scanner-active");
      setScanning(false); setScanReady(false); scanActive.current = false;
    }
  }, [running, starting]);

  const cancelScan = useCallback(async () => {
    try {
      const mod = await import("@tauri-apps/plugin-barcode-scanner");
      scanCancelled.current = true;
      await mod.cancel();
    } catch {
      scanCancelled.current = false;
      toast.error("退出扫码失败，请重试");
    }
  }, []);

  const runExtract = useCallback(async () => {
    setExtracting(true);
    try {
      const res = await call<ExtractResult>("extract_openid");
      if (res) {
        setExtract(res);
        if (res.found.length === 0) toast.info(res.note || "没有识别到 OpenID");
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setExtracting(false);
    }
  }, []);

  const openPrivacySettings = useCallback(async () => {
    try {
      const ok = await call<boolean>("open_privacy_settings");
      if (!ok) toast.info("当前平台无需该设置");
    } catch (error) {
      toast.error(String(error));
    }
  }, []);

  const clearConfig = useCallback(() => {
    if (!loadedRef.current || running || starting) return;
    identityRevision.current += 1;
    setConfig((c) => ({ ...DEFAULT_CONFIG, theme: c.theme }));
    setOpenidText("");
    setAreas([]);
    setRule(null);
    setPreview(null);
    setRun(null);
    setStats(null);
    setExtract(null);
    setLogs([]);
    setStatsError(null);
    setLastStatsSync(null);
    setLastPlacesSync(null);
    setVerifiedOpenid("");
    silentTried.current = "";
    startBusy.current = false;
    stopBusy.current = false;
    toast.success("本地配置已清空");
  }, [running, starting]);

  const selectPlace = useCallback(
    (placeCode: string) => update({ placeCode }),
    [update]
  );

  // ------------------------------------------------------------ derived state
  const paceSec = parsePaceSeconds(config.pace);
  const distKm = parseDistanceKm(config.dist);
  const area = areas.find((a) => a.placeCode === config.placeCode) ?? null;
  const identityVerified = !!verifiedOpenid && config.openid === verifiedOpenid;
  const missing = useMemo(() => {
    const list: string[] = [];
    if (!config.openid) list.push("OpenID");
    else if (!identityVerified) list.push("验证 OpenID");
    if (!areas.length) list.push("同步场地");
    else if (!area) list.push("选择场地");
    if (paceSec === null) list.push("有效配速");
    if (distKm === null) list.push("有效距离");
    return list;
  }, [config.openid, identityVerified, areas.length, area, paceSec, distKm]);

  const ready =
    !!config.openid &&
    identityVerified &&
    !!area &&
    paceSec !== null &&
    distKm !== null &&
    !running && configLoaded && !describeRunStatus(run, stopping)?.needsReview;

  const acknowledgeRun = useCallback(() => setRun(null), []);

  const summary = useMemo(() => {
    const target = (parseDistanceKm(config.dist) ?? 0).toFixed(2);
    const targetPace = fmtPace(paceSec ?? 0);
    if (run?.finished || run?.failed) {
      return `${(run.metersDone / 1000).toFixed(2)} km · ${fmtDuration(
        run.elapsedSec
      )}`;
    }
    if (run) {
      return `${(run.metersDone / 1000).toFixed(2)} / ${
        run.metersTotal > 0 ? (run.metersTotal / 1000).toFixed(2) : target
      } km · ${fmtDuration(run.elapsedSec)}`;
    }
    return `${target} km · 目标 ${targetPace}/km`;
  }, [config.dist, run, paceSec]);

  return {
    // state
    config,
    configLoaded,
    configError,
    scanning,
    scanReady,
    areas,
    rule,
    preview,
    run,
    logs,
    stats,
    power,
    extract,
    openidText,
    version,
    running,
    progress,
    distText,
    paceSec,
    distKm,
    missing,
    ready,
    identityVerified,
    summary,
    area,
    lastStatsSync,
    lastPlacesSync,
    statsError,
    // status
    connecting,
    statsLoading,
    starting,
    stopping,
    extracting,
    // actions
    update,
    connect,
    startRun,
    cancelRun,
    acknowledgeRun,
    cancelScan,
    loadStats,
    changeOpenidText,
    commitOpenid,
    saveOpenid,
    checkImport,
    scanQr,
    runExtract,
    openPrivacySettings,
    clearConfig,
    selectPlace,
    doPreview,
  };
}

export type XiaoyuController = ReturnType<typeof useXiaoyu>;
