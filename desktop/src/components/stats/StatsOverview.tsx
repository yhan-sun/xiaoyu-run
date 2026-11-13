import { fmtPace } from "../../api";
import type { Stats } from "../../api";
import { formatSyncLabel } from "../../lib/format";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Card } from "../ui/Card";
import { StatusIndicator } from "../ui/StatusIndicator";
import { IconSync } from "../ui/icons";

interface StatsOverviewProps {
  stats: Stats;
  lastSync: number | null;
  loading: boolean;
}

export function StatsOverview({ stats, lastSync, loading }: StatsOverviewProps) {
  const total = Math.max(stats.total, stats.validCount + stats.invalidCount);
  const validRatio = total > 0 ? stats.validCount / total : 0;
  const invalidRatio = total > 0 ? stats.invalidCount / total : 0;

  return (
    <Card className="stats-overview" padded={false}>
      <div className="stats-overview-top">
        <div>
          <div className="stats-kicker">累计里程</div>
          <div className="stats-total">
            <AnimatedNumber value={stats.totalKm} />
            <span className="stats-total-unit">km</span>
          </div>
        </div>
        <div className="stats-sync">
          <StatusIndicator
            tone={loading ? "accent" : lastSync ? "success" : "neutral"}
            label={loading ? "同步中" : formatSyncLabel(lastSync)}
            live={loading}
            size="sm"
            plain
          />
          <span className="stats-sync-sub">
            {total > 0 ? `${total} 次记录` : "等待第一条记录"}
          </span>
        </div>
      </div>

      <div className="stats-subgrid">
        <div className="stats-subitem">
          <span className="stats-sub-label">有效记录</span>
          <span className="stats-sub-value num">{stats.validCount}</span>
        </div>
        <div className="stats-subitem">
          <span className="stats-sub-label">未通过</span>
          <span className="stats-sub-value num">{stats.invalidCount}</span>
        </div>
        <div className="stats-subitem">
          <span className="stats-sub-label">平均配速</span>
          <span className="stats-sub-value num">
            {fmtPace(stats.avgPaceSecKm)}
            <em>/km</em>
          </span>
        </div>
      </div>

      {total > 0 ? (
        <div className="validity">
          <div
            className="validity-bar"
            role="img"
            aria-label={`有效 ${stats.validCount} 次，未通过 ${stats.invalidCount} 次`}
          >
            <span
              className="validity-seg validity-seg--valid"
              style={{ width: `${validRatio * 100}%` }}
            />
            <span
              className="validity-seg validity-seg--invalid"
              style={{ width: `${invalidRatio * 100}%` }}
            />
          </div>
          <div className="validity-legend">
            <span>
              <i className="legend-dot legend-dot--valid" />
              有效 {stats.validCount}
            </span>
            <span>
              <i className="legend-dot legend-dot--invalid" />
              未通过 {stats.invalidCount}
            </span>
            <span className="validity-rate num">
              {total > 0 ? Math.round(validRatio * 100) : 0}%
            </span>
          </div>
        </div>
      ) : (
        <div className="stats-zero-note">
          <IconSync size={15} />
          同步成绩后会在这里汇总本机账号的记录
        </div>
      )}
    </Card>
  );
}
