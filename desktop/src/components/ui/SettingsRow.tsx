import type { ReactNode } from "react";
import { IconChevronRight } from "./icons";

interface SettingsRowProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  control?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  last?: boolean;
  className?: string;
}

export function SettingsRow({
  icon,
  title,
  description,
  control,
  onClick,
  danger = false,
  last = false,
  className,
}: SettingsRowProps) {
  const content = (
    <>
      {icon ? <span className="settings-row-icon">{icon}</span> : null}
      <span className="settings-row-copy">
        <span className="settings-row-title">{title}</span>
        {description ? (
          <span className="settings-row-desc">{description}</span>
        ) : null}
      </span>
      {control ? (
        <span className="settings-row-control">{control}</span>
      ) : onClick ? (
        <span className="settings-row-chevron">
          <IconChevronRight size={17} />
        </span>
      ) : null}
    </>
  );

  const classes = [
    "settings-row",
    danger ? "is-danger" : "",
    last ? "is-last" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick}>
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}

export function SettingsGroup({
  children,
  className,
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  "aria-label"?: string;
}) {
  return (
    <div
      className={["settings-group", className ?? ""].filter(Boolean).join(" ")}
      role="group"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}
