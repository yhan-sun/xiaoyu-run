import { useEffect, useState } from "react";
import type { RunState } from "../../api";
import { IconArrowRight, IconPlay, IconStop } from "../ui/icons";
import { Button } from "../ui/Button";
import { describeRunStatus } from "../../run-status.mjs";

interface RunActionProps {
  run: RunState | null;
  running: boolean;
  starting: boolean;
  stopping: boolean;
  ready: boolean;
  missing: string[];
  summary: string;
  detail: string;
  variant: "panel" | "dock";
  onStart: () => void;
  onStop: () => void;
  onGoGuide: () => void;
}

export function RunAction({
  run,
  running,
  starting,
  stopping,
  ready,
  missing,
  summary,
  detail,
  variant,
  onStart,
  onStop,
  onGoGuide,
}: RunActionProps) {
  const [confirmStop, setConfirmStop] = useState(false);

  useEffect(() => {
    if (!confirmStop) return;
    const t = window.setTimeout(() => setConfirmStop(false), 4200);
    return () => window.clearTimeout(t);
  }, [confirmStop]);

  useEffect(() => {
    if (!running) setConfirmStop(false);
  }, [running]);

  const finished = !!run?.finished;
  const failed = !!run?.failed;
  const needsReview = !!describeRunStatus(run, stopping)?.needsReview;
  const settling = run?.phase === "结算中";

  const content =
    variant === "dock" ? (
      <div className="run-dock-inner">
        <div className="run-dock-copy">
          <div className="run-dock-title">
            {needsReview
              ? "记录待确认"
              : running
              ? `进行中 · ${run?.phase ?? ""}`
              : finished
                ? "本次已完成"
                : failed
                  ? "本次已中断"
                  : ready
                    ? "准备出发"
                    : "还需完成配置"}
          </div>
          <div className="run-dock-sub num">
            {ready || running || finished || failed
              ? summary
              : missing.length
                ? `缺少：${missing.join(" · ")}`
                : detail}
          </div>
        </div>

        {needsReview ? (
          <Button variant="secondary" size="md" disabled>请先确认记录</Button>
        ) : ready || running || finished || failed ? (
          running ? (
            <Button
              variant="danger"
              size="md"
              loading={stopping}
              disabled={settling}
              onClick={() => {
                if (confirmStop) onStop();
                else setConfirmStop(true);
              }}
            >
              {settling ? "正在结算" : confirmStop ? "确认停止" : "停止"}
            </Button>
          ) : (
            <Button
              variant="primary"
              size="md"
              loading={starting}
              icon={<IconPlay size={16} />}
              onClick={onStart}
            >
              {finished ? "再跑一次" : failed ? "重新开始" : "开始打卡"}
            </Button>
          )
        ) : (
          <Button
            variant="secondary"
            size="md"
            trailing={<IconArrowRight size={16} />}
            onClick={onGoGuide}
          >
            去配置
          </Button>
        )}
      </div>
    ) : (
      <div className="run-panel-action">
        {needsReview ? (
          <Button variant="secondary" size="lg" full disabled>请先确认记录</Button>
        ) : running ? (
          <Button
            variant="danger"
            size="lg"
            full
            loading={stopping}
            disabled={settling}
            icon={<IconStop size={18} />}
            onClick={() => {
              if (confirmStop) onStop();
              else setConfirmStop(true);
            }}
          >
            {settling ? "正在结算…" : confirmStop ? "再点一次确认停止" : "停止并结算"}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            full
            loading={starting}
            disabled={!ready}
            icon={<IconPlay size={18} />}
            onClick={onStart}
          >
            {finished ? "再跑一次" : failed ? "重新开始" : "开始打卡"}
          </Button>
        )}
        <div className="run-panel-action-note num">
          {running
            ? summary
            : ready
              ? summary
              : missing.length
                ? `缺少：${missing.join(" · ")}`
                : detail}
        </div>
      </div>
    );

  return (
    <div className={`run-action run-action--${variant}`}>
      {content}
    </div>
  );
}
