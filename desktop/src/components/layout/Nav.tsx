import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { BrandMark, IconGuide, IconQr, IconRun, IconSettings, IconStats } from "../ui/icons";
import { NAV_ITEMS, type TabKey } from "../../lib/nav";

const ICONS: Record<TabKey, ReactNode> = {
  run: <IconRun size={21} />,
  stats: <IconStats size={21} />,
  guide: <IconGuide size={21} />,
  settings: <IconSettings size={21} />,
  extract: <IconQr size={21} />,
};

interface NavProps {
  tab: TabKey;
  onChange: (tab: TabKey) => void;
}

export function Sidebar({
  tab,
  onChange,
  ready,
  placeCount,
  version,
}: NavProps & { ready: boolean; placeCount: number; version: string }) {
  const reduced = useReducedMotion();
  const items = NAV_ITEMS;
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">
          <BrandMark size={34} />
        </span>
        <span className="brand-copy">
          <span className="brand-name">小雨run</span>
          <span className="brand-sub">CAMPUS RUN</span>
        </span>
      </div>

      <nav className="sidebar-nav" aria-label="主导航">
        {items.map((item) => {
          const active = item.key === tab;
          return (
            <button
              key={item.key}
              type="button"
              className={"sidebar-item" + (active ? " is-active" : "")}
              aria-current={active ? "page" : undefined}
              data-tab={item.key}
              onClick={() => onChange(item.key)}
            >
              {active && (
                <motion.span
                  layoutId="sidebar-active"
                  className="sidebar-active"
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 430, damping: 38, mass: 0.7 }
                  }
                />
              )}
              <span className="sidebar-icon">{ICONS[item.key]}</span>
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <button
        type="button"
        className={"sidebar-status" + (ready ? " is-ready" : "")}
        onClick={() => onChange("guide")}
      >
        <span className={"sidebar-status-dot" + (ready ? " live-dot is-static" : "")} />
        <span className="sidebar-status-copy">
          <span>{ready ? "配置就绪" : "需要配置"}</span>
          <span className="sidebar-status-sub">
            {ready ? `${placeCount} 个场地可用` : "填写 OpenID 并同步场地"}
          </span>
        </span>
      </button>

      <div className="sidebar-foot">
        <span>小雨run v{version}</span>
        <span>本地轨迹引擎</span>
      </div>
    </aside>
  );
}

export function BottomNav({ tab, onChange }: NavProps) {
  const reduced = useReducedMotion();
  const items = NAV_ITEMS.filter((item) => !item.desktopOnly);
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {items.map((item) => {
        const active = item.key === tab;
        return (
          <button
            key={item.key}
            type="button"
            className={"bottom-nav-item" + (active ? " is-active" : "")}
            aria-current={active ? "page" : undefined}
            data-tab={item.key}
            onClick={() => onChange(item.key)}
          >
            <span className="bottom-nav-icon">
              {active && (
                <motion.span
                  layoutId="bottom-nav-active"
                  className="bottom-nav-active"
                  transition={
                    reduced
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 430, damping: 38, mass: 0.7 }
                  }
                />
              )}
              {ICONS[item.key]}
            </span>
            <span className="bottom-nav-label">{item.short}</span>
          </button>
        );
      })}
      <span className="bottom-nav-safe" aria-hidden />
    </nav>
  );
}

export function MobileHeader({
  ready,
  onStatus,
}: {
  ready: boolean;
  onStatus: () => void;
}) {
  return (
    <header className="mobile-header">
      <div className="mobile-brand">
        <span className="brand-mark brand-mark--sm">
          <BrandMark size={27} />
        </span>
        <span className="mobile-brand-name">小雨run</span>
      </div>
      <button
        type="button"
        className={"mobile-status" + (ready ? " is-ready" : "")}
        onClick={onStatus}
      >
        <span className={"mobile-status-dot" + (ready ? " live-dot is-static" : "")} />
        {ready ? "已就绪" : "未配置"}
      </button>
    </header>
  );
}
