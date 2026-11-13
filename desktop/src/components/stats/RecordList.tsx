import { useEffect, useId, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { fmtPace } from "../../api";
import type { StatRow } from "../../api";
import { recordAdvice } from "../../lib/format";
import { StatusIndicator } from "../ui/StatusIndicator";
import { IconChevronDown, IconInfo } from "../ui/icons";

type Filter = "all" | "valid" | "invalid";

interface RecordListProps {
  rows: StatRow[];
  limit?: number;
}

export function RecordList({ rows, limit = 40 }: RecordListProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const reduced = useReducedMotion();
  const baseId = useId();

  const counts = useMemo(
    () => ({
      all: rows.length,
      valid: rows.filter((r) => r.valid).length,
      invalid: rows.filter((r) => !r.valid).length,
    }),
    [rows]
  );

  const filtered = useMemo(() => {
    const list =
      filter === "all"
        ? rows
        : rows.filter((r) => (filter === "valid" ? r.valid : !r.valid));
    return list.slice(0, limit);
  }, [rows, filter, limit]);

  useEffect(() => {
    setExpanded(null);
  }, [rows]);

  const filters: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "全部", count: counts.all },
    { key: "valid", label: "有效", count: counts.valid },
    { key: "invalid", label: "未通过", count: counts.invalid },
  ];

  return (
    <div className="records">
      <div className="records-toolbar">
        <div className="filter-chips" role="group" aria-label="筛选记录">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={"filter-chip" + (filter === f.key ? " is-active" : "")}
              aria-pressed={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setExpanded(null);
              }}
            >
              {f.label}
              <span className="filter-count num">{f.count}</span>
            </button>
          ))}
        </div>
        <span className="records-count num">
          {filtered.length < rows.length
            ? `显示 ${filtered.length} / ${rows.length}`
            : `共 ${rows.length} 条`}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="records-empty">
          当前筛选下没有记录
          <button type="button" className="text-button" onClick={() => setFilter("all")}>
            查看全部
          </button>
        </div>
      ) : (
        <div className="record-list">
          {filtered.map((row, index) => {
            const originalIndex = rows.indexOf(row);
            const open = expanded === originalIndex;
            const detailId = `${baseId}-detail-${originalIndex}`;
            const pace = row.km > 0 ? fmtPace(row.sec / row.km) : "--";
            return (
              <div
                className={"record" + (open ? " is-open" : "")}
                key={`${row.place}-${originalIndex}-${index}`}
              >
                <button
                  type="button"
                  className="record-row"
                  aria-expanded={open}
                  aria-controls={detailId}
                  onClick={() => setExpanded(open ? null : originalIndex)}
                >
                  <span
                    className={
                      "record-dot " +
                      (row.valid ? "record-dot--valid" : "record-dot--invalid")
                    }
                    aria-hidden
                  />
                  <span className="record-main">
                    <span className="record-place">{row.place}</span>
                    <span className="record-meta num">
                      {row.duration} · {pace}
                      <span className="record-unit">/km</span>
                    </span>
                  </span>
                  <span className="record-right">
                    <span className="record-km num">
                      {row.km.toFixed(2)}
                      <em>km</em>
                    </span>
                    <StatusIndicator
                      tone={row.valid ? "success" : "danger"}
                      label={row.valid ? "有效" : "未通过"}
                      size="sm"
                      plain
                    />
                  </span>
                  <span className="record-chevron" aria-hidden>
                    <IconChevronDown size={16} />
                  </span>
                </button>

                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      id={detailId}
                      className="record-detail"
                      initial={reduced ? false : { height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{
                        duration: reduced ? 0 : 0.24,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                    >
                      <div className="record-detail-inner">
                        <div className="record-detail-grid">
                          <div className="record-detail-item">
                            <span className="record-detail-label">判定</span>
                            <span className="record-detail-value">
                              {row.valid ? "服务端判定有效" : row.reason || "未通过"}
                            </span>
                          </div>
                          <div className="record-detail-item">
                            <span className="record-detail-label">数据</span>
                            <span className="record-detail-value num">
                              {row.km.toFixed(2)} km · {row.duration} · {pace}/km
                            </span>
                          </div>
                        </div>
                        {!row.valid ? (
                          <div className="record-advice">
                            <IconInfo size={15} />
                            <span>{recordAdvice(row.reason)}</span>
                          </div>
                        ) : null}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}

      {rows.length > limit ? (
        <div className="records-more">
          仅显示最近 {limit} 条，完整记录以服务端为准
        </div>
      ) : null}
    </div>
  );
}
