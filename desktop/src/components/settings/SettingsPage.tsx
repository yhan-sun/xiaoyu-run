import { useState } from "react";
import type { PowerStatus, Stats } from "../../api";
import type { Config } from "../../api";
import { maskOpenid } from "../../lib/format";
import { PageHeader } from "../layout/PageHeader";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { SegmentedControl } from "../ui/SegmentedControl";
import { SettingsGroup, SettingsRow } from "../ui/SettingsRow";
import { Switch } from "../ui/Switch";
import { StatusIndicator } from "../ui/StatusIndicator";
import {
  BrandMark,
  IconAuto,
  IconBattery,
  IconDatabase,
  IconMoon,
  IconPower,
  IconShuffle,
  IconSun,
  IconTrash,
  IconLock,
} from "../ui/icons";

type Theme = "system" | "light" | "dark";

interface SettingsPageProps {
  config: Config;
  power: PowerStatus | null;
  version: string;
  stats: Stats | null;
  running: boolean;
  onChange: (patch: Partial<Config>) => void;
  onClear: () => void;
  onGoGuide: () => void;
  onGoStats: () => void;
}

export function SettingsPage({
  config,
  power,
  version,
  stats,
  running,
  onChange,
  onClear,
  onGoGuide,
  onGoStats,
}: SettingsPageProps) {
  const [confirmClear, setConfirmClear] = useState(false);
  const theme: Theme =
    config.theme === "light" || config.theme === "dark" ? config.theme : "system";

  const powerNote =
    power?.platform === "android"
      ? running
        ? "打卡中 · 请勿切走或锁屏"
        : "切到后台可能被系统挂起"
      : power ? undefined : "读取系统电源状态…";

  return (
    <div className="page settings-page">
      <PageHeader
        title="设置"
      />

      <div className="settings-content">
        <section className="settings-section">
          <div className="settings-section-title">外观</div>
          <Card className="settings-card" padded={false}>
            <div className="settings-theme">
              <div className="settings-theme-head">
                <span className="settings-row-title">主题</span>
              </div>
              <SegmentedControl<Theme>
                ariaLabel="主题"
                value={theme}
                onChange={(next) => onChange({ theme: next })}
                options={[
                  { value: "system", label: "系统", icon: <IconAuto size={16} /> },
                  { value: "light", label: "浅色", icon: <IconSun size={16} /> },
                  { value: "dark", label: "深色", icon: <IconMoon size={16} /> },
                ]}
              />
            </div>
          </Card>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">运行与电源</div>
          <SettingsGroup aria-label="运行与电源">
            <SettingsRow
              icon={<IconBattery size={19} />}
              title="打卡时保持唤醒"
              description={
                power?.platform === "android"
                  ? "Android 没有可申请的省电白名单，打卡时请保持前台"
                  : "打卡期间阻止系统空闲休眠，进程退出自动解除"
              }
              control={
                <Switch
                  checked={config.keepAwake}
                  label="打卡时保持唤醒"
                  onChange={(keepAwake) => onChange({ keepAwake })}
                />
              }
            />
            <SettingsRow
              icon={<IconPower size={19} />}
              title="系统电源状态"
              description={powerNote}
              control={
                <span className="settings-value">
                  {power?.runningAwake ? (
                    <StatusIndicator tone="success" label="已阻止休眠" size="sm" plain />
                  ) : power ? (
                    `${power.onBattery ? "电池供电" : "电源供电"} · ${
                      power.sleepMinutes == null ? "不休眠" : `${power.sleepMinutes} 分钟`
                    }`
                  ) : (
                    "—"
                  )}
                </span>
              }
            />
            <SettingsRow
              icon={<IconShuffle size={19} />}
              title="轨迹随机种子"
              description="相同参数与种子会产生一致的轨迹形状；0 为默认"
              last
              control={
                <span className="seed-control">
                  <input
                    className="settings-input num"
                    value={String(config.seed)}
                    inputMode="numeric"
                    aria-label="轨迹随机种子"
                    onChange={(event) =>
                      onChange({ seed: Number(event.target.value) || 0 })
                    }
                  />
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => onChange({ seed: 0 })}
                  >
                    归零
                  </button>
                </span>
              }
            />
          </SettingsGroup>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">本地数据</div>
          <SettingsGroup aria-label="本地数据">
            <SettingsRow
              icon={<IconLock size={19} />}
              title="OpenID"
              description={
                config.openid
                  ? "仅保存在本机"
                  : "尚未配置身份"
              }
              control={
                <span className="settings-openid">
                  <span className="settings-value mono">
                    {config.openid ? maskOpenid(config.openid) : "未配置"}
                  </span>
                  <button
                    type="button"
                    className="text-button"
                    onClick={onGoGuide}
                  >
                    {config.openid ? "更换" : "去配置"}
                  </button>
                </span>
              }
            />
            <SettingsRow
              icon={<IconDatabase size={19} />}
              title="成绩缓存"
              description={
                stats
                  ? `${stats.validCount} 条有效 · ${stats.totalKm.toFixed(2)} km`
                  : "还没有本机缓存"
              }
              control={
                <Button variant="ghost" size="sm" onClick={onGoStats}>
                  查看
                </Button>
              }
            />
            <SettingsRow
              icon={<IconTrash size={19} />}
              title="清空本地配置"
              description={
                running
                  ? "打卡进行中，结束后才能清空本地配置"
                  : "删除 OpenID、场地缓存与运行参数，主题会保留"
              }
              danger
              last
              control={
                <Button
                  variant="danger"
                  size="sm"
                  disabled={running}
                  onClick={() => setConfirmClear(true)}
                >
                  清空
                </Button>
              }
            />
          </SettingsGroup>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">关于</div>
          <SettingsGroup aria-label="关于">
            <SettingsRow
              icon={<BrandMark size={20} />}
              title="小雨run"
              control={<span className="settings-value num">v{version}</span>}
            />
          </SettingsGroup>
        </section>

        <div className="settings-footnote">
          仅供个人学习与协议研究 · 请遵守校纪校规
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        title="清空本地配置？"
        description="OpenID、场地缓存、运行参数与成绩缓存会被删除，主题设置保留。此操作无法撤销。"
        confirmLabel="确认清空"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          onClear();
        }}
      />
    </div>
  );
}
