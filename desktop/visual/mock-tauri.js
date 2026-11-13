/* Visual QA bridge — only loaded by /visual.html, never by the shipped app. */
(() => {
  const params = new URLSearchParams(location.search);
  const configured = params.get("data") !== "none";
  const theme = params.get("theme") === "light" ? "light" : "dark";
  const statsMode = params.get("stats") || "none";
  const runMode = params.get("run") || "";
  const tab = params.get("tab") || "";
  const openid = configured ? "oQ7d3nLx9kP2mWs8vB4cR6tY1zH5jF0aK3eN7uG2" : "";

  const areas = configured
    ? [
        {
          placeName: "风华运动场",
          placeCode: "T1001",
          fenceVertices: 34,
          banCount: 1,
        },
        {
          placeName: "太极运动场",
          placeCode: "T1002",
          fenceVertices: 28,
          banCount: 0,
        },
        {
          placeName: "南区田径场",
          placeCode: "T1003",
          fenceVertices: 31,
          banCount: 2,
        },
      ]
    : [];

  const rule = { minPace: 325, maxPace: 425, raceMile: 2000 };

  const makeStats = () => {
    if (statsMode === "empty") {
      return {
        total: 0,
        validCount: 0,
        invalidCount: 0,
        totalKm: 0,
        avgPaceSecKm: 0,
        byPlace: [],
        rows: [],
      };
    }
    const rows = [
      { place: "风华运动场", km: 2.01, sec: 690, duration: "11:30", valid: true, reason: "" },
      { place: "风华运动场", km: 2.0, sec: 681, duration: "11:21", valid: true, reason: "" },
      { place: "太极运动场", km: 2.02, sec: 702, duration: "11:42", valid: true, reason: "" },
      { place: "风华运动场", km: 1.2, sec: 486, duration: "08:06", valid: false, reason: "配速超出规则区间" },
      { place: "南区田径场", km: 3.01, sec: 1048, duration: "17:28", valid: true, reason: "" },
      { place: "太极运动场", km: 2.0, sec: 695, duration: "11:35", valid: true, reason: "" },
      { place: "南区田径场", km: 1.5, sec: 540, duration: "09:00", valid: false, reason: "目标距离低于达标里程" },
      { place: "风华运动场", km: 2.0, sec: 688, duration: "11:28", valid: true, reason: "" },
    ];
    const byPlace = [];
    for (const row of rows) {
      const found = byPlace.find(([name]) => name === row.place);
      if (found) found[1] += 1;
      else byPlace.push([row.place, 1]);
    }
    const totalKm = rows.reduce((s, r) => s + r.km, 0);
    const totalSec = rows.reduce((s, r) => s + r.sec, 0);
    return {
      total: rows.length,
      validCount: rows.filter((r) => r.valid).length,
      invalidCount: rows.filter((r) => !r.valid).length,
      totalKm,
      avgPaceSecKm: totalSec / totalKm,
      byPlace,
      rows,
    };
  };

  const stats = statsMode === "none" ? null : makeStats();

  const config = {
    openid,
    pace: "5:45",
    dist: "2.0",
    noise: 0.45,
    burrs: true,
    seed: 0,
    placeCode: configured ? "T1001" : "",
    theme,
    keepAwake: true,
    lastStats: stats,
  };

  const callbacks = new Map();
  const listeners = new Map();
  let nextCallback = 1;
  let nextEvent = 1;
  let previewCache = null;

  const getPreview = async () => {
    if (!previewCache) {
      previewCache = await fetch("/visual/preview.json").then((r) => r.json());
    }
    return previewCache;
  };

  const baseRun = () => ({
    phase: "上传中",
    pointsDone: 618,
    pointsTotal: 1000,
    metersDone: 1236.4,
    metersTotal: 2000,
    elapsedSec: 428,
    etaSec: 267,
    paceSecKm: 345,
    paceLo: 325,
    paceHi: 365,
    batchesDone: 18,
    batchesTotal: 30,
    serverMileage: 1.236,
    serverSeconds: 426,
    finished: false,
    failed: false,
  });

  const runStates = {
    running: baseRun(),
    finished: {
      ...baseRun(),
      phase: "已完成",
      pointsDone: 1000,
      metersDone: 2001.2,
      elapsedSec: 690,
      etaSec: 0,
      batchesDone: 30,
      batchesTotal: 30,
      serverMileage: 2.0012,
      serverSeconds: 690,
      finished: true,
      failed: false,
    },
    failed: {
      ...baseRun(),
      phase: "失败：start2 网络",
      pointsDone: 280,
      metersDone: 640.8,
      elapsedSec: 190,
      etaSec: 0,
      batchesDone: 8,
      batchesTotal: 30,
      serverMileage: 0.6408,
      serverSeconds: 190,
      finished: false,
      failed: true,
    },
  };

  function emit(event, payload) {
    let delivered = false;
    for (const [eventId, listener] of listeners) {
      if (listener.event !== event) continue;
      const cb = callbacks.get(listener.handler);
      if (cb) { cb({ event, id: eventId, payload }); delivered = true; }
    }
    return delivered;
  }

  async function invoke(cmd, args) {
    switch (cmd) {
      case "load_config":
        return structuredClone(config);
      case "save_config":
        return null;
      case "connect":
        return configured
          ? {
              ok: true,
              message: `已同步 ${areas.length} 个场地`,
              tokenMasked: "tok_••••••",
              rule,
              areas,
              logs: ["✓ token = tok_••••••", "✓ 已获取 3 个场地"],
            }
          : {
              ok: false,
              message: "该 OpenID 未绑定校园跑身份，请先在小程序完成绑定",
              tokenMasked: "",
              rule: null,
              areas: [],
              logs: [],
            };
      case "preview": {
        if (!args?.placeCode) {
          return {
            ok: false,
            message: "同步场地后即可生成真实轨迹",
            fence: [],
            points: [],
            paceSecKm: 0,
            windowLo: 0,
            windowHi: 0,
            inWindow: false,
            count: 0,
            adjusted: false,
            distanceM: 0,
          };
        }
        return getPreview();
      }
      case "start_run":
        window.__QA__.started = true;
        return true;
      case "cancel_run":
        setTimeout(() => {
          emit("run-state", {
            ...runStates.failed,
            phase: "已取消",
            failed: true,
          });
          emit("run-log", "请求取消 …");
        }, 350);
        return true;
      case "get_stats":
        return stats || {
          total: 0,
          validCount: 0,
          invalidCount: 0,
          totalKm: 0,
          avgPaceSecKm: 0,
          byPlace: [],
          rows: [],
        };
      case "power_status":
        return {
          platform: "macos",
          caffeinate: true,
          sleepMinutes: 1,
          onBattery: false,
          runningAwake: false,
        };
      case "take_imported_openid":
        return null;
      case "extract_openid":
        return {
          found: [],
          note: "视觉验收环境未读取微信缓存",
          scannedDirs: 0,
          scannedFiles: 0,
          deniedDirs: 0,
          qr: null,
        };
      case "open_privacy_settings":
        return true;
      case "app_version":
        return "3.2.8";
      case "ui_probe":
        return true;
      case "plugin:event|listen": {
        const eventId = nextEvent++;
        listeners.set(eventId, { event: args.event, handler: args.handler });
        return eventId;
      }
      case "plugin:event|unlisten":
        listeners.delete(args.eventId);
        return null;
      default:
        return null;
    }
  }

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback(callback, once) {
      const id = nextCallback++;
      callbacks.set(id, (payload) => {
        callback(payload);
        if (once) callbacks.delete(id);
      });
      return id;
    },
    convertFileSrc: (path) => path,
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
  };

  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener() {},
  };

  window.__QA__ = {
    configured,
    started: false,
    emitRun(mode) {
      const state = runStates[mode] || baseRun();
      emit("run-state", state);
      emit("run-log", `QA · ${mode}`);
      return state;
    },
    emitLog(line) {
      emit("run-log", line);
    },
    setTheme(next) {
      config.theme = next;
      document.documentElement.setAttribute(
        "data-prefers-color-scheme",
        next === "light" ? "light" : "dark"
      );
    },
    tab(key) {
      const el = document.querySelector(`[data-tab="${key}"]`);
      if (el) el.click();
      return !!el;
    },
  };

  if (runMode) {
    setTimeout(() => {
      window.__QA__.emitRun(runMode);
    }, 1600);
  }

  if (tab) {
    setTimeout(() => {
      window.__QA__.tab(tab);
    }, 1400);
  }
})();
