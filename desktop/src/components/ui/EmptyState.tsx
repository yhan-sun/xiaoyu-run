import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={[
        "empty-state",
        compact ? "empty-state--compact" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {icon ? <div className="empty-state-icon">{icon}</div> : null}
      <div className="empty-state-title">{title}</div>
      {description ? (
        <p className="empty-state-desc">{description}</p>
      ) : null}
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}
