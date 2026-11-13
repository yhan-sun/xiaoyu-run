import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLElement> {
  children: ReactNode;
  as?: "section" | "div" | "article";
  padded?: boolean;
}

export function Card({
  children,
  className,
  as: Tag = "section",
  padded = true,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={["card", padded ? "card--padded" : "", className ?? ""]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </Tag>
  );
}
