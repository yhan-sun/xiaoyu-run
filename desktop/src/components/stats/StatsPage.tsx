import type { Stats } from "../../api";
import { PageHeader } from "../layout/PageHeader";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { EmptyState } from "../ui/EmptyState";
import { SectionHeader } from "../ui/SectionHeader";
import { IconAlert, IconRefresh, IconSync, IconTrack } from "../ui/icons";
import { PlaceDistribution } from "./PlaceDistribution";
import { RecordList } from "./RecordList";
import { StatsOverview } from "./StatsOverview";

interface StatsPageProps {
  stats: Stats | null;
  loading: boolean;
  error: string | null;
  lastSync: number | null;
  hasOpenid: boolean;
  onRefresh: () => void;
  onGoGuide: () => void;
}

export function StatsPage({
  stats,
  loading,
  error,
  lastSync,
  hasOpenid,
  onRefresh,
  onGoGuide,
}: StatsPageProps) {
  const hasData = !!stats && stats.rows.length > 0;

  return (
    <div className="page stats-page">
      <PageHeader
        title="成绩"
        actions={hasData ? (
          <Button
            variant="secondary"
            size="sm"
            icon={<IconRefresh size={16} />}
            loading={loading}
            onClick={onRefresh}
          >
            同步成绩
          </Button>
        ) : undefined}
      />

      {error ? (
        <div className="error-banner" role="alert">
          <span className="error-banner-icon">
            <IconAlert size={17} />
          </span>
          <div className="error-banner-copy">
            <div className="error-banner-title">同步失败</div>
            <div className="error-banner-desc">{error}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onRefresh}>
            重试
          </Button>
        </div>
      ) : null}

      {loading && !stats ? (
        <div className="stats-skeleton" aria-label="正在读取成绩">
          <Card padded={false} className="skeleton-card">
            <div className="skeleton skeleton-kicker" />
            <div className="skeleton skeleton-total" />
            <div className="skeleton-row">
              <div className="skeleton skeleton-cell" />
              <div className="skeleton skeleton-cell" />
              <div className="skeleton skeleton-cell" />
            </div>
          </Card>
          <div className="skeleton-list">
            {[0, 1, 2].map((i) => (
              <div className="skeleton skeleton-row-item" key={i} />
            ))}
          </div>
        </div>
      ) : stats ? (
        <>
          {hasData ? <StatsOverview stats={stats} lastSync={lastSync} loading={loading} /> : null}

          {hasData ? (
            <div className="stats-layout">
              <section className="stats-section">
                <SectionHeader
                  title="场地分布"
                />
                <PlaceDistribution
                  byPlace={stats.byPlace}
                  rows={stats.rows}
                />
              </section>

              <section className="stats-section">
                <SectionHeader title="最近记录" />
                <RecordList rows={stats.rows} />
              </section>
            </div>
          ) : (
            <div className="stats-empty-wrap">
              <EmptyState
                icon={<IconTrack size={28} />}
                title="还没有可展示的记录"
                description="账号已连接，但服务端暂时没有返回跑步记录。完成一次打卡后再同步。"
                action={
                  <Button
                    variant="primary"
                    size="md"
                    icon={<IconSync size={16} />}
                    loading={loading}
                    onClick={onRefresh}
                  >
                    重新同步
                  </Button>
                }
              />
            </div>
          )}
        </>
      ) : (
        <div className="stats-empty-wrap">
          <EmptyState
            icon={<IconTrack size={28} />}
            title="还没有成绩"
            description={
              hasOpenid
                ? "同步后查看里程与记录。"
                : "先完成身份配置，再同步成绩。"
            }
            action={
              hasOpenid ? (
                <Button
                  variant="primary"
                  size="md"
                  icon={<IconSync size={16} />}
                  loading={loading}
                  onClick={onRefresh}
                >
                  同步成绩
                </Button>
              ) : (
                <Button variant="primary" size="md" onClick={onGoGuide}>
                  去完成配置
                </Button>
              )
            }
          />
        </div>
      )}
    </div>
  );
}
