import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: string;
  eyebrow?: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({
  title,
  eyebrow,
  description,
  action,
  className,
}: SectionHeaderProps) {
  return (
    <div className={["section-head", className ?? ""].filter(Boolean).join(" ")}>
      <div className="section-head-copy">
        {eyebrow ? <div className="section-eyebrow">{eyebrow}</div> : null}
        <h2 className="t-section">{title}</h2>
        {description ? <p className="section-desc">{description}</p> : null}
      </div>
      {action ? <div className="section-head-action">{action}</div> : null}
    </div>
  );
}
