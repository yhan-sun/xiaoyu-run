import { fmtPace } from "../../api";
import type { Area, Rule } from "../../api";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { StatusIndicator } from "../ui/StatusIndicator";
import { IconCheck, IconInfo, IconRefresh, IconSync } from "../ui/icons";

interface PlacesCardProps {
  areas: Area[];
  rule: Rule | null;
  selected: string;
  hasOpenid: boolean;
  disabled: boolean;
  syncing: boolean;
  onSync: () => void;
  onSelect: (placeCode: string) => void;
}

export function PlacesCard({
  areas,
  rule,
  selected,
  hasOpenid,
  disabled,
  syncing,
  onSync,
  onSelect,
}: PlacesCardProps) {
  return (
    <Card className="guide-card" padded={false}>
      <div className="guide-card-head">
        <div className="guide-card-heading">
          <span className="guide-step-no num">02</span>
          <div>
            <h2 className="guide-card-title">场地</h2>
            <p className="guide-card-desc">拉取围栏、禁跑区与配速规则</p>
          </div>
        </div>
        <StatusIndicator
          tone={areas.length ? "success" : "neutral"}
          label={areas.length ? `已同步 ${areas.length} 个` : "未同步"}
          size="sm"
          plain
        />
      </div>

      <div className="guide-card-body">
        {!hasOpenid ? (
          <div className="guide-locked">
            <IconInfo size={16} />
            先完成身份配置，才能向服务端拉取场地。
          </div>
        ) : areas.length === 0 ? (
          <div className="places-empty">
            <p>
              同步会读取账号可用的操场围栏与规则。完成后，运动页会按真实围栏生成轨迹。
            </p>
            <Button
              variant="primary"
              size="md"
              icon={<IconSync size={17} />}
              loading={syncing}
              disabled={disabled}
              onClick={onSync}
            >
              同步场地
            </Button>
          </div>
        ) : (
          <>
            <div className="place-options" role="radiogroup" aria-label="选择默认场地">
              {areas.map((area) => {
                const active = area.placeCode === selected;
                return (
                  <button
                    key={area.placeCode}
                    type="button"
                    disabled={disabled}
                    role="radio"
                    aria-checked={active}
                    className={"place-option" + (active ? " is-active" : "")}
                    onClick={() => onSelect(area.placeCode)}
                  >
                    <span className="place-option-copy">
                      <span className="place-option-name">{area.placeName}</span>
                      <span className="place-option-sub num">
                        {area.placeCode}
                        {area.banCount > 0
                          ? ` · ${area.banCount} 处禁跑区`
                          : ` · ${area.fenceVertices} 个围栏点`}
                      </span>
                    </span>
                    <span className="place-option-check" aria-hidden>
                      {active ? <IconCheck size={15} /> : null}
                    </span>
                  </button>
                );
              })}
            </div>

            {rule ? (
              <div className="rule-note">
                <span className="rule-note-icon">
                  <IconInfo size={16} />
                </span>
                <span>
                  规则配速 {fmtPace(rule.minPace)} – {fmtPace(rule.maxPace)}/km ·
                  达标 <span className="num">{Math.round(rule.raceMile)}</span> m
                </span>
              </div>
            ) : null}

            <button
              type="button"
              className="text-button guide-resync"
              onClick={onSync}
              disabled={disabled || syncing}
            >
              <IconRefresh size={14} />
              {syncing ? "正在重新同步…" : "重新同步场地"}
            </button>
          </>
        )}
      </div>
    </Card>
  );
}
