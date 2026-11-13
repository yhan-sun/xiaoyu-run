import { useEffect, useRef } from "react";
import type { Area, Config, PreviewResult, Rule, RunState } from "../../api";
import { PageHeader } from "../layout/PageHeader";
import { Card } from "../ui/Card";
import { Disclosure } from "../ui/Disclosure";
import { ConfigPanel } from "./ConfigPanel";
import { RunDashboard } from "./RunDashboard";

interface RunPageProps {
  config: Config;
  areas: Area[];
  rule: Rule | null;
  preview: PreviewResult | null;
  run: RunState | null;
  logs: string[];
  progress: number;
  distText: string;
  running: boolean;
  starting: boolean;
  stopping: boolean;
  syncing: boolean;
  ready: boolean;
  missing: string[];
  summary: string;
  onAcknowledgeRun: () => void;
  onChange: (patch: Partial<Config>) => void;
  onStart: () => void;
  onStop: () => void;
  onGoGuide: () => void;
  onSync: () => void;
}

export function RunPage({
  config,
  areas,
  rule,
  preview,
  run,
  logs,
  progress,
  distText,
  running,
  starting,
  stopping,
  syncing,
  ready,
  missing,
  summary,
  onAcknowledgeRun,
  onChange,
  onStart,
  onStop,
  onGoGuide,
  onSync,
}: RunPageProps) {
  const area = areas.find((a) => a.placeCode === config.placeCode);
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const placeName = area?.placeName ?? (areas.length ? "选择场地" : "尚未同步场地");
  const description = area
    ? `${area.placeCode}${area.banCount > 0 ? ` · ${area.banCount} 处禁跑区` : " · 围栏已同步"}`
    : areas.length
      ? "选择一个已同步的场地开始"
      : "完成身份配置并同步场地后，会按真实围栏生成轨迹";

  return (
    <div className="page run-page">
      <PageHeader
        eyebrow="当前场地"
        title={placeName}
        description={description}
      />

      <div className="run-layout">
        <div className="run-main">
          <RunDashboard
            config={config}
            run={run}
            preview={preview}
            progress={progress}
            distText={distText}
            running={running}
            usingDemo={!area}
            stopping={stopping}
            onAcknowledgeRun={onAcknowledgeRun}
          />

          <div id="run-log"><Card className="log-card" padded={false}>
            <Disclosure
              key={run?.failed ? "failed" : "normal"}
              defaultOpen={!!run?.failed}
              title="运行日志"
              description={
                logs.length ? `${logs.length} 条 · 最近输出` : "尚未开始"
              }
            >
              <pre className="log" ref={logRef}>
                {logs.length ? logs.join("\n") : "开始打卡后，这里会显示调度与接口返回。"}
              </pre>
            </Disclosure>
          </Card></div>
        </div>

        <aside className="run-aside">
          <ConfigPanel
            config={config}
            areas={areas}
            rule={rule}
            run={run}
            running={running}
            starting={starting}
            stopping={stopping}
            syncing={syncing}
            ready={ready}
            missing={missing}
            summary={summary}
            onChange={onChange}
            onStart={onStart}
            onStop={onStop}
            onGoGuide={onGoGuide}
            onSync={onSync}
          />
        </aside>
      </div>
    </div>
  );
}
