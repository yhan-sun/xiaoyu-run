import type { StatusTone } from "../../lib/format";

interface StatusIndicatorProps {
  tone?: StatusTone;
  label: string;
  detail?: string;
  live?: boolean;
  plain?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function StatusIndicator({
  tone = "neutral",
  label,
  detail,
  live = false,
  plain = false,
  size = "md",
  className,
}: StatusIndicatorProps) {
  return (
    <span
      className={[
        "status",
        `status--${tone}`,
        `status--${size}`,
        plain ? "status--plain" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      role={live ? "status" : undefined}
    >
      <span
        className={`status-dot${live ? " live-dot" : ""}`}
        aria-hidden
      />
      <span className="status-label">{label}</span>
      {detail ? <span className="status-detail">{detail}</span> : null}
    </span>
  );
}
