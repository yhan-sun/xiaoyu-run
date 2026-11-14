import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { fmtDuration, fmtPace } from "../../api";
import type { Config, PreviewResult, RunState } from "../../api";
import {
  parseDistanceKm,
  parsePaceSeconds,
  progressPercent,
  resultPace,
  runMeta,
} from "../../lib/format";
import TrackCanvas from "../../TrackCanvas";
import { Metric } from "../ui/Metric";
import { ProgressBar } from "../ui/ProgressBar";
import { StatusIndicator } from "../ui/StatusIndicator";
import { Card } from "../ui/Card";
import { IconAlert, IconCheck, IconInfo } from "../ui/icons";
import { describeRunStatus } from "../../run-status.mjs";

interface RunDashboardProps {
  config: Config;
  run: RunState | null;
  preview: PreviewResult | null;
  progress: number;
  distText: string;
  running: boolean;
  usingDemo: boolean;
  stopping: boolean;
  onAcknowledgeRun: () => void;
}

export function RunDashboard({
  config,
  run,
  preview,
  progress,
  distText,
  running,
  usingDemo,
  stopping,
  onAcknowledgeRun,
}: RunDashboardProps) {
  const reduced = useReducedMotion();
  const meta = runMeta(run);
  const targetKm =
    (run?.metersTotal ?? (parseDistanceKm(config.dist) ?? 0) * 1000) / 1000;
  const targetPace =
    run?.paceSecKm && run.paceSecKm > 0
      ? run.paceSecKm
      : parsePaceSeconds(config.pace) ?? 0;
  const pct = progressPercent(
    run?.metersDone ?? 0,
    run?.metersTotal ?? targetKm * 1000
  );
  const finished = !!run?.finished;
  const failed = !!run?.failed;
  const avgPace = run && (finished || failed) ? resultPace(run) : 0;
  const notice = describeRunStatus(run, stopping);

  return (
    <Card className="run-dashboard" padded={false}>
      <div className="run-hero">
        <div className="run-hero-top">
          <div className="run-hero-label">已跑距离</div>
          <StatusIndicator
            tone={meta.tone}
            label={meta.label}
            live={meta.live}
            size="sm"
          />
        </div>

        <div className="run-hero-values">
          <div className="run-distance">
            <span className="run-distance-num num" aria-live="off">
              {distText}
            </span>
            <span className="run-distance-unit">km</span>
          </div>
          <div className="run-side-stats">
            <div className="run-side-stat">
              <span className="run-side-label">目标</span>
              <span className="run-side-value num">
                {targetKm.toFixed(2)}
                <em>km</em>
              </span>
            </div>
            <div className="run-side-stat">
              <span className="run-side-label">目标配速</span>
              <span className="run-side-value num">
                {fmtPace(targetPace)}
                <em>/km</em>
              </span>
            </div>
          </div>
        </div>

        <div className="run-progress">
          <ProgressBar
            value={progress}
            tone={failed ? "danger" : finished ? "success" : "accent"}
            label="本次跑步进度"
          />
          <div className="run-progress-meta">
            <span className="run-phase">
              {run ? run.phase : "等待开始"}
              {running ? " · 保持应用在前台" : ""}
            </span>
            <span className="run-percent num">{pct}%</span>
          </div>
        </div>
      </div>

      <div className="track-stage">
        <div className="track-canvas-wrap">
          <TrackCanvas
            preview={preview}
            running={running}
            progress={progress}
            finished={finished}
            failed={failed}
          />
        </div>

        <div className="track-stage-foot">
          <span className="num">
            {preview?.ok
              ? `${preview.count} 点 · 实测 ${fmtPace(preview.paceSecKm)}/km`
              : preview?.message || "等待轨迹数据"}
            {preview?.ok && preview.adjusted ? " · 已微调" : ""}
            {preview?.ok && preview.trackNote ? ` · ${preview.trackNote}` : ""}
          </span>
          {preview?.ok && !preview.inWindow ? (
            <StatusIndicator
              tone="warning"
              label="超出配速窗口"
              size="sm"
              plain
            />
          ) : usingDemo && preview?.ok ? (
            <span className="track-foot-note">同步场地后按真实围栏重算</span>
          ) : null}
        </div>
      </div>

      <div className="run-metrics">
        <Metric label="用时" value={fmtDuration(run?.elapsedSec ?? 0)} size="sm" />
        <Metric
          label="剩余"
          value={(run?.etaSec ?? -1) >= 0 ? fmtDuration(run?.etaSec ?? 0) : "--:--"}
          size="sm"
        />
        <Metric
          label="批次"
          value={`${run?.batchesDone ?? 0}/${run?.batchesTotal ?? 0}`}
          size="sm"
        />
      </div>

      <AnimatePresence initial={false}>
        {notice && run ? (
          <motion.div
            key="result"
            className={"run-result " + (notice.kind === "warning" ? "is-failed" : notice.kind === "info" ? "is-info" : "is-done")}
            role="status" aria-live="polite"
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: reduced ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="run-result-icon">
              {notice.kind === "warning" ? <IconAlert size={17} /> : notice.kind === "info" ? <IconInfo size={17} /> : <IconCheck size={17} />}
            </div>
            <div className="run-result-copy">
              <div className="run-result-title">{notice.title}</div>
              <div className="run-result-sub">{notice.description}</div>
              {notice.showLogs ? <a className="text-button" href="#run-log">查看运行日志</a> : null}
              {notice.needsReview ? <button className="text-button" type="button" onClick={onAcknowledgeRun}>我已检查，返回待命</button> : null}
            </div>
            {avgPace > 0 && !notice.needsReview ? <div className="run-result-stats num">均配 {fmtPace(avgPace)}/km</div> : null}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Card>
  );
}
