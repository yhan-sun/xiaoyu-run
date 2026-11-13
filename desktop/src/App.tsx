import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { isPhone, useXiaoyu } from "./hooks/useXiaoyu";
import type { TabKey } from "./lib/nav";
import { BottomNav, MobileHeader, Sidebar } from "./components/layout/Nav";
import { ToastHost } from "./components/ui/toast";
import { Button } from "./components/ui/Button";
import { RunPage } from "./components/run/RunPage";
import { RunAction } from "./components/run/RunAction";
import { StatsPage } from "./components/stats/StatsPage";
import { GuidePage } from "./components/guide/GuidePage";
import { SettingsPage } from "./components/settings/SettingsPage";
import { ExtractPage } from "./components/extract/ExtractPage";
import { call, isTauri } from "./api";

export default function App() {
  const app = useXiaoyu();
  const [tab, setTab] = useState<TabKey>("run");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const scrollMemory = useRef<Record<TabKey, number>>({
    run: 0,
    stats: 0,
    guide: 0,
    settings: 0,
    extract: 0,
  });
  const reduced = useReducedMotion();

  const configured = app.identityVerified && !!app.area;

  const changeTab = useCallback(
    (next: TabKey) => {
      if (next === tab) {
        scrollRef.current?.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
        return;
      }
      const el = scrollRef.current;
      if (el) scrollMemory.current[tab] = el.scrollTop;
      setTab(next);
    },
    [tab, reduced]
  );

  // Restore before paint, so returning to a page does not visibly jump.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollMemory.current[tab] ?? 0;
  }, [tab]);

  // Existing health probe, adapted to the new shell.
  useEffect(() => {
    if (!isTauri) return;
    const t = window.setTimeout(() => {
      const bar =
        document.querySelector(".bottom-nav") ??
        document.querySelector(".sidebar");
      const items = document.querySelectorAll("[data-tab]");
      void call("ui_probe", {
        info: {
          ok: true,
          framework: "react + motion",
          tabbar: !!bar,
          tabItems: items.length,
          activeTab: tab,
          viewport: {
            w: window.innerWidth,
            h: window.innerHeight,
            dpr: window.devicePixelRatio,
          },
          theme:
            document.documentElement.getAttribute("data-prefers-color-scheme") ??
            "?",
          cardRadius: getComputedStyle(
            document.querySelector(".card") ?? document.body
          ).borderRadius,
          heroFont: document.querySelector(".run-distance-num")
            ? getComputedStyle(document.querySelector(".run-distance-num")!)
                .fontSize
            : "n/a",
          canvas: (() => {
            const c = document.querySelector("canvas");
            if (!c) return null;
            const r = c.getBoundingClientRect();
            return { w: Math.round(r.width), h: Math.round(r.height) };
          })(),
          extractFound:
            document.querySelector(".extract-primary-value")?.textContent ?? "",
          buttons: Array.from(document.querySelectorAll("button")).map((b) => {
            const r = b.getBoundingClientRect();
            const cs = getComputedStyle(b);
            return {
              text: (b.textContent ?? "").trim().slice(0, 14),
              w: Math.round(r.width),
              h: Math.round(r.height),
              visible:
                r.width > 0 &&
                r.height > 0 &&
                cs.visibility !== "hidden" &&
                cs.display !== "none",
              bg: cs.backgroundColor,
              color: cs.color,
            };
          }),
        },
      }).catch(() => undefined);
    }, 700);
    return () => window.clearTimeout(t);
  }, [tab]);

  const goGuide = useCallback(() => changeTab("guide"), [changeTab]);
  const goExtract = useCallback(() => {
    changeTab("extract");
    if (!app.extract) void app.runExtract();
  }, [app, changeTab]);

  const page = useMemo(() => {
    switch (tab) {
      case "run":
        return (
          <RunPage
            config={app.config}
            areas={app.areas}
            rule={app.rule}
            preview={app.preview}
            run={app.run}
            logs={app.logs}
            progress={app.progress}
            distText={app.distText}
            running={app.running}
            starting={app.starting}
            stopping={app.stopping}
            syncing={app.connecting}
            ready={app.ready}
            missing={app.missing}
            summary={app.summary}
            onAcknowledgeRun={app.acknowledgeRun}
            onChange={app.update}
            onStart={() => void app.startRun()}
            onStop={() => void app.cancelRun()}
            onGoGuide={goGuide}
            onSync={() => void app.connect(app.config.openid)}
          />
        );
      case "stats":
        return (
          <StatsPage
            stats={app.stats}
            loading={app.statsLoading}
            error={app.statsError}
            lastSync={app.lastStatsSync}
            hasOpenid={!!app.config.openid}
            onRefresh={() => void app.loadStats()}
            onGoGuide={goGuide}
          />
        );
      case "guide":
        return (
          <GuidePage
            config={app.config}
            openidText={app.openidText}
            areas={app.areas}
            rule={app.rule}
            verified={app.identityVerified}
            connecting={app.connecting}
            disabled={!app.configLoaded || app.running || app.starting}
            isPhone={isPhone}
            onOpenidTextChange={app.changeOpenidText}
            onSaveOpenid={() => void app.saveOpenid()}
            onScan={() => void app.scanQr()}
            onGoExtract={goExtract}
            onCheckImport={() => void app.checkImport()}
            onSync={() => void app.connect(app.config.openid)}
            onSelectPlace={app.selectPlace}
            onGoRun={() => changeTab("run")}
          />
        );
      case "settings":
        return (
          <SettingsPage
            config={app.config}
            power={app.power}
            version={app.version}
            stats={app.stats}
            running={app.running || app.starting}
            onChange={app.update}
            onClear={app.clearConfig}
            onGoGuide={goGuide}
            onGoStats={() => changeTab("stats")}
          />
        );
      case "extract":
        return (
          <ExtractPage
            extract={app.extract}
            busy={app.extracting}
            platform={app.power?.platform}
            onExtract={() => void app.runExtract()}
            onOpenPrivacy={() => void app.openPrivacySettings()}
          />
        );
      default:
        return null;
    }
  }, [tab, app, goGuide, goExtract]);

  const macOverlay = isTauri && !isPhone && /Mac/i.test(navigator.userAgent);

  if (app.scanning) {
    return (
      <div className="scanner-screen">
        <div className="scanner-heading">将二维码放入画面中</div>
        <div className="scanner-frame" aria-hidden="true" />
        <Button variant="secondary" disabled={!app.scanReady} onClick={() => void app.cancelScan()}>取消扫码</Button>
        <ToastHost />
      </div>
    );
  }

  return (
    <div className={"app" + (macOverlay ? " app--mac" : "")}>
      {macOverlay ? <div className="app-titlebar" data-tauri-drag-region aria-hidden="true" /> : null}
      <Sidebar
        tab={tab}
        onChange={changeTab}
        ready={configured}
        placeCount={app.areas.length}
        version={app.version}
      />

      <div className="app-main">
        {app.configError ? <div className="config-error" role="alert">配置读取失败，暂时无法保存。请重新打开应用或检查本机配置。</div> : null}
        <MobileHeader ready={configured} onStatus={goGuide} />

        <div className="app-scroll" ref={scrollRef}>
          <motion.div
            key={tab}
            className="page-motion"
            initial={reduced ? false : { opacity: 0.96, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduced ? 0 : 0.16, ease: [0.22, 1, 0.36, 1] }}
          >
            {page}
          </motion.div>
        </div>

        {tab === "run" ? (
          <div className="mobile-dock">
            <RunAction
              variant="dock"
              run={app.run}
              running={app.running}
              starting={app.starting}
              stopping={app.stopping}
              ready={app.ready}
              missing={app.missing}
              summary={app.summary}
              detail="保持应用在前台"
              onStart={() => void app.startRun()}
              onStop={() => void app.cancelRun()}
              onGoGuide={goGuide}
            />
          </div>
        ) : null}

        <BottomNav tab={tab} onChange={changeTab} />
      </div>

      <ToastHost />
    </div>
  );
}
