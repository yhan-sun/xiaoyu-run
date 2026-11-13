import type { CSSProperties } from "react";
import { fmtPace } from "../../api";
import type { Area, Config, Rule, RunState } from "../../api";
import {
  adjustDistance,
  adjustPace,
  formatPaceInput,
  parseDistanceKm,
  parsePaceSeconds,
} from "../../lib/format";
import { Button } from "../ui/Button";
import { Disclosure } from "../ui/Disclosure";
import { StatusIndicator } from "../ui/StatusIndicator";
import { Switch } from "../ui/Switch";
import { IconArrowRight, IconInfo, IconSync } from "../ui/icons";
import { NumberField } from "./NumberField";
import { PlaceSelect } from "./PlaceSelect";
import { RunAction } from "./RunAction";

interface ConfigPanelProps {
  config: Config;
  areas: Area[];
  rule: Rule | null;
  run: RunState | null;
  running: boolean;
  starting: boolean;
  stopping: boolean;
  ready: boolean;
  missing: string[];
  summary: string;
  syncing: boolean;
  onChange: (patch: Partial<Config>) => void;
  onStart: () => void;
  onStop: () => void;
  onGoGuide: () => void;
  onSync: () => void;
}

const PACE_PRESETS = ["5:15", "5:45", "6:30"].map((v) => ({
  label: fmtPace(parsePaceSeconds(v) ?? 0),
  value: v,
}));
const DIST_PRESETS = ["2.0", "3.0", "5.0"].map((v) => ({
  label: `${v}`,
  value: v,
}));

export function ConfigPanel({
  config,
  areas,
  rule,
  run,
  running,
  starting,
  stopping,
  ready,
  missing,
  summary,
  syncing,
  onChange,
  onStart,
  onStop,
  onGoGuide,
  onSync,
}: ConfigPanelProps) {
  const disabled = running || starting || stopping;
  const paceSec = parsePaceSeconds(config.pace);
  const distKm = parseDistanceKm(config.dist);
  const paceError =
    !config.pace.trim()
      ? "必填"
      : paceSec === null
        ? "格式如 5:45"
        : undefined;
  const distError =
    !config.dist.trim()
      ? "必填"
      : distKm === null
        ? "0.1 – 100"
        : undefined;
  const paceOutOfWindow =
    !!rule && paceSec !== null && (paceSec < rule.minPace || paceSec > rule.maxPace);
  const distBelowTarget =
    !!rule && distKm !== null && distKm * 1000 < rule.raceMile - 1;
  const ruleWarning = paceOutOfWindow || distBelowTarget;

  return (
    <section className="config-panel" aria-label="本次训练参数">
      <div className="config-head">
        <div>
          <div className="config-kicker">本次训练</div>
          <h2 className="config-title">参数</h2>
        </div>
        <StatusIndicator
          tone={running ? "accent" : ready ? "success" : "warning"}
          label={running ? "运行中" : ready ? "可开始" : "待配置"}
          size="sm"
          plain
          live={running}
        />
      </div>

      <div className="config-section">
        <div className="config-section-head">
          <span className="t-label">场地</span>
          {areas.length > 0 ? (
            <button
              type="button"
              className="text-button"
              onClick={onGoGuide}
              disabled={disabled}
            >
              管理
            </button>
          ) : null}
        </div>
        <PlaceSelect
          areas={areas}
          value={config.placeCode}
          onChange={(placeCode) => onChange({ placeCode })}
          onSync={onSync}
          disabled={disabled}
          loading={syncing}
        />
      </div>

      <div className="config-section">
        <div className="number-grid">
          <NumberField
            label="配速"
            value={config.pace}
            unit="/km"
            placeholder="5:45"
            inputMode="text"
            disabled={disabled}
            error={paceError}
            presets={PACE_PRESETS}
            onValueChange={(pace) => onChange({ pace })}
            onBlur={() => {
              if (paceSec !== null) onChange({ pace: formatPaceInput(paceSec) });
            }}
            onStep={(dir) => onChange({ pace: adjustPace(config.pace, dir * 5) })}
          />
          <NumberField
            label="距离"
            value={config.dist}
            unit="km"
            placeholder="2.0"
            inputMode="decimal"
            disabled={disabled}
            error={distError}
            presets={DIST_PRESETS}
            onValueChange={(dist) => onChange({ dist })}
            onStep={(dir) =>
              onChange({ dist: adjustDistance(config.dist, dir * 0.5) })
            }
          />
        </div>
      </div>

      {rule ? (
        <div className={"rule-note" + (ruleWarning ? " is-warning" : "")}>
          <span className="rule-note-icon">
            <IconInfo size={16} />
          </span>
          <span>
            规则配速 {fmtPace(rule.minPace)} – {fmtPace(rule.maxPace)}/km · 达标{" "}
            <span className="num">{Math.round(rule.raceMile)}</span> m
            {paceOutOfWindow ? " · 配速超出区间" : ""}
            {distBelowTarget ? " · 距离低于达标" : ""}
          </span>
        </div>
      ) : null}

      <Disclosure
        title="高级参数"
        description={`GPS 抖动 ${config.noise.toFixed(2)} · 拟真毛刺 ${config.burrs ? "开" : "关"}`}
      >
        <div className="advanced-body">
          <div className="slider-field">
            <div className="slider-head">
              <label className="t-label" htmlFor="noise-range">
                GPS 抖动
              </label>
              <span className="slider-value num">{config.noise.toFixed(2)}</span>
            </div>
            <input
              id="noise-range"
              className="range"
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={config.noise}
              disabled={disabled}
              aria-label="GPS 抖动强度"
              style={{ "--fill": `${(config.noise / 3) * 100}%` } as CSSProperties}
              onChange={(event) =>
                onChange({ noise: Number(event.target.value) })
              }
            />
            <div className="slider-scale">
              <span>稳定</span>
              <span>自然</span>
              <span>起伏</span>
            </div>
          </div>

          <div className="switch-row">
            <div className="switch-row-copy">
              <span className="switch-row-title">拟真毛刺</span>
              <span className="switch-row-desc">
                叠加多尺度步态漂移与变道，让形状更像真人跑出来的
              </span>
            </div>
            <Switch
              checked={config.burrs}
              disabled={disabled}
              label="拟真毛刺"
              onChange={(burrs) => onChange({ burrs })}
            />
          </div>
        </div>
      </Disclosure>

      {!ready && missing.length > 0 ? (
        <div className="readiness">
          <div className="readiness-title">开始前还差</div>
          <ul className="readiness-list">
            {missing.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <Button
            variant="secondary"
            size="sm"
            full
            trailing={<IconArrowRight size={15} />}
            onClick={onGoGuide}
          >
            去指南完成配置
          </Button>
        </div>
      ) : null}

      {ready || running ? (
        <RunAction
          variant="panel"
          run={run}
          running={running}
          starting={starting}
          stopping={stopping}
          ready={ready}
          missing={missing}
          summary={summary}
          detail=""
          onStart={onStart}
          onStop={onStop}
          onGoGuide={onGoGuide}
        />
      ) : null}

      {!rule && areas.length > 0 ? (
        <div className="config-note">
          <IconSync size={14} />
          同步后会显示该场地的配速规则
        </div>
      ) : null}
    </section>
  );
}
