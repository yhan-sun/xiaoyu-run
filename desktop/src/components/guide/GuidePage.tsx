import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { Area, Config, Rule } from "../../api";
import { sanitizeOpenid } from "../../api";
import { PageHeader } from "../layout/PageHeader";
import { Card } from "../ui/Card";
import { GuideHelp, GuideFootnote, ReadyCard } from "./ReadyCard";
import { IdentityCard } from "./IdentityCard";
import { PlacesCard } from "./PlacesCard";
import { SetupStepper, type SetupStep } from "./SetupStepper";


function CompletedStep({ summary, children, completed = true }: { summary: string; children: ReactNode; completed?: boolean }) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  return (
    <motion.div layout className="guide-completed" transition={{ duration: reduced ? 0 : 0.2 }}>
      {completed && <button type="button" className="guide-completed-trigger" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{summary}</span><span aria-hidden>{open ? "−" : "+"}</span>
      </button>}
      <AnimatePresence initial={false}>
        {(open || !completed) && <motion.div key="content" initial={reduced ? false : { opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
          transition={{ duration: reduced ? 0 : 0.2 }} style={{ overflow: "hidden" }}>
          {children}
        </motion.div>}
      </AnimatePresence>
    </motion.div>
  );
}

interface GuidePageProps {
  config: Config;
  openidText: string;
  areas: Area[];
  rule: Rule | null;
  verified: boolean;
  connecting: boolean;
  disabled: boolean;
  isPhone: boolean;
  onOpenidTextChange: (value: string) => void;
  onSaveOpenid: () => void;
  onScan: () => void;
  onGoExtract: () => void;
  onCheckImport: () => void;
  onSync: () => void;
  onSelectPlace: (placeCode: string) => void;
  onGoRun: () => void;
}

export function GuidePage({
  config,
  openidText,
  areas,
  rule,
  verified,
  connecting,
  disabled,
  isPhone,
  onOpenidTextChange,
  onSaveOpenid,
  onScan,
  onGoExtract,
  onCheckImport,
  onSync,
  onSelectPlace,
  onGoRun,
}: GuidePageProps) {
  const clean = sanitizeOpenid(openidText);
  const hasOpenid = clean.length > 0;
  const ready = hasOpenid && verified && areas.length > 0;

  const steps = useMemo<SetupStep[]>(() => {
    return [
      {
        key: "identity",
        title: "身份",
        description: verified ? "OpenID 已验证" : "填入并验证 OpenID",
        state: verified ? "done" : "current",
      },
      {
        key: "places",
        title: "场地",
        description: verified
          ? areas.length
            ? `${areas.length} 个场地已同步`
            : "同步可用场地"
          : "等待身份验证",
        state: verified ? (areas.length ? "done" : "current") : "upcoming",
      },
      {
        key: "ready",
        title: "就绪",
        description: ready ? "可以开始运动" : "完成以上两步",
        state: ready ? "done" : areas.length ? "current" : "upcoming",
      },
    ];
  }, [verified, areas.length, ready]);

  return (
    <div className="page guide-page">
      <PageHeader
        eyebrow="初始配置"
        title="指南"
        description="一次配置，之后直接开跑"
      />

      <div className="guide-layout">
        <aside className="guide-aside">
          <Card className="guide-progress-card" padded={false}>
            <SetupStepper steps={steps} />
          </Card>
        </aside>

        <div className="guide-main">
          <div id="guide-identity">
            <CompletedStep summary="身份已验证 · 管理 OpenID" completed={verified}>
              <IdentityCard openidText={openidText} verified={verified} connecting={connecting} disabled={disabled}
                isPhone={isPhone} onTextChange={onOpenidTextChange} onSave={onSaveOpenid}
                onScan={onScan} onGoExtract={onGoExtract} onCheckImport={onCheckImport} />
            </CompletedStep>
          </div>

          {verified && (areas.length ? (
            <CompletedStep summary="场地已同步 · 管理默认场地">
              <PlacesCard areas={areas} rule={rule} selected={config.placeCode} hasOpenid={hasOpenid} disabled={disabled}
                syncing={connecting} onSync={onSync} onSelect={onSelectPlace} />
            </CompletedStep>
          ) : (
            <PlacesCard areas={areas} rule={rule} selected={config.placeCode} hasOpenid={hasOpenid} disabled={disabled}
              syncing={connecting} onSync={onSync} onSelect={onSelectPlace} />
          ))}

          {ready && <ReadyCard placeCount={areas.length} onGoRun={onGoRun} />}

          <GuideHelp isPhone={isPhone} />

          <GuideFootnote>
            仅供个人学习与协议研究 · 请遵守校纪校规
          </GuideFootnote>
        </div>
      </div>
    </div>
  );
}
