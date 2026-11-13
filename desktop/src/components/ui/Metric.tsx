import type { ReactNode } from "react";

interface MetricProps {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: string;
  tone?: "default" | "accent" | "success" | "warning" | "danger";
  size?: "sm" | "md" | "lg";
}

export function Metric({
  label,
  value,
  unit,
  sub,
  tone = "default",
  size = "md",
}: MetricProps) {
  return (
    <div className={`metric metric--${size} metric--${tone}`}>
      <div className="metric-label">{label}</div>
      <div className="metric-value num">
        {value}
        {unit ? <span className="metric-unit">{unit}</span> : null}
      </div>
      {sub ? <div className="metric-sub">{sub}</div> : null}
    </div>
  );
}

export function MetricGrid({ children }: { children: ReactNode }) {
  return <div className="metric-grid">{children}</div>;
}
